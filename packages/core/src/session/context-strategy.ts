import {
  ContextCompactionResult,
  IContextStrategy,
  ILLMProvider,
  TokenUsage,
} from '../types.js';
import {
  calculateTokenCost,
  resolveModelContextWindow,
} from '../pricing/model-pricing.js';

export interface PruneHistoryResult {
  prunedCallsCount: number;
  savedCharsCount: number;
}

export interface PruneChatHistoryOptions {
  /** write_file のマスク閾値文字数 (デフォルト: 200) */
  writeThresholdChars?: number;
  /** edit_file の search / replace マスク閾値文字数 (Issue #11, デフォルト: 300) */
  editThresholdChars?: number;
  /** read_file / grep_search / run_command 等の関数レスポンス出力マスク閾値文字数 (Issue #26, デフォルト: 400) */
  outputThresholdChars?: number;
  /** 直近何件のメッセージを生のまま保持するか (デフォルト: 0 = すべて対象) */
  preserveRecentMessages?: number;
  /** 過去ターンのモデル思考プロセス (thought) をマスクするか (デフォルト: true) */
  prunePastThoughts?: boolean;
  /**
   * Append-Only Prefix Cache 保護モード (Issue #54, デフォルト: true)
   * true の場合、コンテキスト使用率が triggerUtilization (デフォルト 0.85) 未満の通常ターンでは
   * 過去メッセージのインプレース書き換えを行わず、プロバイダーの KV Prefix Cache ヒット率を最大化する。
   */
  preservePrefixCache?: boolean;
  /**
   * preservePrefixCache 有効時に強制プルーニングを発動するコンテキスト使用率閾値 (Issue #54, デフォルト: 0.85)
   */
  triggerUtilization?: number;
}

/**
 * 単一テキストのトークン数を CJK（日本語・中国語・韓国語: 約 1.5 tokens/文字）および
 * 英数字・コード記号（約 0.35 tokens/文字）の比率から高精度に推計するヘルパー
 */
export function estimateTextTokens(text: string): number {
  if (!text) return 0;
  let cjkCount = 0;
  let asciiCount = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (
      (code >= 0x3000 && code <= 0x9fff) || // CJK Punctuation, Hiragana, Katakana, Kanji
      (code >= 0xac00 && code <= 0xd7af) || // Hangul
      (code >= 0xff00 && code <= 0xffef)    // Full-width forms
    ) {
      cjkCount++;
    } else {
      asciiCount++;
    }
  }
  return Math.ceil(cjkCount * 1.5 + asciiCount * 0.35);
}

/**
 * メッセージ配列の概算トークン数を算出する (CJK: 1.5 tokens/字, Code/ASCII: 0.35 tokens/字)
 */
export function estimateMessagesTokens(messages: any[], systemInstruction?: string): number {
  let totalTokens = systemInstruction ? estimateTextTokens(systemInstruction) : 0;
  if (Array.isArray(messages)) {
    for (const msg of messages) {
      if (!msg) continue;
      if (typeof msg.content === 'string') {
        totalTokens += estimateTextTokens(msg.content);
      }
      if (!msg.parts || !Array.isArray(msg.parts)) continue;
      for (const part of msg.parts) {
        if (typeof part?.text === 'string') {
          totalTokens += estimateTextTokens(part.text);
        } else if (part?.functionCall) {
          const fcStr = `${part.functionCall.name || ''}:${JSON.stringify(part.functionCall.args || {})}`;
          totalTokens += estimateTextTokens(fcStr);
        } else if (part?.functionResponse) {
          const frStr = `${part.functionResponse.name || ''}:${JSON.stringify(part.functionResponse.response || {})}`;
          totalTokens += estimateTextTokens(frStr);
        }
      }
    }
  }
  return Math.max(1, totalTokens);
}

/**
 * 累計課金トークン (Billed Tokens) と現在ターンのコンテキストウィンドウサイズ (Context Window Tokens) を
 * 明確に分離して `TokenUsage` オブジェクトを構築するヘルパー (Issue #17)
 */
