import { FunctionDeclaration, LLMMessage, LLMChatRequest, TokenUsage } from '../types.js';

export interface ContextCacheInfo {
  name: string;
  model: string;
  fingerprint: string;
  expireTime?: string;
  totalTokenCount?: number;
  createdAt: number;
  ttlSeconds: number;
}

export interface ContextCacheManagerOptions {
  /** コンテキストキャッシュの有効期限 (秒単位, デフォルト: 300秒 = 5分) */
  ttlSeconds?: number;
  /** Gemini Context Cache を有効化するか (デフォルト: true) */
  enableGeminiCache?: boolean;
  /** Anthropic / OpenRouter Prompt Caching (cache_control: ephemeral) を有効化するか (デフォルト: true) */
  enablePromptCaching?: boolean;
}

/**
 * 簡易文字列ハッシュ（キャッシュフィンガープリント用）
 */
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

/**
 * ContextCacheManager
 *
 * 1. プレフィックス順序の安定化 (Prefix Stability):
 *    - ツール定義やシステム指示を決定論的順序で正規化し、プロバイダー側のプロンプトキャッシュヒット率を最大化する。
 * 2. Gemini Context Caching (`ai.caches.create`):
 *    - 長大なシステムプロンプトやツール定義をGemini Context Cacheに先行格納し、全ターンで cachedContent を再利用。
 *    - 最小トークン数未達時やAPI未対応時の安全なフォールバック。
 * 3. OpenAI / OpenRouter Anthropic Prompt Caching:
 *    - システムプロンプトやツール定義へ `cache_control: { type: "ephemeral" }` を自動付与し、キャッシュ読取コストを約90%削減。
 * 4. キャッシュトークン計測 & 燃費最適化:
 *    - `cachedPromptTokens`, `cacheCreationPromptTokens` を正確に抽出し、累計消費トークンと推定費用を最適化。
 */
export class ContextCacheManager {
  private activeCaches: Map<string, ContextCacheInfo> = new Map();
  private ttlSeconds: number;
  private enableGeminiCache: boolean;
  private enablePromptCaching: boolean;

  constructor(options: ContextCacheManagerOptions = {}) {
    this.ttlSeconds = options.ttlSeconds ?? 300;
    this.enableGeminiCache = options.enableGeminiCache ?? true;
    this.enablePromptCaching = options.enablePromptCaching ?? true;
  }

  /**
   * ツール定義配列をアルファベット順にソートし、シリアライズ順序を固定化してプレフィックスキャッシュの無効化を防止する
   */
  stabilizeTools(tools?: FunctionDeclaration[]): FunctionDeclaration[] | undefined {
    if (!tools || tools.length === 0) return tools;
    return [...tools].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
  }

  /**
   * システム指示およびツール定義から決定論的なフィンガープリントを生成
   */
  generateFingerprint(model: string, systemInstruction?: string, tools?: any[]): string {
    const stableTools = this.stabilizeTools(tools);
    const key = `${model}:::${systemInstruction || ''}:::${JSON.stringify(stableTools || [])}`;
    return hashString(key);
  }

  /**
   * Gemini Context Cache の取得または作成 (`ai.caches.create`)
   */
  async getOrCreateGeminiCache(options: {
    ai: any;
    model: string;
    systemInstruction?: string;
    tools?: any[];
    displayName?: string;
  }): Promise<string | undefined> {
    if (!this.enableGeminiCache) return undefined;
    const { ai, model, systemInstruction, tools, displayName } = options;
    if (!ai || !ai.caches || typeof ai.caches.create !== 'function') return undefined;

    const fingerprint = this.generateFingerprint(model, systemInstruction, tools);
    const existing = this.activeCaches.get(fingerprint);
    if (existing) {
      const now = Date.now();
      const expiresAt = existing.createdAt + existing.ttlSeconds * 1000;
      if (now < expiresAt - 30_000) {
        return existing.name;
      }
      this.activeCaches.delete(fingerprint);
    }

    try {
      const config: Record<string, any> = {
        ttl: `${this.ttlSeconds}s`,
        displayName: displayName || `melonpan-cache-${fingerprint}`,
      };
      if (systemInstruction) {
        config.systemInstruction = systemInstruction;
      }
      if (tools && tools.length > 0) {
        config.tools = [{ functionDeclarations: this.stabilizeTools(tools) }];
      }

      const cache = await ai.caches.create({
        model,
        config,
      });

      if (cache?.name) {
        this.activeCaches.set(fingerprint, {
          name: cache.name,
          model,
          fingerprint,
          expireTime: cache.expireTime,
          totalTokenCount: cache.usageMetadata?.totalTokenCount,
          createdAt: Date.now(),
          ttlSeconds: this.ttlSeconds,
        });
        return cache.name;
      }
    } catch {
      // 最小トークン数未達やパーミッションエラー等でキャッシュ作成に失敗した場合は
      // 通常の非キャッシュ実行にフォールバック（例外を送出せず続行）
    }

    return undefined;
  }

