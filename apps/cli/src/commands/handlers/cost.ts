import { CommandDefinition } from '../types.js';

interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  'gemini-3.5-flash-lite': { inputPerMillion: 0.075, outputPerMillion: 0.3 },
  'gemini-3.8-flash': { inputPerMillion: 0.1, outputPerMillion: 0.4 },
  'gemini-4-argon': { inputPerMillion: 1.25, outputPerMillion: 5.0 },
  'gemma-4-31b-it': { inputPerMillion: 0.2, outputPerMillion: 0.5 },
  'gpt-4o': { inputPerMillion: 2.5, outputPerMillion: 10.0 },
  'gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  'o3-mini': { inputPerMillion: 1.1, outputPerMillion: 4.4 },
  'claude-3-7-sonnet': { inputPerMillion: 3.0, outputPerMillion: 15.0 },
  'claude-3-5-haiku': { inputPerMillion: 0.8, outputPerMillion: 4.0 },
};

const USD_TO_JPY_RATE = 158;

export const costCommand: CommandDefinition = {
  name: 'cost',
  syntax: '/cost',
  description: 'セッション累計課金トークンと現在のコンテキストウィンドウ占有量を表示',
  execute: (_args, ctx) => {
    const {
      promptTokens,
      completionTokens,
      totalTokens,
      cachedPromptTokens = 0,
      contextWindowTokens = 0,
      maxContextTokens = 128_000,
      savedTokens = 0,
    } = ctx.sessionUsage;

    const pricing = MODEL_PRICING[ctx.model] || {
      inputPerMillion: 0.1,
      outputPerMillion: 0.4,
    };

    // キャッシュヒット分はプロバイダー規約に応じて約75%〜90%割引 (Geminiは1/4料金)
    const cachedInputRate = pricing.inputPerMillion * 0.25;
    const freshPromptTokens =
      ctx.sessionUsage.billedPromptTokens ?? Math.max(0, promptTokens - cachedPromptTokens);
    const inputCostUsd =
      (freshPromptTokens / 1_000_000) * pricing.inputPerMillion +
      (cachedPromptTokens / 1_000_000) * cachedInputRate;
    const outputCostUsd = (completionTokens / 1_000_000) * pricing.outputPerMillion;
    const totalCostUsd = inputCostUsd + outputCostUsd;
    const totalCostJpy = totalCostUsd * USD_TO_JPY_RATE;

    const cachePercent = promptTokens > 0 ? Math.round((cachedPromptTokens / promptTokens) * 100) : 0;
    const ctxPercent = maxContextTokens > 0
      ? Math.min(100, Math.round((contextWindowTokens / maxContextTokens) * 100))
      : 0;

    const lines = [
      '💰 1. Session Billed Usage (全ターン累計課金対象・キャッシュ最適化適用):',
      `  • Active Model      : ${ctx.model}`,
      `  • Input Tokens      : ${promptTokens.toLocaleString()} tokens ($${pricing.inputPerMillion.toFixed(3)} / 1M)`,
      `    └ Cached (Hit)    : ${cachedPromptTokens.toLocaleString()} tokens (${cachePercent}% hit rate, $${cachedInputRate.toFixed(4)} / 1M)`,
      `    └ Fresh (Uncached): ${freshPromptTokens.toLocaleString()} tokens`,
      `  • Output Tokens     : ${completionTokens.toLocaleString()} tokens ($${pricing.outputPerMillion.toFixed(3)} / 1M)`,
      `  • Total Tokens      : ${totalTokens.toLocaleString()} tokens`,
      `  • Estimated Cost    : $${totalCostUsd.toFixed(5)} USD (約 ¥${totalCostJpy.toFixed(2)} JPY)`,
      '  ───────────────────────────────────────────',
      '🧠 2. Current Context Window (現在の会話・推論履歴占有量):',
      `  • Occupied Context  : ${contextWindowTokens.toLocaleString()} / ${maxContextTokens.toLocaleString()} tokens (${ctxPercent}%)`,
      `  • Remaining Space   : ${(Math.max(0, maxContextTokens - contextWindowTokens)).toLocaleString()} tokens`,
      `  • Saved by Compaction: ${savedTokens.toLocaleString()} tokens freed`,
    ];

    ctx.logActivity(`Token usage: ${totalTokens.toLocaleString()} tokens ($${totalCostUsd.toFixed(4)})`);
    for (const line of lines) {
      ctx.logThought(line);
    }
  },
};