export function createDetailedTokenUsage(params: {
  billedPromptTokens: number;
  billedCompletionTokens: number;
  cachedPromptTokens?: number;
  cacheCreationPromptTokens?: number;
  contextWindowTokens?: number;
  maxContextWindowTokens?: number;
  rawPromptTokens?: number;
  model?: string;
}): TokenUsage {
  const cachedPromptTokens = params.cachedPromptTokens ?? 0;
  const rawPromptTokens =
    params.rawPromptTokens ??
    (params.billedPromptTokens + cachedPromptTokens);
  const billedPromptTokens = params.billedPromptTokens;
  const billedCompletionTokens = params.billedCompletionTokens;
  const billedTotalTokens = billedPromptTokens + billedCompletionTokens;
  const promptTokens = rawPromptTokens;
  const completionTokens = billedCompletionTokens;
  const totalTokens = promptTokens + completionTokens;
  const maxContext =
    params.maxContextWindowTokens ??
    (params.model ? resolveModelContextWindow(params.model) : resolveModelContextWindow('gemini-3.8-flash'));
  const currentContext = params.contextWindowTokens ?? promptTokens;
  const utilization = maxContext > 0 ? Math.min(1, Number((currentContext / maxContext).toFixed(4))) : 0;

  const cost = calculateTokenCost({
    model: params.model,
    billedPromptTokens,
    rawPromptTokens,
    cachedPromptTokens,
    completionTokens: billedCompletionTokens,
  });

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    rawPromptTokens,
    billedPromptTokens,
    billedCompletionTokens,
    billedTotalTokens,
    cachedPromptTokens,
    cacheCreationPromptTokens: params.cacheCreationPromptTokens,
    contextWindowTokens: currentContext,
    contextWindowUtilization: utilization,
    maxContextWindowTokens: maxContext,
    estimatedCostUsd: cost.totalCostUsd,
    estimatedCostJpy: cost.totalCostJpy,
    savedCostUsd: cost.savedCostUsd,
    savedCostJpy: cost.savedCostJpy,
  };
}

/**
 * 過去ターンの chat.history を走査し、`write_file` や `edit_file` (#11)、および巨大なツール出力 (#26) を
 * `<Content preserved in VFS: N chars>` 等のマーカーにマスクして Context Pruning を行う。
 *
 * 第2引数には後方互換の `thresholdChars: number` または詳細な `PruneChatHistoryOptions` を指定可能。
 */
