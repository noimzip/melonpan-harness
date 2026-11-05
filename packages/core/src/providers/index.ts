import { GoogleGenAI } from '@google/genai';
import { getEncoding } from 'js-tiktoken';
import {
  ILLMProvider,
  LLMChatRequest,
  LLMMessage,
  LLMStreamChunk,
  LLMToolCall,
} from '../types.js';
import { estimateMessagesTokens } from '../session/context-strategy.js';
import {
  formatOpenAITools,
  formatToolParameters,
  normalizeJsonSchema,
  normalizeJsonSchemaType,
} from '../tools/schema-converter.js';
import { ContextCacheManager } from '../cache/context-cache-manager.js';

let cachedO200kEncoding: ReturnType<typeof getEncoding> | undefined;
let cachedCl100kEncoding: ReturnType<typeof getEncoding> | undefined;

/**
 * OpenAI 公式互換 BPE トークナイザ (`js-tiktoken`) を用いた高速・高精度トークンカウント
 * - `gpt-4o`, `gpt-4o-mini`, `o3-mini`, `o1` 等は `o200k_base`
 * - `gpt-4-turbo`, `gpt-4`, `gpt-3.5-turbo` 等は `cl100k_base`
 */
export function countOpenAITokensWithTiktoken(
  messages: LLMMessage[],
  systemInstruction?: string,
  model: string = 'gpt-4o'
): number {
  try {
    const lowerModel = model.toLowerCase();
    const useCl100k =
      lowerModel.includes('gpt-4-turbo') ||
      lowerModel === 'gpt-4' ||
      lowerModel.includes('gpt-3.5');

    const enc = useCl100k
      ? (cachedCl100kEncoding ??= getEncoding('cl100k_base'))
      : (cachedO200kEncoding ??= getEncoding('o200k_base'));

    let tokens = 3; // reply priming overhead
    if (systemInstruction) {
      tokens += 4 + enc.encode(systemInstruction).length;
    }

    if (Array.isArray(messages)) {
      for (const msg of messages) {
        if (!msg) continue;
        tokens += 4; // per-message role/formatting overhead
        if (typeof (msg as any).content === 'string') {
          tokens += enc.encode((msg as any).content).length;
        }
        if (Array.isArray(msg.parts)) {
          for (const part of msg.parts) {
            if (typeof part?.text === 'string' && !part.thought) {
              tokens += enc.encode(part.text).length;
            } else if (part?.functionCall) {
              const fcStr = `${part.functionCall.name || ''}:${JSON.stringify(part.functionCall.args || {})}`;
              tokens += 3 + enc.encode(fcStr).length;
            } else if (part?.functionResponse) {
              const frStr = `${part.functionResponse.name || ''}:${JSON.stringify(part.functionResponse.response || {})}`;
              tokens += 3 + enc.encode(frStr).length;
            }
          }
        }
      }
    }

    return Math.max(1, tokens);
  } catch {
    return estimateMessagesTokens(messages, systemInstruction);
  }
}


/**
 * `@google/genai` レスポンスの `candidates[0].content.parts` から
 * 思考パート (`part.thought === true`) と通常テキストパートを明確に分離抽出するヘルパー (Issue #4)
 *
 * SDK の `response.text` ゲッターは `part.thought === true` のパートをスキップするため、
 * ツール呼び出しと同時に思考トークンが生成されたターンでも思考が消失しないようにします。
 */
export function extractGeminiResponseParts(response: any): {
  thoughts: string[];
  texts: string[];
  thoughtSignatures: string[];
} {
  const thoughts: string[] = [];
  const texts: string[] = [];
  const thoughtSignatures: string[] = [];

  const parts = response?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts) && parts.length > 0) {
    for (const part of parts) {
      const sig = part?.thoughtSignature || part?.thought_signature;
      if (typeof sig === 'string' && sig.length > 0) {
        thoughtSignatures.push(sig);
      }
      if (typeof part?.text === 'string' && part.text.length > 0) {
        if (part.thought === true) {
          thoughts.push(part.text);
        } else {
          texts.push(part.text);
        }
      }
    }
  } else if (typeof response?.text === 'string' && response.text.length > 0) {
    texts.push(response.text);
  }

  return { thoughts, texts, thoughtSignatures };
}

/**
 * `@google/genai` レスポンスまたはチャンクから `functionCall` と
 * 思考署名 (`thoughtSignature` / `thought_signature`) を抽出するヘルパー
 */
