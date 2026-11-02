import { createHash } from 'node:crypto';
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
  /** コンテキストキャッシュの有効期限 (秒単位, デフォルト: 1800秒 = 30分) */
  ttlSeconds?: number;
  /** Gemini Context Cache を有効化するか (デフォルト: true) */
  enableGeminiCache?: boolean;
  /** Anthropic / OpenRouter Prompt Caching (cache_control: ephemeral) を有効化するか (デフォルト: true) */
  enablePromptCaching?: boolean;
  /**
   * Issue #58: Gemini 明示的キャッシュ (`ai.caches.create`) を呼び出す最小推定トークン数。
   * 未達の場合は無駄な API 往復エラーを避け、Gemini Implicit Prefix Caching に即時委譲する。
   */
  minExplicitCacheTokens?: number;
  /**
   * Issue #58: OpenAI / Codex スタイルの `prompt_cache_key` ルーティングヒント
   */
  promptCacheKey?: string;
}

/**
 * 決定論的 SHA-256 ハッシュ（キャッシュフィンガープリント用）
 */
function sha256Hex(str: string): string {
  return createHash('sha256').update(str).digest('hex').slice(0, 16);
}

/**
 * ContextCacheManager
 *
 * 1. プレフィックス順序の安定化 (Prefix Stability):
 *    - ツール定義やシステム指示を決定論的順序で正規化し、プロバイダー側のプロンプトキャッシュヒット率を最大化する。
 * 2. Gemini Context Caching (`ai.caches.create`):
 *    - 長大なシステムプロンプトやツール定義をGemini Context Cacheに先行格納し、全ターンで cachedContent を再利用。
 *    - 最小トークン数未達時やAPI未対応モデル（例: Gemini 4 Argon）時の安全なフォールバック。
 * 3. OpenAI / OpenRouter Anthropic Prompt Caching:
 *    - システムプロンプト、ツール定義、およびマルチターン会話履歴の直前ターンに `cache_control: { type: "ephemeral" }` を自動付与し、キャッシュ読取コストを約90%削減。
 * 4. キャッシュトークン計測 & 燃費最適化:
 *    - `cachedPromptTokens`, `cacheCreationPromptTokens` を正確に抽出し、累計消費トークンと推定費用を最適化。
 */
export class ContextCacheManager {
  private activeCaches: Map<string, ContextCacheInfo> = new Map();
  private ttlSeconds: number;
  private enableGeminiCache: boolean;
  private enablePromptCaching: boolean;
  private minExplicitCacheTokens: number;
  private promptCacheKey?: string;

  constructor(options: ContextCacheManagerOptions = {}) {
    this.ttlSeconds = options.ttlSeconds ?? 1800; // 300ターンの長時間対話に耐える30分TTL
    this.enableGeminiCache = options.enableGeminiCache ?? true;
    this.enablePromptCaching = options.enablePromptCaching ?? true;
    this.minExplicitCacheTokens = options.minExplicitCacheTokens ?? 0;
    this.promptCacheKey = options.promptCacheKey;
  }

  /**
   * システムプロンプトおよびツール定義の推定トークン数を算出
   */
  estimatePrefixTokens(systemInstruction?: string, tools?: any[]): number {
    const sysChars = (systemInstruction || '').length;
    const toolsChars = tools && tools.length > 0 ? JSON.stringify(tools).length : 0;
    return Math.ceil((sysChars + toolsChars) / 4);
  }

  /**
   * ツール定義配列をアルファベット順にソートし、シリアライズ順序を固定化してプレフィックスキャッシュの無効化を防止する
   */
  stabilizeTools(tools?: FunctionDeclaration[]): FunctionDeclaration[] | undefined {
    if (!tools || tools.length === 0) return tools;
    return [...tools].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
  }

  /**
   * システム指示およびツール定義から決定論的な SHA-256 フィンガープリントを生成
   */
  generateFingerprint(model: string, systemInstruction?: string, tools?: any[]): string {
    const stableTools = this.stabilizeTools(tools);
    const key = `${model}:::${systemInstruction || ''}:::${JSON.stringify(stableTools || [])}`;
    return sha256Hex(key);
  }