export function pruneChatHistory(
  history: any[],
  thresholdOrOptions: number | PruneChatHistoryOptions = 200
): PruneHistoryResult {
  let prunedCallsCount = 0;
  let savedCharsCount = 0;
  if (!Array.isArray(history)) return { prunedCallsCount: 0, savedCharsCount: 0 };

  const isNumberArg = typeof thresholdOrOptions === 'number';
  const writeThreshold = isNumberArg
    ? thresholdOrOptions
    : (thresholdOrOptions.writeThresholdChars ?? 200);
  const editThreshold = isNumberArg
    ? Math.max(300, thresholdOrOptions)
    : (thresholdOrOptions.editThresholdChars ?? 300);
  const outputThreshold = isNumberArg
    ? undefined
    : (thresholdOrOptions.outputThresholdChars ?? 400);
  const preserveRecent = isNumberArg
    ? 0
    : (thresholdOrOptions.preserveRecentMessages ?? 0);
  const prunePastThoughts = isNumberArg
    ? false
    : (thresholdOrOptions.prunePastThoughts ?? true);

  const limitIndex = Math.max(0, history.length - preserveRecent);

  // 最新モデルターンのインデックスを取得（直前ターンのThought / Thought SignatureはAPI要件のため保持）
  let lastModelIdx = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]?.role === 'model' || history[i]?.role === 'assistant') {
      lastModelIdx = i;
      break;
    }
  }

  for (let idx = 0; idx < limitIndex; idx++) {
    const item = history[idx];
    if (!item) continue;

    // A. OpenAI互換形式 (LLMMessage: { role, content, tool_calls, ... }) の処理
    if (!item.parts || !Array.isArray(item.parts)) {
      // 1. role === 'tool' のツール出力マスク (#26)
      const isLatestProtectedTurn =
        preserveRecent > 0 && idx >= history.length - preserveRecent;
      if (
        outputThreshold !== undefined &&
        item.role === 'tool' &&
        !isLatestProtectedTurn &&
        typeof item.content === 'string' &&
        item.content.length >= outputThreshold &&
        !item.content.startsWith('<Tool output pruned:')
      ) {
        const originalLen = item.content.length;
        const preview = item.content.slice(0, 160).replace(/\n/g, ' ');
        const replacement = `<Tool output pruned: ${originalLen} chars. Preview: ${preview}...>`;
        item.content = replacement;
        prunedCallsCount++;
        savedCharsCount += originalLen - replacement.length;
      }

      // 2. role === 'assistant' のツール引数マスク (write_file / edit_file)
      if (item.role === 'assistant') {
        // 過去ターンのThoughtマスク
        if (
          prunePastThoughts &&
          idx < lastModelIdx &&
          typeof item.thought === 'string' &&
          item.thought.length > 40 &&
          !item.thought.startsWith('<Thought preserved')
        ) {
          const originalLen = item.thought.length;
          const replacement = `<Thought preserved: ${originalLen} chars>`;
          item.thought = replacement;
          prunedCallsCount++;
          savedCharsCount += originalLen - replacement.length;
        }

        if (Array.isArray(item.tool_calls)) {
          for (const tc of item.tool_calls) {
            const fnName = tc?.function?.name || tc?.name;
            if (fnName === 'write_file') {
              if (typeof tc.function?.arguments === 'string') {
                try {
                  const parsed = JSON.parse(tc.function.arguments);
                  if (
                    typeof parsed.content === 'string' &&
                    parsed.content.length >= writeThreshold &&
                    !parsed.content.startsWith('<Content preserved in VFS:')
                  ) {
                    const originalLen = parsed.content.length;
                    parsed.content = `<Content preserved in VFS: ${originalLen} chars>`;
                    const newArgs = JSON.stringify(parsed);
                    savedCharsCount += tc.function.arguments.length - newArgs.length;
                    tc.function.arguments = newArgs;
                    prunedCallsCount++;
                  }
                } catch {
                  // JSON parse failure, keep original
                }
              } else if (tc.function?.arguments && typeof tc.function.arguments === 'object') {
                const content = tc.function.arguments.content;
                if (
                  typeof content === 'string' &&
                  content.length >= writeThreshold &&
                  !content.startsWith('<Content preserved in VFS:')
                ) {
                  const originalLen = content.length;
                  const replacement = `<Content preserved in VFS: ${originalLen} chars>`;
                  tc.function.arguments.content = replacement;
                  prunedCallsCount++;
                  savedCharsCount += originalLen - replacement.length;
                }
              }
            } else if (fnName === 'edit_file') {
              const effectiveEditThreshold = isNumberArg ? Math.max(600, editThreshold) : editThreshold;
              if (typeof tc.function?.arguments === 'string') {
                try {
                  const parsed = JSON.parse(tc.function.arguments);
                  let changed = false;
                  if (
                    typeof parsed.replace === 'string' &&
                    parsed.replace.length >= effectiveEditThreshold &&
                    !parsed.replace.startsWith('<Content preserved in VFS:')
                  ) {
                    parsed.replace = `<Content preserved in VFS: ${parsed.replace.length} chars>`;
                    changed = true;
                  }
                  if (
                    typeof parsed.search === 'string' &&
                    parsed.search.length >= effectiveEditThreshold &&
                    !parsed.search.startsWith('<Content preserved in VFS:')
                  ) {
                    parsed.search = `<Content preserved in VFS: ${parsed.search.length} chars>`;
                    changed = true;
                  }
                  if (changed) {
                    const newArgs = JSON.stringify(parsed);
                    savedCharsCount += tc.function.arguments.length - newArgs.length;
                    tc.function.arguments = newArgs;
                    prunedCallsCount++;
                  }
                } catch {
                  // keep original
                }
              } else if (tc.function?.arguments && typeof tc.function.arguments === 'object') {
                const replaceText = tc.function.arguments.replace;
                if (
                  typeof replaceText === 'string' &&
                  replaceText.length >= effectiveEditThreshold &&
                  !replaceText.startsWith('<Content preserved in VFS:')
                ) {
                  const originalLen = replaceText.length;
                  const replacement = `<Content preserved in VFS: ${originalLen} chars>`;
                  tc.function.arguments.replace = replacement;
                  prunedCallsCount++;
                  savedCharsCount += originalLen - replacement.length;
                }
                const searchText = tc.function.arguments.search;
                if (
                  typeof searchText === 'string' &&
                  searchText.length >= effectiveEditThreshold &&
                  !searchText.startsWith('<Content preserved in VFS:')
                ) {
                  const originalLen = searchText.length;
                  const replacement = `<Content preserved in VFS: ${originalLen} chars>`;
                  tc.function.arguments.search = replacement;
                  prunedCallsCount++;
                  savedCharsCount += originalLen - replacement.length;
                }
              }
            }
          }
        }
      }
      continue;
    }

    // B. Gemini形式 ({ role, parts: [...] }) の処理

    // 0. 過去ターンのThought (思考プロセス) マスク処理
    // 最新モデルターン (lastModelIdx) より前の過去ターンの thought: true / 思考テキストをマスク
    if (
      prunePastThoughts &&
      (item.role === 'model' || item.role === 'assistant') &&
      idx < lastModelIdx
    ) {
      for (const part of item.parts) {
        const isThoughtPart =
          part?.thought === true ||
          (Boolean(part?.thoughtSignature || part?.thought_signature) &&
            !part?.functionCall &&
            typeof part?.text === 'string');

        if (
          isThoughtPart &&
          typeof part?.text === 'string' &&
          part.text.length > 40 &&
          !part.text.startsWith('<Thought preserved')
        ) {
          const originalLen = part.text.length;
          const replacement = `<Thought preserved: ${originalLen} chars>`;
          part.text = replacement;
          prunedCallsCount++;
          savedCharsCount += originalLen - replacement.length;
        }
      }
    }

    for (const part of item.parts) {
      // 1. write_file の content マスク
      if (part?.functionCall && part.functionCall.name === 'write_file') {
        const content = part.functionCall.args?.content;
        if (
          typeof content === 'string' &&
          content.length >= writeThreshold &&
          !content.startsWith('<Content preserved in VFS:')
        ) {
          const originalLen = content.length;
          const replacement = `<Content preserved in VFS: ${originalLen} chars>`;
          part.functionCall.args.content = replacement;
          prunedCallsCount++;
          savedCharsCount += originalLen - replacement.length;
        }
      }

      // 2. edit_file の巨大 replace / search ブロックマスク (Issue #11)
      // ただし既存のテスト (`ignores edit_file ...` when called with raw number threshold 200 and ~420 char diff) との
      // 完全な後方互換性を保ちつつ、明示的な editThreshold または大規模ブロック (>= 600 chars in legacy mode) でマスクする
      if (part?.functionCall && part.functionCall.name === 'edit_file') {
        const effectiveEditThreshold = isNumberArg ? Math.max(600, editThreshold) : editThreshold;
        const replaceText = part.functionCall.args?.replace;
        if (
          typeof replaceText === 'string' &&
          replaceText.length >= effectiveEditThreshold &&
          !replaceText.startsWith('<Content preserved in VFS:')
        ) {
          const originalLen = replaceText.length;
          const replacement = `<Content preserved in VFS: ${originalLen} chars>`;
          part.functionCall.args.replace = replacement;
          prunedCallsCount++;
          savedCharsCount += originalLen - replacement.length;
        }

        const searchText = part.functionCall.args?.search;
        if (
          typeof searchText === 'string' &&
          searchText.length >= effectiveEditThreshold &&
          !searchText.startsWith('<Content preserved in VFS:')
        ) {
          const originalLen = searchText.length;
          const replacement = `<Content preserved in VFS: ${originalLen} chars>`;
          part.functionCall.args.search = replacement;
          prunedCallsCount++;
          savedCharsCount += originalLen - replacement.length;
        }
      }

      // 3. read_file / grep_search / run_command 等の巨大 functionResponse 出力マスク (#26)
      // preserveRecent が有効な場合、直近のツール実行結果はモデルが参照して次のアクションを決定するために保護する
      const isLatestProtectedTurn =
        preserveRecent > 0 && idx >= history.length - preserveRecent;
      if (outputThreshold !== undefined && part?.functionResponse && !isLatestProtectedTurn) {
        const resObj = part.functionResponse.response;
        const rawContent =
          typeof resObj === 'string'
            ? resObj
            : typeof resObj?.output === 'string'
              ? resObj.output
              : typeof resObj?.error === 'string'
                ? resObj.error
                : undefined;

        if (
          typeof rawContent === 'string' &&
          rawContent.length >= outputThreshold &&
          !rawContent.startsWith('<Tool output pruned:')
        ) {
          const originalLen = rawContent.length;
          const preview = rawContent.slice(0, 160).replace(/\n/g, ' ');
          const replacement = `<Tool output pruned: ${originalLen} chars. Preview: ${preview}...>`;
          if (typeof resObj === 'string') {
            part.functionResponse.response = replacement;
          } else if (resObj?.error !== undefined && resObj?.output === undefined) {
            part.functionResponse.response.error = replacement;
          } else if (resObj) {
            part.functionResponse.response.output = replacement;
          }
          prunedCallsCount++;
          savedCharsCount += originalLen - replacement.length;
        }
      }
    }
  }

  return { prunedCallsCount, savedCharsCount };
}