export function extractGeminiFunctionCalls(
  responseOrChunk: any,
  fallbackSignature?: string
): LLMToolCall[] {
  const result: LLMToolCall[] = [];
  const parts = responseOrChunk?.candidates?.[0]?.content?.parts;

  let candidateSignature: string | undefined =
    responseOrChunk?.candidates?.[0]?.thoughtSignature ||
    responseOrChunk?.candidates?.[0]?.thought_signature ||
    responseOrChunk?.thoughtSignature ||
    responseOrChunk?.thought_signature ||
    fallbackSignature;

  if (Array.isArray(parts) && parts.length > 0) {
    if (!candidateSignature) {
      for (const p of parts) {
        const sig = p?.thoughtSignature || p?.thought_signature;
        if (typeof sig === 'string' && sig.length > 0) {
          candidateSignature = sig;
          break;
        }
      }
    }

    for (const part of parts) {
      if (part?.functionCall) {
        const fc = part.functionCall;
        const signature =
          part.thoughtSignature ||
          part.thought_signature ||
          fc.thoughtSignature ||
          fc.thought_signature ||
          candidateSignature;
        result.push({
          id: fc.id,
          name: fc.name,
          args: fc.args || {},
          ...(signature
            ? { thoughtSignature: signature, thought_signature: signature }
            : {}),
        });
      }
    }
  }

  if (result.length === 0) {
    const fcs = (responseOrChunk as any)?.functionCalls;
    if (Array.isArray(fcs)) {
      for (const fc of fcs) {
        const signature =
          fc.thoughtSignature ||
          fc.thought_signature ||
          (fc as any)?.thought_signature ||
          candidateSignature;
        result.push({
          id: fc.id,
          name: fc.name,
          args: fc.args || {},
          ...(signature
            ? { thoughtSignature: signature, thought_signature: signature }
            : {}),
        });
      }
    }
  }

  return result;
}

export interface GeminiProviderOptions {
  apiKey?: string;
  useStreamingApi?: boolean;
  cacheManager?: ContextCacheManager;
  enableContextCache?: boolean;
  aiClient?: any;
  defaultModel?: string;
}

/**
 * 1. GeminiProvider: `@google/genai` ベースのプラガブル LLM プロバイダー (Issues #27, #4)
 * - `candidates?.[0]?.content?.parts` から `part.thought === true` を正確に抽出 (#4)
 * - `THOUGHT_DELTA`, `TEXT_DELTA`, `TOOL_CALL_DELTA` チャンクの送出と `AbortSignal` 対応 (#27)
 * - Gemini 3 / 2.5 思考モードにおける `thought_signature` / `thoughtSignature` の保持・再送
 * - Gemini Context Caching (`ai.caches.create`) とトークン節約 (#17)
 */
export class GeminiProvider implements ILLMProvider {
  readonly id = 'gemini';
  private apiKey: string;
  private useStreamingApi: boolean;
  private cacheManager: ContextCacheManager;
  private enableContextCache: boolean;
  private aiClient?: any;
  private defaultModel: string;

  constructor(options: GeminiProviderOptions = {}) {
    const envApiKey =
      typeof (globalThis as any).process !== 'undefined'
        ? (globalThis as any).process.env?.GEMINI_API_KEY
        : '';
    this.apiKey = options.apiKey || envApiKey || '';
    this.useStreamingApi = options.useStreamingApi ?? false;
    this.cacheManager = options.cacheManager || new ContextCacheManager();
    this.enableContextCache = options.enableContextCache ?? true;
    this.aiClient = options.aiClient;
    this.defaultModel = options.defaultModel || 'gemini-3.8-flash';
  }