  /**
   * OpenAI / OpenRouter 互換メッセージ配列およびツール配列に Anthropic 互換の prompt caching マーカー
   * (`cache_control: { type: 'ephemeral' }`) を付与する
   */
  applyPromptCacheControl(body: {
    messages?: any[];
    tools?: any[];
    [key: string]: any;
  }): void {
    if (!this.enablePromptCaching) return;
    if (!Array.isArray(body.messages)) return;

    // 1. システムプロンプト (role: 'system') に cache_control を付与
    const systemMsg = body.messages.find((m) => m?.role === 'system');
    if (systemMsg) {
      if (typeof systemMsg.content === 'string') {
        systemMsg.cache_control = { type: 'ephemeral' };
      } else if (Array.isArray(systemMsg.content) && systemMsg.content.length > 0) {
        const lastPart = systemMsg.content[systemMsg.content.length - 1];
        lastPart.cache_control = { type: 'ephemeral' };
      }
    }

    // 2. ツール定義の末尾に cache_control を付与 (Anthropic / OpenRouter 規約)
    if (Array.isArray(body.tools) && body.tools.length > 0) {
      const lastTool = body.tools[body.tools.length - 1];
      if (lastTool && typeof lastTool === 'object') {
        lastTool.cache_control = { type: 'ephemeral' };
      }
    }
  }

  /**
   * Gemini usageMetadata からキャッシュ統計を抽出
   */
  extractGeminiUsage(usageMeta: any): {
    promptTokens: number;
    completionTokens: number;
    cachedPromptTokens: number;
    billedPromptTokens: number;
  } {
    const promptTokens = usageMeta?.promptTokenCount || 0;
    const completionTokens = usageMeta?.candidatesTokenCount || 0;
    const cachedPromptTokens = usageMeta?.cachedContentTokenCount || 0;
    const billedPromptTokens = Math.max(0, promptTokens - cachedPromptTokens);

    return {
      promptTokens,
      completionTokens,
      cachedPromptTokens,
      billedPromptTokens,
    };
  }

  /**
   * OpenAI / OpenRouter usage からキャッシュ統計を抽出
   */
  extractOpenAIUsage(usage: any): {
    promptTokens: number;
    completionTokens: number;
    cachedPromptTokens: number;
    cacheCreationPromptTokens: number;
    billedPromptTokens: number;
  } {
    const promptTokens = usage?.prompt_tokens ?? 0;
    const completionTokens = usage?.completion_tokens ?? 0;
    const cachedPromptTokens =
      usage?.prompt_tokens_details?.cached_tokens ??
      usage?.cache_read_input_tokens ??
      usage?.prompt_cache_hit_tokens ??
      0;
    const cacheCreationPromptTokens =
      usage?.cache_creation_input_tokens ?? 0;
    const billedPromptTokens = Math.max(0, promptTokens - cachedPromptTokens);

    return {
      promptTokens,
      completionTokens,
      cachedPromptTokens,
      cacheCreationPromptTokens,
      billedPromptTokens,
    };
  }

  /**
   * セッション終了時に全アクティブキャッシュを破棄
   */
  async cleanup(ai?: any): Promise<void> {
    if (ai?.caches && typeof ai.caches.delete === 'function') {
      for (const cache of this.activeCaches.values()) {
        try {
          await ai.caches.delete({ name: cache.name });
        } catch {
          // ignore cleanup failures
        }
      }
    }
    this.activeCaches.clear();
  }
}