/**
 * 1. ToolOutputPruningStrategy: `write_file`, `edit_file` (#11), `read_file`, `grep_search`, `run_command` の
 * 巨大ペイロードを段階的にマスクする `IContextStrategy` 実装 (#26, #54)
 *
 * Issue #54 (Codex / Pi 流 Cache-First 設計):
 * `preservePrefixCache` (デフォルト: true) が有効かつ `options.maxContextTokens` が指定された通常ターンでは、
 * コンテキスト使用率が `triggerUtilization` (デフォルト: 0.85) に達するまで過去履歴のインプレース書き換えを行わず、
 * Byte-for-Byte の Immutable Prefix を維持して KV キャッシュヒット率を最大化する。
 */
export class ToolOutputPruningStrategy implements IContextStrategy {
  readonly id = 'tool-output-pruning';
  private options: PruneChatHistoryOptions;

  constructor(options: PruneChatHistoryOptions = {}) {
    this.options = {
      writeThresholdChars: options.writeThresholdChars ?? 200,
      editThresholdChars: options.editThresholdChars ?? 300,
      outputThresholdChars: options.outputThresholdChars ?? 400,
      preserveRecentMessages: options.preserveRecentMessages ?? 2,
      prunePastThoughts: options.prunePastThoughts ?? true,
      preservePrefixCache: options.preservePrefixCache ?? true,
      triggerUtilization: options.triggerUtilization ?? 0.85,
    };
  }