  async *streamChat(
    request: LLMChatRequest,
    signal?: AbortSignal
  ): AsyncGenerator<LLMStreamChunk, void, unknown> {
    if (signal?.aborted) {
      throw new Error('GeminiProvider streamChat aborted.');
    }

    const ai = this.aiClient || new GoogleGenAI({ apiKey: this.apiKey });

    const config: Record<string, any> = {};

    const stableTools = this.cacheManager.stabilizeTools(request.tools);
    let cachedContentName = request.cachedContent;
    if (
      !cachedContentName &&
      this.enableContextCache &&
      (request.systemInstruction || (stableTools && stableTools.length > 0))
    ) {
      cachedContentName = await this.cacheManager.getOrCreateGeminiCache({
        ai,
        model: request.model,
        systemInstruction: request.systemInstruction,
        tools: stableTools,
      });
    }

    if (cachedContentName) {
      config.cachedContent = cachedContentName;
    } else {
      if (request.systemInstruction) {
        config.systemInstruction = request.systemInstruction;
      }
      if (stableTools && stableTools.length > 0) {
        config.tools = [{ functionDeclarations: stableTools }];
      }
    }

    if (request.temperature !== undefined) {
      config.temperature = request.temperature;
    }
    if (request.maxOutputTokens !== undefined) {
      config.maxOutputTokens = request.maxOutputTokens;
    }

    const thinkingLevelUpper = (request.thinkingLevel || 'high').toUpperCase();
    const validLevels = ['MINIMAL', 'LOW', 'MEDIUM', 'HIGH'];
    if (validLevels.includes(thinkingLevelUpper)) {
      config.thinkingConfig = {
        includeThoughts: true,
        thinkingLevel: thinkingLevelUpper,
      };
    } else {
      config.thinkingConfig = {
        includeThoughts: true,
      };
    }

    const contents = request.messages.map((m) => {
      let msgSig: string | undefined = undefined;
      for (const p of m.parts || []) {
        const s =
          p.thoughtSignature ||
          p.thought_signature ||
          p.functionCall?.thoughtSignature ||
          p.functionCall?.thought_signature;
        if (typeof s === 'string' && s.length > 0) {
          msgSig = s;
          break;
        }
      }

      return {
        role: m.role === 'tool' ? 'user' : m.role === 'system' ? 'user' : m.role,
        parts: m.parts.map((p) => {
          const sig =
            p.thoughtSignature ||
            p.thought_signature ||
            p.functionCall?.thoughtSignature ||
            p.functionCall?.thought_signature ||
            msgSig;

          const partObj: Record<string, any> = { ...p };
          if (sig) {
            partObj.thoughtSignature = sig;
            partObj.thought_signature = sig;
            if (partObj.functionCall) {
              partObj.functionCall = {
                ...partObj.functionCall,
                thoughtSignature: sig,
                thought_signature: sig,
              };
            }
          }
          return partObj;
        }),
      };
    });

    if (this.useStreamingApi && typeof (ai.models as any).generateContentStream === 'function') {
      const streamResp = await ai.models.generateContentStream({
        model: request.model,
        contents: contents as any,
        config,
      });

      let promptTokens = 0;
      let completionTokens = 0;
      let cachedPromptTokens = 0;
      let turnThoughtSignature: string | undefined = undefined;
      const turnToolCalls: LLMToolCall[] = [];
      const emittedToolCallKeys = new Set<string>();

      for await (const chunk of streamResp) {
        if (signal?.aborted) {
          throw new Error('GeminiProvider stream aborted.');
        }

        const usageMeta = (chunk as any).usageMetadata;
        if (usageMeta) {
          const extracted = this.cacheManager.extractGeminiUsage(usageMeta);
          promptTokens = extracted.promptTokens || promptTokens;
          completionTokens = extracted.completionTokens || completionTokens;
          cachedPromptTokens = extracted.cachedPromptTokens || cachedPromptTokens;
        }

        const { thoughts, texts, thoughtSignatures } = extractGeminiResponseParts(chunk);
        for (const sig of thoughtSignatures) {
          if (typeof sig === 'string' && sig.length > 0) {
            turnThoughtSignature = sig;
          }
        }

        const candidateSig =
          (chunk as any)?.candidates?.[0]?.thoughtSignature ||
          (chunk as any)?.candidates?.[0]?.thought_signature ||
          (chunk as any)?.thoughtSignature ||
          (chunk as any)?.thought_signature;
        if (typeof candidateSig === 'string' && candidateSig.length > 0) {
          turnThoughtSignature = candidateSig;
        }

        for (const t of thoughts) {
          yield {
            type: 'thought_delta',
            delta: t,
            ...(turnThoughtSignature
              ? { thoughtSignature: turnThoughtSignature, thought_signature: turnThoughtSignature }
              : {}),
          };
        }
        for (const txt of texts) {
          yield { type: 'text_delta', delta: txt };
        }

        const toolCalls = extractGeminiFunctionCalls(chunk, turnThoughtSignature);
        for (const tc of toolCalls) {
          const argsJson = JSON.stringify(tc.args || {});
          const dedupKey = tc.id ? `id:${tc.id}` : `call:${tc.name}:${argsJson}`;
          if (emittedToolCallKeys.has(dedupKey)) {
            continue;
          }
          emittedToolCallKeys.add(dedupKey);

          if (!tc.thoughtSignature && turnThoughtSignature) {
            tc.thoughtSignature = turnThoughtSignature;
            tc.thought_signature = turnThoughtSignature;
          } else if (tc.thoughtSignature && !turnThoughtSignature) {
            turnThoughtSignature = tc.thoughtSignature;
          }
          turnToolCalls.push(tc);

          yield {
            type: 'tool_call_delta',
            delta: argsJson,
            toolCall: tc,
            ...(tc.thoughtSignature
              ? { thoughtSignature: tc.thoughtSignature, thought_signature: tc.thoughtSignature }
              : {}),
          };
          yield {
            type: 'tool_call',
            toolCall: tc,
            ...(tc.thoughtSignature
              ? { thoughtSignature: tc.thoughtSignature, thought_signature: tc.thoughtSignature }
              : {}),
          };
        }

        if (turnThoughtSignature) {
          for (const tc of turnToolCalls) {
            if (!tc.thoughtSignature) {
              tc.thoughtSignature = turnThoughtSignature;
              tc.thought_signature = turnThoughtSignature;
            }
          }
        }
      }

      yield {
        type: 'usage',
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
          cachedPromptTokens,
        },
      };
      yield {
        type: 'done',
        ...(turnThoughtSignature
          ? { thoughtSignature: turnThoughtSignature, thought_signature: turnThoughtSignature }
          : {}),
      };
      return;
    }

    // 標準 generateContent 呼び出しからチャンクを配信
    const response = await ai.models.generateContent({
      model: request.model,
      contents: contents as any,
      config,
    });

    if (signal?.aborted) {
      throw new Error('GeminiProvider request aborted.');
    }

