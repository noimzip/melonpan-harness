import { GoogleGenAI } from '@google/genai';
import { MELONPAN_TOOLS } from '../tools/tool-definitions.js';
import {
  ModelProvider,
  ProviderMessageResponse,
  ProviderSession,
  ProviderSessionOptions,
  ProviderToolResult,
  PruneHistoryResult,
} from './provider-interface.js';

/**
 * 過去ターンの chat.history を走査し、write_file の肥大化した content を
 * <Content preserved in VFS: N chars> にマスクして Context Pruning を行う。
 */
export function pruneGeminiChatHistory(
  history: any[],
  thresholdChars: number = 200
): PruneHistoryResult {
  let prunedCallsCount = 0;
  let savedCharsCount = 0;
  if (!Array.isArray(history)) return { prunedCallsCount: 0, savedCharsCount: 0 };

  for (const item of history) {
    if (!item?.parts || !Array.isArray(item.parts)) continue;
    for (const part of item.parts) {
      if (part?.functionCall && part.functionCall.name === 'write_file') {
        const content = part.functionCall.args?.content;
        if (
          typeof content === 'string' &&
          content.length >= thresholdChars &&
          !content.startsWith('<Content preserved in VFS:')
        ) {
          const originalLen = content.length;
          const replacement = `<Content preserved in VFS: ${originalLen} chars>`;
          part.functionCall.args.content = replacement;
          prunedCallsCount++;
          savedCharsCount += originalLen - replacement.length;
        }
      }
    }
  }
  return { prunedCallsCount, savedCharsCount };
}

export class GeminiProviderSession implements ProviderSession {
  private chat: any;

  constructor(chat: any) {
    this.chat = chat;
  }

  async sendMessage(
    input: string | ProviderToolResult[]
  ): Promise<ProviderMessageResponse> {
    let messagePayload: any;

    if (typeof input === 'string') {
      messagePayload = input;
    } else if (Array.isArray(input)) {
      messagePayload = input.map((r) => ({
        functionResponse: {
          name: r.name,
          response: r.isError ? { error: r.output } : { output: r.output },
          id: r.callId,
        },
      }));
    } else {
      messagePayload = String(input);
    }

    const response = await this.chat.sendMessage({
      message: messagePayload,
    });

    const text = response.text?.trim() || undefined;

    const toolCalls = response.functionCalls?.map((call: any) => ({
      id: call.id || `call-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: call.name,
      args: call.args || {},
    }));

    const usageMeta = (response as any).usageMetadata;
    const usage = usageMeta
      ? {
          promptTokens: usageMeta.promptTokenCount || 0,
          completionTokens: usageMeta.candidatesTokenCount || 0,
          totalTokens:
            (usageMeta.promptTokenCount || 0) +
            (usageMeta.candidatesTokenCount || 0),
        }
      : undefined;

    return {
      text,
      toolCalls,
      usage,
    };
  }

  pruneHistory(thresholdChars: number = 200): PruneHistoryResult {
    const history = (this.chat as any)?.history;
    return pruneGeminiChatHistory(history, thresholdChars);
  }
}

export interface GeminiProviderOptions {
  apiKey?: string;
}

export class GeminiProvider implements ModelProvider {
  private apiKey: string;

  constructor(options: GeminiProviderOptions = {}) {
    const envApiKey =
      typeof (globalThis as any).process !== 'undefined'
        ? (globalThis as any).process.env?.GEMINI_API_KEY
        : '';
    this.apiKey = options.apiKey || envApiKey || '';
  }

  createSession(options: ProviderSessionOptions): ProviderSession {
    const ai = new GoogleGenAI({ apiKey: this.apiKey });

    const config: Record<string, any> = {
      systemInstruction: options.systemInstruction,
      tools: MELONPAN_TOOLS,
    };

    const thinkingLevelUpper = (options.thinkingLevel || 'high').toUpperCase();
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

    const chat = ai.chats.create({
      model: options.model,
      config,
    });

    return new GeminiProviderSession(chat);
  }
}
