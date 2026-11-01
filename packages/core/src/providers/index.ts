import { GoogleGenAI } from '@google/genai';
import {
  ILLMProvider,
  LLMChatRequest,
  LLMMessage,
  LLMStreamChunk,
} from '../types.js';
import { estimateMessagesTokens } from '../session/context-strategy.js';

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
} {
  const thoughts: string[] = [];
  const texts: string[] = [];

  const parts = response?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts) && parts.length > 0) {
    for (const part of parts) {
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

  return { thoughts, texts };
}

export interface GeminiProviderOptions {
  apiKey?: string;
  useStreamingApi?: boolean;
}

/**
 * 1. GeminiProvider: `@google/genai` ベースのプラガブル LLM プロバイダー (Issues #27, #4)
 * - `candidates?.[0]?.content?.parts` から `part.thought === true` を正確に抽出 (#4)
 * - `THOUGHT_DELTA`, `TEXT_DELTA`, `TOOL_CALL_DELTA` チャンクの送出と `AbortSignal` 対応 (#27)
 */
export class GeminiProvider implements ILLMProvider {
  readonly id = 'gemini';
  private apiKey: string;
  private useStreamingApi: boolean;

  constructor(options: GeminiProviderOptions = {}) {
    const envApiKey =
      typeof (globalThis as any).process !== 'undefined'
        ? (globalThis as any).process.env?.GEMINI_API_KEY
        : '';
    this.apiKey = options.apiKey || envApiKey || '';
    this.useStreamingApi = options.useStreamingApi ?? false;
  }

  async *streamChat(
    request: LLMChatRequest,
    signal?: AbortSignal
  ): AsyncGenerator<LLMStreamChunk, void, unknown> {
    if (signal?.aborted) {
      throw new Error('GeminiProvider streamChat aborted.');
    }

    const ai = new GoogleGenAI({ apiKey: this.apiKey });

    const config: Record<string, any> = {};
    if (request.systemInstruction) {
      config.systemInstruction = request.systemInstruction;
    }
    if (request.tools && request.tools.length > 0) {
      config.tools = [{ functionDeclarations: request.tools }];
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

    const contents = request.messages.map((m) => ({
      role: m.role === 'tool' ? 'user' : m.role === 'system' ? 'user' : m.role,
      parts: m.parts,
    }));

    if (this.useStreamingApi && typeof (ai.models as any).generateContentStream === 'function') {
      const streamResp = await ai.models.generateContentStream({
        model: request.model,
        contents: contents as any,
        config,
      });

      let promptTokens = 0;
      let completionTokens = 0;

      for await (const chunk of streamResp) {
        if (signal?.aborted) {
          throw new Error('GeminiProvider stream aborted.');
        }

        const usageMeta = (chunk as any).usageMetadata;
        if (usageMeta) {
          promptTokens = usageMeta.promptTokenCount || promptTokens;
          completionTokens = usageMeta.candidatesTokenCount || completionTokens;
        }

        const { thoughts, texts } = extractGeminiResponseParts(chunk);
        for (const t of thoughts) {
          yield { type: 'thought_delta', delta: t };
        }
        for (const txt of texts) {
          yield { type: 'text_delta', delta: txt };
        }

        const fcs = (chunk as any).functionCalls;
        if (Array.isArray(fcs)) {
          for (const fc of fcs) {
            const argsJson = JSON.stringify(fc.args || {});
            yield {
              type: 'tool_call_delta',
              delta: argsJson,
              toolCall: { id: fc.id, name: fc.name, args: fc.args || {} },
            };
            yield {
              type: 'tool_call',
              toolCall: { id: fc.id, name: fc.name, args: fc.args || {} },
            };
          }
        }
      }

      yield {
        type: 'usage',
        usage: {
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
        },
      };
      yield { type: 'done' };
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

    const { thoughts, texts } = extractGeminiResponseParts(response);
    for (const thoughtText of thoughts) {
      yield { type: 'thought_delta', delta: thoughtText };
    }
    for (const normalText of texts) {
      yield { type: 'text_delta', delta: normalText };
    }

    const functionCalls = (response as any).functionCalls;
    if (Array.isArray(functionCalls)) {
      for (const fc of functionCalls) {
        const argsJson = JSON.stringify(fc.args || {});
        yield {
          type: 'tool_call_delta',
          delta: argsJson,
          toolCall: { id: fc.id, name: fc.name, args: fc.args || {} },
        };
        yield {
          type: 'tool_call',
          toolCall: { id: fc.id, name: fc.name, args: fc.args || {} },
        };
      }
    }

    const usageMeta = (response as any).usageMetadata;
    const promptTokens = usageMeta?.promptTokenCount || 0;
    const completionTokens = usageMeta?.candidatesTokenCount || 0;
    yield {
      type: 'usage',
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
    };
    yield { type: 'done' };
  }

  async countTokens(messages: LLMMessage[], systemInstruction?: string): Promise<number> {
    return estimateMessagesTokens(messages, systemInstruction);
  }
}

export interface OpenAICompatibleProviderOptions {
  id?: string;
  baseUrl?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
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

  constructor(options: OpenAICompatibleProviderOptions = {}) {
    this.id = options.id || 'openai-compat';
    this.baseUrl = (options.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    const envKey =
      typeof (globalThis as any).process !== 'undefined'
        ? (globalThis as any).process.env?.OPENAI_API_KEY || ''
        : '';
    this.apiKey = options.apiKey ?? envKey;
    this.extraHeaders = options.headers || {};
    this.fetchImpl = options.fetchImpl || fetch;
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

  async *streamChat(
    request: LLMChatRequest,
    signal?: AbortSignal
  ): AsyncGenerator<LLMStreamChunk, void, unknown> {
    if (signal?.aborted) {
      throw new Error('OpenAICompatibleProvider stream aborted.');
    }

    const body: Record<string, any> = {
      model: request.model,
      messages: this.convertMessages(request),
    };

    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((fn) => ({
        type: 'function',
        function: {
          name: fn.name,
          description: fn.description,
          parameters: fn.parameters,
        },
      }));
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
              promptTokens = eventData.usage.prompt_tokens ?? promptTokens;
              completionTokens = eventData.usage.completion_tokens ?? completionTokens;
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

    const promptTokens = data?.usage?.prompt_tokens ?? estimateMessagesTokens(request.messages, request.systemInstruction);
    const completionTokens = data?.usage?.completion_tokens ?? 100;
    yield {
      type: 'usage',
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
    };
    yield { type: 'done' };
  }

  async countTokens(messages: LLMMessage[], systemInstruction?: string): Promise<number> {
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

/**
 * 6. SimulatedProvider: オフライン・テスト用の決定論的ストリーミングプロバイダー (#27)
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
      new OpenAICompatibleProvider(),
      new OpenRouterProvider(),
      new OrcaRouterProvider(),
      new GroqProvider(),
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