    const { thoughts, texts, thoughtSignatures } = extractGeminiResponseParts(response);
    let responseSignature: string | undefined =
      thoughtSignatures[0] ||
      (response as any)?.candidates?.[0]?.thoughtSignature ||
      (response as any)?.candidates?.[0]?.thought_signature ||
      (response as any)?.thoughtSignature ||
      (response as any)?.thought_signature;

    const toolCalls = extractGeminiFunctionCalls(response, responseSignature);
    for (const tc of toolCalls) {
      if (!tc.thoughtSignature && responseSignature) {
        tc.thoughtSignature = responseSignature;
        tc.thought_signature = responseSignature;
      } else if (tc.thoughtSignature && !responseSignature) {
        responseSignature = tc.thoughtSignature;
      }
    }

    for (const thoughtText of thoughts) {
      yield {
        type: 'thought_delta',
        delta: thoughtText,
        ...(responseSignature
          ? { thoughtSignature: responseSignature, thought_signature: responseSignature }
          : {}),
      };
    }
    for (const normalText of texts) {
      yield { type: 'text_delta', delta: normalText };
    }

    for (const tc of toolCalls) {
      const argsJson = JSON.stringify(tc.args || {});
      yield {
        type: 'tool_call_delta',
        delta: argsJson,
        toolCall: tc,
        ...(tc.thoughtSignature
          ? { thoughtSignature: tc.thoughtSignature, thought_signature: tc.thoughtSignature }
          : {}),
      };
      yield {
        type: 'tool_call',
        toolCall: tc,
        ...(tc.thoughtSignature
          ? { thoughtSignature: tc.thoughtSignature, thought_signature: tc.thoughtSignature }
          : {}),
      };
    }

    const usageMeta = (response as any).usageMetadata;
    const extracted = this.cacheManager.extractGeminiUsage(usageMeta);
    const promptTokens = extracted.promptTokens;
    const completionTokens = extracted.completionTokens;
    const cachedPromptTokens = extracted.cachedPromptTokens;
    yield {
      type: 'usage',
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        cachedPromptTokens,
      },
    };
    yield {
      type: 'done',
      ...(responseSignature
        ? { thoughtSignature: responseSignature, thought_signature: responseSignature }
        : {}),
    };
  }

  async countTokens(
    messages: LLMMessage[],
    systemInstruction?: string,
    model?: string
  ): Promise<number> {
    if (this.apiKey || this.aiClient) {
      try {
        const ai = this.aiClient || new GoogleGenAI({ apiKey: this.apiKey });
        if (typeof (ai.models as any)?.countTokens === 'function') {
          const contents = (messages || []).map((m) => ({
            role: m.role === 'tool' ? 'user' : m.role === 'system' ? 'user' : m.role,
            parts: Array.isArray(m.parts) && m.parts.length > 0
              ? m.parts.map((p) => {
                  const partObj: Record<string, any> = {};
                  if (typeof p.text === 'string') partObj.text = p.text;
                  if (p.functionCall) partObj.functionCall = p.functionCall;
                  if (p.functionResponse) partObj.functionResponse = p.functionResponse;
                  return Object.keys(partObj).length > 0 ? partObj : { text: '' };
                })
              : [{ text: typeof (m as any).content === 'string' ? (m as any).content : '' }],
          }));

          const resp = await (ai.models as any).countTokens({
            model: model || this.defaultModel,
            contents,
            ...(systemInstruction
              ? { config: { systemInstruction } }
              : {}),
          });

          const total =
            resp?.totalTokens ??
            resp?.total_tokens ??
            resp?.promptTokenCount;
          if (typeof total === 'number' && total > 0) {
            return total;
          }
        }
      } catch {
        // Fallback to local CJK/Code aware estimator on offline/rate-limit/auth errors
      }
    }
    return estimateMessagesTokens(messages, systemInstruction);
  }
}

export interface OpenAICompatibleProviderOptions {
  id?: string;
  baseUrl?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
  cacheManager?: ContextCacheManager;
  enablePromptCaching?: boolean;
  defaultModel?: string;
}

/**
 * 2. OpenAICompatibleProvider: OpenAI / OpenRouter / Ollama / vLLM / Anthropic互換エンドポイント対応プロバイダー (#27)
 */
export class OpenAICompatibleProvider implements ILLMProvider {
  readonly id: string;
  private baseUrl: string;
  private apiKey: string;
  private extraHeaders: Record<string, string>;
  private fetchImpl: typeof fetch;
  private cacheManager: ContextCacheManager;
  private enablePromptCaching: boolean;
  private defaultModel?: string;

