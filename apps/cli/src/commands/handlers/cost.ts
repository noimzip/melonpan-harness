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
  'opencode/beam-free': { inputPerMillion: 0.0, outputPerMillion: 0.0 },
  'opencode/deepseek-v4.1-flash-free': { inputPerMillion: 0.0, outputPerMillion: 0.0 },
  'opencode/space-bunny-free': { inputPerMillion: 0.0, outputPerMillion: 0.0 },
  'opencode/mimo-v2.6-flash-free': { inputPerMillion: 0.0, outputPerMillion: 0.0 },
};

const USD_TO_JPY_RATE = 158;

export const costCommand: CommandDefinition = {
  name: 'cost',
  syntax: '/cost',
  description: 'セッション累計の Input / Output トークン数と推定費用 (USD / JPY) を表示',
  execute: (_args, ctx) => {
    const { promptTokens, completionTokens, totalTokens } = ctx.sessionUsage;

    const pricing = MODEL_PRICING[ctx.model] || {
      inputPerMillion: 0.1,
      outputPerMillion: 0.4,
    };

    const inputCostUsd = (promptTokens / 1_000_000) * pricing.inputPerMillion;
    const outputCostUsd = (completionTokens / 1_000_000) * pricing.outputPerMillion;
    const totalCostUsd = inputCostUsd + outputCostUsd;
    const totalCostJpy = totalCostUsd * USD_TO_JPY_RATE;

    const lines = [
      '💰 セッション累計トークン使用量 & 推定費用:',
      `  • Active Model      : ${ctx.model}`,
      `  • Input Tokens      : ${promptTokens.toLocaleString()} tokens ($${pricing.inputPerMillion.toFixed(3)} / 1M)`,
      `  • Output Tokens     : ${completionTokens.toLocaleString()} tokens ($${pricing.outputPerMillion.toFixed(3)} / 1M)`,
      `  • Total Tokens      : ${totalTokens.toLocaleString()} tokens`,
      `  ───────────────────────────────────────────`,
      `  • Estimated Cost    : $${totalCostUsd.toFixed(5)} USD (約 ¥${totalCostJpy.toFixed(2)} JPY)`,
    ];

    ctx.logActivity(`Token usage: ${totalTokens.toLocaleString()} tokens ($${totalCostUsd.toFixed(4)})`);
    for (const line of lines) {
      ctx.logThought(line);
    }
  },
};