  /**
   * 明示的 Gemini Context Cache (`ai.caches.create`) が公式にサポートされているモデルか判定
   * ※ Gemini 4 Argon およびそれ以降のモデルは暗黙的キャッシュ (Implicit Caching) のみ対応
   */
  isExplicitCacheSupported(model: string): boolean {
    const m = (model || '').toLowerCase();
    if (m.includes('gemini-4') || m.includes('argon')) {
      return false;
    }
    return m.includes('gemini-1.5') || m.includes('gemini-2') || m.includes('gemini-3');
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
    minTokens?: number;
  }): Promise<string | undefined> {
    if (!this.enableGeminiCache) return undefined;
    const { ai, model, systemInstruction, tools, displayName, minTokens } = options;
    if (!ai || !ai.caches || typeof ai.caches.create !== 'function') return undefined;
    if (!this.isExplicitCacheSupported(model)) return undefined;

    // Issue #58: 最小トークン数ガード — 閾値未満の軽量プロンプトでは無駄な caches.create 往復をスキップし Implicit Caching を活用
    const requiredMinTokens = minTokens ?? this.minExplicitCacheTokens;
    if (requiredMinTokens > 0) {
      const estimatedTokens = this.estimatePrefixTokens(systemInstruction, tools);
      if (estimatedTokens < requiredMinTokens) {
        return undefined;
      }
    }

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
      // 通常の非キャッシュ実行（Gemini Implicit Caching）にフォールバック（例外を送出せず続行）
    }

    return undefined;
  }

  /**
   * OpenAI / OpenRouter 互換メッセージ配列およびツール配列に Anthropic 互換の prompt caching マーカー
   * (`cache_control: { type: 'ephemeral' }`) を付与する
   *
   * Anthropic / OpenRouter では最大4個のブレークポイントを指定可能:
   * 1. システムプロンプト (システム指示 + スキル定義)
   * 2. ツール定義 (最後のツール)
   * 3. 会話履歴の直前ターン（累積メッセージ全体をキャッシュ再利用）
   */
  applyPromptCacheControl(
    body: {
      messages?: any[];
      tools?: any[];
      prompt_cache_key?: string;
      [key: string]: any;
    },
    options?: { promptCacheKey?: string }
  ): void {
    if (!this.enablePromptCaching) return;
    if (!Array.isArray(body.messages)) return;

    const effectiveCacheKey = options?.promptCacheKey ?? this.promptCacheKey;
    if (effectiveCacheKey && !body.prompt_cache_key) {
      body.prompt_cache_key = effectiveCacheKey;
    }

    // 1. システムプロンプト (role: 'system') に cache_control を付与
    const systemMsg = body.messages.find((m) => m?.role === 'system');
    if (systemMsg) {
      if (typeof systemMsg.content === 'string') {
        systemMsg.cache_control = { type: 'ephemeral' };
      } else if (Array.isArray(systemMsg.content) && systemMsg.content.length > 0) {
        const lastPart = systemMsg.content[systemMsg.content.length - 1];
        if (typeof lastPart === 'object' && lastPart !== null) {
          lastPart.cache_control = { type: 'ephemeral' };
        }
      }
    }

    // 2. ツール定義の末尾に cache_control を付与 (Anthropic / OpenRouter 規約)
    if (Array.isArray(body.tools) && body.tools.length > 0) {
      const lastTool = body.tools[body.tools.length - 1];
      if (lastTool && typeof lastTool === 'object') {
        lastTool.cache_control = { type: 'ephemeral' };
      }
    }

    // 3. マルチターン会話履歴の直前ターンに cache_control チェックポイントを付与
    // メッセージが3件以上ある場合（例: system, user_1, assistant_1, user_2...）、
    // 最新ターンの直前のメッセージ（末尾から2番目）にチェックポイントを置くことで、
    // 過去全ターンのコンテキストを丸ごとキャッシュヒットさせ、再計算を防止する
    if (body.messages.length >= 3) {
      const prevTurnMsg = body.messages[body.messages.length - 2];
      if (prevTurnMsg && prevTurnMsg.role !== 'system') {
        if (typeof prevTurnMsg.content === 'string') {
          prevTurnMsg.cache_control = { type: 'ephemeral' };
        } else if (Array.isArray(prevTurnMsg.content) && prevTurnMsg.content.length > 0) {
          const lastPart = prevTurnMsg.content[prevTurnMsg.content.length - 1];
          if (typeof lastPart === 'object' && lastPart !== null) {
            lastPart.cache_control = { type: 'ephemeral' };
          }
        } else if (prevTurnMsg.role === 'tool' || prevTurnMsg.tool_call_id) {
          prevTurnMsg.cache_control = { type: 'ephemeral' };
        }
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
    const cachedPromptTokens =
      usageMeta?.cachedContentTokenCount ||
      usageMeta?.totalCachedTokens ||
      usageMeta?.total_cached_tokens ||
      0;
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
    const cachedPromptTokens =
      usage?.prompt_tokens_details?.cached_tokens ??
      usage?.cache_read_input_tokens ??
      usage?.prompt_cache_hit_tokens ??
      0;
    const cacheCreationPromptTokens =
      usage?.cache_creation_input_tokens ?? 0;

    const rawPrompt =
      usage?.prompt_tokens ??
      (usage?.input_tokens !== undefined ? usage.input_tokens + cachedPromptTokens : 0);
    // Anthropic Native等で prompt_tokens が uncached 部分のみだった場合でも破綻しないよう正規化
    const promptTokens = rawPrompt < cachedPromptTokens ? cachedPromptTokens + rawPrompt : rawPrompt;
    const completionTokens = usage?.completion_tokens ?? usage?.output_tokens ?? 0;
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