  constructor(options: OpenAICompatibleProviderOptions = {}) {
    this.id = options.id || 'openai-compat';
    this.baseUrl = (options.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    const envKey =
      typeof (globalThis as any).process !== 'undefined'
        ? (this.id === 'anthropic'
            ? (globalThis as any).process.env?.ANTHROPIC_API_KEY
            : (globalThis as any).process.env?.OPENAI_API_KEY) || ''
        : '';
    this.apiKey = options.apiKey ?? envKey;
    this.extraHeaders = options.headers || {};
    this.fetchImpl = options.fetchImpl || fetch;
    this.cacheManager = options.cacheManager || new ContextCacheManager();
    this.enablePromptCaching = options.enablePromptCaching ?? true;
    this.defaultModel = options.defaultModel;
  }

  private convertMessages(request: LLMChatRequest): any[] {
    const out: any[] = [];
    if (request.systemInstruction) {
      out.push({ role: 'system', content: request.systemInstruction });
    }

    for (const msg of request.messages) {
      const textParts: string[] = [];
      const toolCalls: any[] = [];
      const toolResponses: any[] = [];

      for (const p of msg.parts) {
        if (typeof p.text === 'string' && !p.thought) {
          textParts.push(p.text);
        }
        if (p.functionCall) {
          toolCalls.push({
            id: p.functionCall.id || `call_${toolCalls.length + 1}`,
            type: 'function',
            function: {
              name: p.functionCall.name,
              arguments: JSON.stringify(p.functionCall.args || {}),
            },
          });
        }
        if (p.functionResponse) {
          toolResponses.push({
            role: 'tool',
            tool_call_id: p.functionResponse.id || 'call_1',
            name: p.functionResponse.name,
            content: JSON.stringify(p.functionResponse.response || {}),
          });
        }
      }

      if (toolResponses.length > 0) {
        out.push(...toolResponses);
      } else if (toolCalls.length > 0) {
        out.push({
          role: 'assistant',
          content: textParts.join('\n') || null,
          tool_calls: toolCalls,
        });
      } else {
        out.push({
          role: msg.role === 'model' ? 'assistant' : msg.role,
          content: textParts.join('\n'),
        });
      }
    }

    return out;
  }

  /**
   * OpenAI 互換 API 向けにツール定義をフォーマット・正規化する (静的メソッド)
   */
  static formatTools(tools: any[]): any[] {
    return formatOpenAITools(tools);
  }

  /**
   * OpenAI 互換 API 向けにツール定義をフォーマット・正規化する (インスタンスメソッド)
   */
  formatTools(tools: any[]): any[] {
    return OpenAICompatibleProvider.formatTools(tools);
  }

  async *streamChat(
    request: LLMChatRequest,
    signal?: AbortSignal
  ): AsyncGenerator<LLMStreamChunk, void, unknown> {
    if (signal?.aborted) {
      throw new Error('OpenAICompatibleProvider stream aborted.');
    }

    let targetModel = request.model;
    if (this.id && targetModel.startsWith(`${this.id}/`)) {
      targetModel = targetModel.slice(this.id.length + 1);
    }

    const body: Record<string, any> = {
      model: targetModel,
      messages: this.convertMessages(request),
    };

    if (request.tools && request.tools.length > 0) {
      const stableTools = this.cacheManager.stabilizeTools(request.tools);
      const formatted = this.formatTools(stableTools || []);
      if (formatted.length > 0) {
        body.tools = formatted;
      }
    }

    if (this.enablePromptCaching) {
      this.cacheManager.applyPromptCacheControl(body);
    }


    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.extraHeaders,
    };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenAICompatibleProvider HTTP ${response.status}: ${errText}`);
    }

    if (response.headers?.get?.('content-type')?.includes('text/event-stream') && response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let promptTokens = 0;
      let completionTokens = 0;
      let cachedPromptTokens = 0;
      let cacheCreationPromptTokens = 0;
      const toolCallsMap: Map<number, { id: string; name: string; argsRaw: string }> = new Map();

      while (true) {
        if (signal?.aborted) {
          throw new Error('OpenAICompatibleProvider stream aborted.');
        }
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line || !line.startsWith('data:')) continue;
          const payloadStr = line.slice(5).trim();
          if (payloadStr === '[DONE]') continue;

          try {
            const eventData: any = JSON.parse(payloadStr);
            if (eventData?.usage) {
              const extracted = this.cacheManager.extractOpenAIUsage(eventData.usage);
              promptTokens = extracted.promptTokens || promptTokens;
              completionTokens = extracted.completionTokens || completionTokens;
              cachedPromptTokens = extracted.cachedPromptTokens || cachedPromptTokens;
              cacheCreationPromptTokens = extracted.cacheCreationPromptTokens || cacheCreationPromptTokens;
            }
            const delta = eventData?.choices?.[0]?.delta;
            if (!delta) continue;

            const reasoningDelta = delta.reasoning_content || delta.reasoning;
            if (typeof reasoningDelta === 'string' && reasoningDelta.length > 0) {
              yield { type: 'thought_delta', delta: reasoningDelta };
            }
            if (typeof delta.content === 'string' && delta.content.length > 0) {
              yield { type: 'text_delta', delta: delta.content };
            }
            if (Array.isArray(delta.tool_calls)) {
              for (const tcDelta of delta.tool_calls) {
                const idx = typeof tcDelta.index === 'number' ? tcDelta.index : 0;
                const existing = toolCallsMap.get(idx) || {
                  id: tcDelta.id || `call_${idx + 1}`,
                  name: tcDelta.function?.name || 'unknown',
                  argsRaw: '',
                };
                if (tcDelta.id) existing.id = tcDelta.id;
                if (tcDelta.function?.name) existing.name = tcDelta.function.name;
                if (typeof tcDelta.function?.arguments === 'string') {
                  existing.argsRaw += tcDelta.function.arguments;
                  yield {
                    type: 'tool_call_delta',
                    delta: tcDelta.function.arguments,
                    toolCall: { id: existing.id, name: existing.name, args: {} },
                  };
                }
                toolCallsMap.set(idx, existing);
              }
            }
          } catch {
            // ignore malformed SSE chunk
          }
        }
      }

      for (const tc of toolCallsMap.values()) {
        let parsedArgs: Record<string, any> = {};
        try {
          parsedArgs = tc.argsRaw ? JSON.parse(tc.argsRaw) : {};
        } catch {
          parsedArgs = {};
        }
        yield {
          type: 'tool_call',
          toolCall: { id: tc.id, name: tc.name, args: parsedArgs },
        };
      }

      const finalPrompt =
        promptTokens || estimateMessagesTokens(request.messages, request.systemInstruction);
      const finalComp = completionTokens || 100;
      yield {
        type: 'usage',
        usage: {
          promptTokens: finalPrompt,
          completionTokens: finalComp,
          totalTokens: finalPrompt + finalComp,
          cachedPromptTokens,
          cacheCreationPromptTokens,
        },
      };
      yield { type: 'done' };
      return;
    }

    const data: any = await response.json();
    const choice = data?.choices?.[0]?.message;

    // 思考フィールド (reasoning_content / reasoning) のサポート
    const reasoning = choice?.reasoning_content || choice?.reasoning;
    if (typeof reasoning === 'string' && reasoning.trim()) {
      yield { type: 'thought_delta', delta: reasoning };
    }

    if (typeof choice?.content === 'string' && choice.content.length > 0) {
      yield { type: 'text_delta', delta: choice.content };
    }

    if (Array.isArray(choice?.tool_calls)) {
      for (const tc of choice.tool_calls) {
        const fnName = tc?.function?.name || 'unknown';
        const rawArgs = tc?.function?.arguments || '{}';
        let parsedArgs: Record<string, any> = {};
        try {
          parsedArgs = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs;
        } catch {
          parsedArgs = {};
        }

        yield {
          type: 'tool_call_delta',
          delta: typeof rawArgs === 'string' ? rawArgs : JSON.stringify(rawArgs),
          toolCall: { id: tc.id, name: fnName, args: parsedArgs },
        };
        yield {
          type: 'tool_call',
          toolCall: { id: tc.id, name: fnName, args: parsedArgs },
        };
      }
    }

    const extracted = this.cacheManager.extractOpenAIUsage(data?.usage);
    const finalPrompt =
      extracted.promptTokens || estimateMessagesTokens(request.messages, request.systemInstruction);
    const finalComp = extracted.completionTokens || 100;
    yield {
      type: 'usage',
      usage: {
        promptTokens: finalPrompt,
        completionTokens: finalComp,
        totalTokens: finalPrompt + finalComp,
        cachedPromptTokens: extracted.cachedPromptTokens,
        cacheCreationPromptTokens: extracted.cacheCreationPromptTokens,
      },
    };
    yield { type: 'done' };
  }

  async countTokens(
    messages: LLMMessage[],
    systemInstruction?: string,
    model?: string
  ): Promise<number> {
    const rawModel = model || this.defaultModel || '';
    const targetModel =
      this.id && rawModel.startsWith(`${this.id}/`)
        ? rawModel.slice(this.id.length + 1)
        : rawModel;
    const isAnthropicTarget =
      (this.id === 'anthropic' || this.baseUrl.includes('anthropic.com')) &&
      (this.id === 'anthropic' || targetModel.toLowerCase().includes('claude'));

    if (isAnthropicTarget && this.apiKey) {
      try {
        const anthropicBase = this.baseUrl.includes('anthropic.com')
          ? this.baseUrl.replace(/\/v1\/?$/, '') + '/v1'
          : 'https://api.anthropic.com/v1';

        const anthropicMessages = (messages || []).map((m) => {
          const textParts: string[] = [];
          for (const p of m.parts || []) {
            if (typeof p.text === 'string' && !p.thought) {
              textParts.push(p.text);
            } else if (p.functionCall) {
              textParts.push(
                `[tool_use: ${p.functionCall.name}(${JSON.stringify(p.functionCall.args || {})})]`
              );
            } else if (p.functionResponse) {
              textParts.push(
                `[tool_result: ${p.functionResponse.name} -> ${JSON.stringify(p.functionResponse.response || {})}]`
              );
            }
          }
          const contentStr =
            textParts.join('\n') ||
            (typeof (m as any).content === 'string' ? (m as any).content : '');
          return {
            role: m.role === 'model' || m.role === 'assistant' ? 'assistant' : 'user',
            content: contentStr || ' ',
          };
        });

        const resp = await this.fetchImpl(`${anthropicBase}/messages/count_tokens`, {
          method: 'POST',
          headers: {
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
            ...this.extraHeaders,
          },
          body: JSON.stringify({
            model: targetModel || 'claude-3-7-sonnet-20250219',
            ...(systemInstruction ? { system: systemInstruction } : {}),
            messages: anthropicMessages,
          }),
        });

        if (resp.ok) {
          const data: any = await resp.json();
          if (typeof data?.input_tokens === 'number' && data.input_tokens > 0) {
            return data.input_tokens;
          }
        }
      } catch {
        // Fallback below on network/CORS/auth failure
      }
    }

    const isOpenAITarget =
      this.id === 'openai' ||
      this.id === 'openai-compat' ||
      this.baseUrl.includes('openai.com') ||
      /^(gpt-|o1|o3|o4)/i.test(targetModel);

    if (isOpenAITarget && !isAnthropicTarget) {
      return countOpenAITokensWithTiktoken(
        messages,
        systemInstruction,
        targetModel || 'gpt-4o'
      );
    }

    return estimateMessagesTokens(messages, systemInstruction);
  }
}

export interface OpenRouterProviderOptions extends OpenAICompatibleProviderOptions {}

/**
 * 3. OpenRouterProvider: OpenRouter推論ゲートウェイプロバイダー
 * - エンドポイント: https://openrouter.ai/api/v1
 * - 環境変数: OPENROUTER_API_KEY / OPENROUTER_BASE_URL
 * - 必須ヘッダー: HTTP-Referer, X-Title
 */
export class OpenRouterProvider extends OpenAICompatibleProvider {
  constructor(options: OpenRouterProviderOptions = {}) {
    const envKey =
      typeof (globalThis as any).process !== 'undefined'
        ? (globalThis as any).process.env?.OPENROUTER_API_KEY || ''
        : '';
    const envBase =
      typeof (globalThis as any).process !== 'undefined'
        ? (globalThis as any).process.env?.OPENROUTER_BASE_URL || ''
        : '';
    super({
      id: options.id || 'openrouter',
      baseUrl: options.baseUrl || envBase || 'https://openrouter.ai/api/v1',
      apiKey: options.apiKey ?? envKey,
      headers: {
        'HTTP-Referer': 'https://github.com/noimzip/melonpan-harness',
        'X-Title': 'Melonpan Harness',
        ...options.headers,
      },
      fetchImpl: options.fetchImpl,
    });
  }
}

export interface OrcaRouterProviderOptions extends OpenAICompatibleProviderOptions {}

/**
 * 4. OrcaRouterProvider: OrcaRouter推論ゲートウェイプロバイダー
 * - エンドポイント: https://api.orcarouter.ai/v1
 * - 環境変数: ORCAROUTER_API_KEY / ORCAROUTER_BASE_URL
 */
export class OrcaRouterProvider extends OpenAICompatibleProvider {
  constructor(options: OrcaRouterProviderOptions = {}) {
    const envKey =
      typeof (globalThis as any).process !== 'undefined'
        ? (globalThis as any).process.env?.ORCAROUTER_API_KEY || ''
        : '';
    const envBase =
      typeof (globalThis as any).process !== 'undefined'
        ? (globalThis as any).process.env?.ORCAROUTER_BASE_URL || ''
        : '';
    super({
      id: options.id || 'orcarouter',
      baseUrl: options.baseUrl || envBase || 'https://api.orcarouter.ai/v1',
      apiKey: options.apiKey ?? envKey,
      headers: options.headers,
      fetchImpl: options.fetchImpl,
    });
  }
}

export interface GroqProviderOptions extends OpenAICompatibleProviderOptions {}

/**
 * 5. GroqProvider: Groq LPU高速推論プロバイダー
 * - エンドポイント: https://api.groq.com/openai/v1
 * - 環境変数: GROQ_API_KEY / GROQ_BASE_URL
 */
export class GroqProvider extends OpenAICompatibleProvider {
  constructor(options: GroqProviderOptions = {}) {
    const envKey =
      typeof (globalThis as any).process !== 'undefined'
        ? (globalThis as any).process.env?.GROQ_API_KEY || ''
        : '';
    const envBase =
      typeof (globalThis as any).process !== 'undefined'
        ? (globalThis as any).process.env?.GROQ_BASE_URL || ''
        : '';
    super({
      id: options.id || 'groq',
      baseUrl: options.baseUrl || envBase || 'https://api.groq.com/openai/v1',
      apiKey: options.apiKey ?? envKey,
      headers: options.headers,
      fetchImpl: options.fetchImpl,
    });
  }
}

export interface SurplusProviderOptions extends OpenAICompatibleProviderOptions {
  minDiscount?: number;
}

/**
 * 6. SurplusProvider: Surplus Intelligence 分散型インファレンスマーケットプレイスプロバイダー
 * - エンドポイント: https://api.surplusintelligence.ai/v1 (または /min{N}/v1)
 * - 環境変数: SURPLUS_API_KEY / SURPLUS_BASE_URL / SURPLUS_MIN_DISCOUNT
 */
export class SurplusProvider extends OpenAICompatibleProvider {
  constructor(options: SurplusProviderOptions = {}) {
    const envKey =
      typeof (globalThis as any).process !== 'undefined'
        ? (globalThis as any).process.env?.SURPLUS_API_KEY || ''
        : '';
    const envBase =
      typeof (globalThis as any).process !== 'undefined'
        ? (globalThis as any).process.env?.SURPLUS_BASE_URL || ''
        : '';
    const envMinDiscount =
      typeof (globalThis as any).process !== 'undefined' &&
      (globalThis as any).process.env?.SURPLUS_MIN_DISCOUNT
        ? Number((globalThis as any).process.env.SURPLUS_MIN_DISCOUNT)
        : undefined;
    const discount = options.minDiscount ?? envMinDiscount;
    const defaultBase = discount
      ? `https://api.surplusintelligence.ai/min${discount}/v1`
      : 'https://api.surplusintelligence.ai/v1';

    super({
      id: options.id || 'surplus',
      baseUrl: options.baseUrl || envBase || defaultBase,
      apiKey: options.apiKey ?? envKey,
      headers: options.headers,
      fetchImpl: options.fetchImpl,
    });
  }
}