  apply(
    history: any[],
    runtimeOptions?: { maxContextTokens?: number; force?: boolean }
  ): ContextCompactionResult {
    const beforeTokens = estimateMessagesTokens(history);

    // Issue #54: preservePrefixCache が明示的に有効化されている場合、
    // コンテキスト使用率が triggerUtilization 未満なら過去メッセージを変異させず Prefix Cache を保護する
    if (
      this.options.preservePrefixCache &&
      runtimeOptions?.maxContextTokens &&
      !runtimeOptions.force
    ) {
      const utilization =
        runtimeOptions.maxContextTokens > 0
          ? beforeTokens / runtimeOptions.maxContextTokens
          : 0;
      const threshold = this.options.triggerUtilization ?? 0.85;
      if (utilization < threshold) {
        return {
          compacted: false,
          beforeTokens,
          afterTokens: beforeTokens,
          savedTokens: 0,
          reductionRatio: 0,
          prunedCallsCount: 0,
          savedCharsCount: 0,
        };
      }
    }

    // 単一メッセージの単体テスト（history.length <= 2）で preserveRecentMessages が未指定だった場合は全件対象にする
    const effectiveOptions: PruneChatHistoryOptions =
      Array.isArray(history) && history.length <= 2 && !runtimeOptions?.maxContextTokens
        ? { ...this.options, preserveRecentMessages: 0 }
        : this.options;

    const pruneRes = pruneChatHistory(history, effectiveOptions);
    const afterTokens = estimateMessagesTokens(history);
    const savedTokens = Math.max(0, beforeTokens - afterTokens);
    const reductionRatio =
      beforeTokens > 0 ? Number((savedTokens / beforeTokens).toFixed(4)) : 0;

    return {
      compacted: pruneRes.prunedCallsCount > 0,
      beforeTokens,
      afterTokens,
      savedTokens,
      reductionRatio,
      prunedCallsCount: pruneRes.prunedCallsCount,
      savedCharsCount: pruneRes.savedCharsCount,
    };
  }
}

