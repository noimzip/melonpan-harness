/**
 * マルチプロバイダー共通モデル料金テーブル & リアルタイム費用計算エンジン
 * (Gemini / OpenAI GPT / Anthropic Claude 対応)
 */

export interface ModelPricingSpec {
  /** 通常（キャッシュなし）入力 100万トークンあたりの USD 価格 */
  inputPerMillion: number;
  /** 出力 100万トークンあたりの USD 価格 */
  outputPerMillion: number;
  /** キャッシュヒット入力 100万トークンあたりの USD 価格 */
  cachedInputPerMillion: number;
}

export const USD_TO_JPY_RATE = 158;

export const DEFAULT_COST_CAP_USD = 2.0;

export const DEFAULT_MODEL_PRICING: Record<string, ModelPricingSpec> = {
  'gemini-3.8-flash': {
    inputPerMillion: 0.1,
    outputPerMillion: 0.4,
    cachedInputPerMillion: 0.025, // 75% OFF
  },
  'gemini-3.5-flash-lite': {
    inputPerMillion: 0.075,
    outputPerMillion: 0.3,
    cachedInputPerMillion: 0.01875, // 75% OFF
  },
  'gemini-4-argon': {
    inputPerMillion: 1.25,
    outputPerMillion: 5.0,
    cachedInputPerMillion: 0.3125, // 75% OFF
  },
  'gemma-4-31b-it': {
    inputPerMillion: 0.2,
    outputPerMillion: 0.5,
    cachedInputPerMillion: 0.05, // 75% OFF
  },
  'gpt-4o': {
    inputPerMillion: 2.5,
    outputPerMillion: 10.0,
    cachedInputPerMillion: 1.25, // 50% OFF
  },
  'gpt-4o-mini': {
    inputPerMillion: 0.15,
    outputPerMillion: 0.6,
    cachedInputPerMillion: 0.075, // 50% OFF
  },
  'o3-mini': {
    inputPerMillion: 1.1,
    outputPerMillion: 4.4,
    cachedInputPerMillion: 0.55, // 50% OFF
  },
  'gpt-4-turbo': {
    inputPerMillion: 10.0,
    outputPerMillion: 30.0,
    cachedInputPerMillion: 5.0,
  },
  'claude-3-7-sonnet': {
    inputPerMillion: 3.0,
    outputPerMillion: 15.0,
    cachedInputPerMillion: 0.3, // 90% OFF
  },
  'claude-3-5-sonnet': {
    inputPerMillion: 3.0,
    outputPerMillion: 15.0,
    cachedInputPerMillion: 0.3, // 90% OFF
  },
  'claude-3-5-haiku': {
    inputPerMillion: 0.8,
    outputPerMillion: 4.0,
    cachedInputPerMillion: 0.08, // 90% OFF
  },
};

export interface CostBreakdown {
  model: string;
  pricing: ModelPricingSpec;
  freshInputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  inputCostUsd: number;
  outputCostUsd: number;
  totalCostUsd: number;
  totalCostJpy: number;
  savedCostUsd: number;
  savedCostJpy: number;
}

/**
 * モデル名（プレフィックスまたはサブストリング含む）から料金仕様を解決する
 */
export function resolveModelPricing(model?: string): ModelPricingSpec {
  if (!model) {
    return DEFAULT_MODEL_PRICING['gemini-3.8-flash']!;
  }
  const normalized = model.trim().toLowerCase();
  if (DEFAULT_MODEL_PRICING[normalized]) {
    return DEFAULT_MODEL_PRICING[normalized]!;
  }
  // OpenRouter 等の provider/model 形式や日付サフィックス付きモデル名の解決 (長いキー名から優先マッチ)
  const sortedEntries = Object.entries(DEFAULT_MODEL_PRICING).sort(
    ([a], [b]) => b.length - a.length
  );
  for (const [key, spec] of sortedEntries) {
    if (normalized.includes(key)) {
      return spec;
    }
  }
  if (normalized.includes('haiku')) {
    return DEFAULT_MODEL_PRICING['claude-3-5-haiku']!;
  }
  if (normalized.includes('sonnet') || normalized.includes('claude')) {
    return DEFAULT_MODEL_PRICING['claude-3-7-sonnet']!;
  }
  if (normalized.includes('gpt-4o-mini')) {
    return DEFAULT_MODEL_PRICING['gpt-4o-mini']!;
  }
  if (normalized.includes('gpt-4o')) {
    return DEFAULT_MODEL_PRICING['gpt-4o']!;
  }
  return DEFAULT_MODEL_PRICING['gemini-3.8-flash']!;
}

/**
 * トークン使用量から推定費用（USD / JPY）とキャッシュ節約額を算出する
 */
export function calculateTokenCost(params: {
  model?: string;
  billedPromptTokens?: number;
  rawPromptTokens?: number;
  promptTokens?: number;
  cachedPromptTokens?: number;
  completionTokens?: number;
  usdToJpyRate?: number;
}): CostBreakdown {
  const model = params.model || 'gemini-3.8-flash';
  const pricing = resolveModelPricing(model);
  const rate = params.usdToJpyRate ?? USD_TO_JPY_RATE;

  const cachedInputTokens = Math.max(0, params.cachedPromptTokens ?? 0);
  const rawInput =
    params.rawPromptTokens ??
    params.promptTokens ??
    (params.billedPromptTokens !== undefined
      ? params.billedPromptTokens + cachedInputTokens
      : 0);
  const freshInputTokens =
    params.billedPromptTokens !== undefined
      ? Math.max(0, params.billedPromptTokens)
      : Math.max(0, rawInput - cachedInputTokens);
  const outputTokens = Math.max(0, params.completionTokens ?? 0);

  const inputCostUsd =
    (freshInputTokens / 1_000_000) * pricing.inputPerMillion +
    (cachedInputTokens / 1_000_000) * pricing.cachedInputPerMillion;
  const outputCostUsd = (outputTokens / 1_000_000) * pricing.outputPerMillion;
  const totalCostUsd = Number((inputCostUsd + outputCostUsd).toFixed(6));
  const totalCostJpy = Number((totalCostUsd * rate).toFixed(2));

  const savedCostUsd = Number(
    (
      (cachedInputTokens / 1_000_000) *
      Math.max(0, pricing.inputPerMillion - pricing.cachedInputPerMillion)
    ).toFixed(6)
  );
  const savedCostJpy = Number((savedCostUsd * rate).toFixed(2));

  return {
    model,
    pricing,
    freshInputTokens,
    cachedInputTokens,
    outputTokens,
    inputCostUsd,
    outputCostUsd,
    totalCostUsd,
    totalCostJpy,
    savedCostUsd,
    savedCostJpy,
  };
}