/**
 * 7. SimulatedProvider: オフライン・テスト用の決定論的ストリーミングプロバイダー (#27)
 */
export class SimulatedProvider implements ILLMProvider {
  readonly id = 'simulated';
  private customTurns: Array<(req: LLMChatRequest, turnIndex: number) => LLMStreamChunk[]>;
  private turnCounter = 0;

  constructor(
    customTurns: Array<(req: LLMChatRequest, turnIndex: number) => LLMStreamChunk[]> = []
  ) {
    this.customTurns = customTurns;
  }

  async *streamChat(
    request: LLMChatRequest,
    signal?: AbortSignal
  ): AsyncGenerator<LLMStreamChunk, void, unknown> {
    if (signal?.aborted) {
      throw new Error('SimulatedProvider stream aborted.');
    }

    const idx = this.turnCounter++;
    if (idx < this.customTurns.length) {
      const chunks = this.customTurns[idx]!(request, idx);
      for (const chunk of chunks) {
        if (signal?.aborted) {
          throw new Error('SimulatedProvider stream aborted.');
        }
        yield chunk;
      }
      return;
    }

    yield {
      type: 'thought_delta',
      delta: 'Analyzing request in simulated provider...',
    };
    yield {
      type: 'tool_call_delta',
      delta: '{"summary":"Simulated task complete"}',
      toolCall: {
        id: `sim-call-${idx}`,
        name: 'complete_task',
        args: { summary: 'Simulated task complete' },
      },
    };
    yield {
      type: 'tool_call',
      toolCall: {
        id: `sim-call-${idx}`,
        name: 'complete_task',
        args: { summary: 'Simulated task complete' },
      },
    };
    yield {
      type: 'usage',
      usage: { promptTokens: 200, completionTokens: 80, totalTokens: 280 },
    };
    yield { type: 'done' };
  }