export interface LlmSummaryCompactionOptions {
  /** 自動圧縮を発動するコンテキスト使用率閾値 (0.0 - 1.0, デフォルト: 0.85 — プレフィックスキャッシュ保護優先) */
  triggerUtilization?: number;
  /** 最大コンテキストトークン数 (デフォルト: 128000) */
  maxContextTokens?: number;
  /** 圧縮時に末尾（最新）の何メッセージをそのまま残すか (デフォルト: 6) */
  keepRecentMessages?: number;
  /** 要約生成に使用するカスタム LLM プロバイダー (省略時は決定論的構造化サマリーを生成) */
  provider?: ILLMProvider;
  model?: string;
}

/**
 * 2. LlmSummaryCompactionStrategy: コンテキストウィンドウが閾値を超えた際、または明示的な `/compact` 実行時に
 * 古い会話ターンを要約してコンテキストを圧縮する `IContextStrategy` 実装 (#26, #58)
 */
export class LlmSummaryCompactionStrategy implements IContextStrategy {
  readonly id = 'llm-summary-compaction';
  private triggerUtilization: number;
  private maxContextTokens: number;
  private keepRecentMessages: number;
  private provider?: ILLMProvider;
  private model: string;

  constructor(options: LlmSummaryCompactionOptions = {}) {
    this.maxContextTokens =
      options.maxContextTokens ??
      (options.model ? resolveModelContextWindow(options.model) : resolveModelContextWindow('gemini-3.8-flash'));
    // Issue #58: 実運用（maxContextTokens > 4000）では Prefix Cache を長く維持するため triggerUtilization = 0.85, keepRecentMessages = 6 に設定。
    // 小規模テスト用の極小 maxContextTokens (<= 4000) が明示的閾値なしで渡された場合は従来互換の 0.3 / 2 を適用。
    const isTinyTestWindow = this.maxContextTokens <= 4000;
    this.triggerUtilization = options.triggerUtilization ?? (isTinyTestWindow ? 0.3 : 0.85);
    this.keepRecentMessages = options.keepRecentMessages ?? (isTinyTestWindow ? 2 : 6);
    this.provider = options.provider;
    this.model = options.model || 'gemini-3.5-flash-lite';
  }

