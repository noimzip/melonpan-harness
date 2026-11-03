import { CommandDefinition } from '../types.js';
import { calculateTokenCost, DEFAULT_COST_CAP_USD, USD_TO_JPY_RATE } from '@melonpan/core';

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

    const rawPromptTokens = ctx.sessionUsage.rawPromptTokens ?? promptTokens;
    const freshPromptTokens =
      ctx.sessionUsage.billedPromptTokens ?? Math.max(0, rawPromptTokens - cachedPromptTokens);

    const cost = calculateTokenCost({
      model: ctx.model,
      billedPromptTokens: freshPromptTokens,
      rawPromptTokens,
      cachedPromptTokens,
      completionTokens,
      usdToJpyRate: USD_TO_JPY_RATE,
    });

    const pricing = cost.pricing;
    const cachedInputRate = pricing.cachedInputPerMillion;
    const totalCostUsd = cost.totalCostUsd;
    const totalCostJpy = cost.totalCostJpy;
    const savedCostUsd = cost.savedCostUsd;
    const savedCostJpy = cost.savedCostJpy;

    const cachePercent =
      rawPromptTokens > 0 ? Math.round((cachedPromptTokens / rawPromptTokens) * 100) : 0;
    const ctxPercent = maxContextTokens > 0
      ? Math.min(100, Math.round((contextWindowTokens / maxContextTokens) * 100))
      : 0;

    const lines = [
      '💰 1. Session Billed Usage (全ターン累計課金対象・キャッシュ最適化適用):',
      `  • Active Model      : ${ctx.model}`,
      `  • Input Tokens      : ${rawPromptTokens.toLocaleString()} tokens ($${pricing.inputPerMillion.toFixed(3)} / 1M)`,
      `    └ Cached (Hit)    : ${cachedPromptTokens.toLocaleString()} tokens (${cachePercent}% hit rate, $${cachedInputRate.toFixed(4)} / 1M)`,
      `    └ Fresh (Uncached): ${freshPromptTokens.toLocaleString()} tokens`,
      `    └ Cache Savings   : -$${savedCostUsd.toFixed(5)} USD (約 ¥${savedCostJpy.toFixed(2)} JPY saved)`,
      `  • Output Tokens     : ${completionTokens.toLocaleString()} tokens ($${pricing.outputPerMillion.toFixed(3)} / 1M)`,
      `  • Total Tokens      : ${totalTokens.toLocaleString()} tokens`,
      `  • Estimated Cost    : $${totalCostUsd.toFixed(5)} USD (約 ¥${totalCostJpy.toFixed(2)} JPY) / Cap: $${DEFAULT_COST_CAP_USD.toFixed(2)} USD`,
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