  async countTokens(messages: LLMMessage[], systemInstruction?: string): Promise<number> {
    return estimateMessagesTokens(messages, systemInstruction);
  }
}

/**
 * プラガブル LLM プロバイダーレジストリ (`ProviderRegistry`) (Issue #27)
 */
export class ProviderRegistry {
  private providers: Map<string, ILLMProvider> = new Map();
  private defaultProviderId: string = 'gemini';

  constructor(initialProviders?: ILLMProvider[]) {
    const defaults = initialProviders ?? [
      new GeminiProvider(),
      new OpenAICompatibleProvider({ id: 'openai' }),
      new OpenAICompatibleProvider({ id: 'openai-compat' }),
      new OpenAICompatibleProvider({ id: 'anthropic' }),
      new OpenRouterProvider(),
      new OrcaRouterProvider(),
      new GroqProvider(),
      new SurplusProvider(),
      new SimulatedProvider(),
    ];
    for (const p of defaults) {
      this.registerProvider(p);
    }
  }

  registerProvider(provider: ILLMProvider): this {
    this.providers.set(provider.id, provider);
    return this;
  }

  unregisterProvider(id: string): boolean {
    return this.providers.delete(id);
  }

  getProvider(id?: string): ILLMProvider | undefined {
    return this.providers.get(id || this.defaultProviderId);
  }

  listProviders(): string[] {
    return Array.from(this.providers.keys());
  }

  setDefaultProvider(id: string): void {
    if (!this.providers.has(id)) {
      throw new Error(`Provider "${id}" is not registered.`);
    }
    this.defaultProviderId = id;
  }

  getDefaultProviderId(): string {
    return this.defaultProviderId;
  }
}

export * from './discovery.js';
export {
  formatOpenAITools,
  formatToolParameters,
  normalizeJsonSchema,
  normalizeJsonSchemaType,
} from '../tools/schema-converter.js';