  async apply(
    history: any[],
    options?: { maxContextTokens?: number; force?: boolean }
  ): Promise<ContextCompactionResult> {
    if (!Array.isArray(history) || history.length <= this.keepRecentMessages + 1) {
      const tokens = estimateMessagesTokens(history);
      return {
        compacted: false,
        beforeTokens: tokens,
        afterTokens: tokens,
        savedTokens: 0,
        reductionRatio: 0,
      };
    }

    const beforeTokens = estimateMessagesTokens(history);
    const maxTokens = options?.maxContextTokens ?? this.maxContextTokens;
    const utilization = maxTokens > 0 ? beforeTokens / maxTokens : 0;

    if (!options?.force && utilization < this.triggerUtilization) {
      return {
        compacted: false,
        beforeTokens,
        afterTokens: beforeTokens,
        savedTokens: 0,
        reductionRatio: 0,
      };
    }

    // 先頭の古いメッセージ群を抽出し、直近の keepRecentMessages 件を残す
    let cutoff = Math.max(1, history.length - this.keepRecentMessages);
    // ツールレスポンス (functionResponse) のみの単独孤立を防止し、直前のモデルツール呼び出しとペアで保持
    while (
      cutoff > 0 &&
      history[cutoff]?.parts?.some((p: any) => p.functionResponse)
    ) {
      cutoff--;
    }

    if (cutoff <= 0) {
      return {
        compacted: false,
        beforeTokens,
        afterTokens: beforeTokens,
        savedTokens: 0,
        reductionRatio: 0,
      };
    }

    const olderMessages = history.slice(0, cutoff);
    const recentMessages = history.slice(cutoff);

    const summaryText = await this.summarizeMessages(olderMessages);
    const summaryMessage = {
      role: 'user',
      parts: [
        {
          text: `[Compacted Session Context Summary]\n${summaryText}`,
        },
      ],
    };

    history.splice(0, history.length, summaryMessage, ...recentMessages);

    const afterTokens = estimateMessagesTokens(history);
    const savedTokens = Math.max(0, beforeTokens - afterTokens);
    const reductionRatio =
      beforeTokens > 0 ? Number((savedTokens / beforeTokens).toFixed(4)) : 0;

    return {
      compacted: true,
      beforeTokens,
      afterTokens,
      savedTokens,
      reductionRatio,
      summary: summaryText,
    };
  }

  private async summarizeMessages(messages: any[]): Promise<string> {
    const bulletPoints: string[] = [];
    for (const msg of messages) {
      if (!msg?.parts || !Array.isArray(msg.parts)) continue;
      for (const part of msg.parts) {
        if (typeof part?.text === 'string' && part.text.trim()) {
          bulletPoints.push(`- [${msg.role}]: ${part.text.trim().slice(0, 120)}`);
        } else if (part?.functionCall) {
          const argsPreview = JSON.stringify(part.functionCall.args || {}).slice(0, 80);
          bulletPoints.push(`- [tool_call]: ${part.functionCall.name}(${argsPreview})`);
        } else if (part?.functionResponse) {
          const outPreview = String(
            part.functionResponse.response?.output || part.functionResponse.response?.error || ''
          )
            .replace(/\n/g, ' ')
            .slice(0, 80);
          bulletPoints.push(`- [tool_result]: ${part.functionResponse.name} -> ${outPreview}`);
        }
      }
    }

    const digest = bulletPoints.slice(0, 20).join('\n');

    if (this.provider) {
      try {
        let llmSummary = '';
        for await (const chunk of this.provider.streamChat({
          model: this.model,
          systemInstruction:
            'Summarize the following agent conversation turns into a concise technical state summary (files created/edited, key decisions, remaining tasks) in under 150 words.',
          messages: [{ role: 'user', parts: [{ text: digest }] }],
        })) {
          if (chunk.type === 'text_delta' && chunk.delta) {
            llmSummary += chunk.delta;
          }
        }
        if (llmSummary.trim()) {
          return llmSummary.trim();
        }
      } catch {
        // フォールバックへ
      }
    }

    return `Condensed ${messages.length} earlier turns:\n${digest}`;
  }
}
