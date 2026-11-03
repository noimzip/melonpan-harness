import React from 'react';
import {
  Gauge,
  Database,
  Scissors,
  Archive,
  Coins,
  ShieldAlert,
} from 'lucide-react';
import {
  calculateTokenCost,
  DEFAULT_COST_CAP_USD,
  USD_TO_JPY_RATE,
  resolveModelContextWindow,
  formatTokens,
} from '@melonpan/core';
import { ContextMetrics } from '../types';
import { WobblyButton } from './WobblyButton';

interface ContextGaugeProps {
  metrics: ContextMetrics;
  onManualCompact: () => void;
}

export function ContextGauge({ metrics, onManualCompact }: ContextGaugeProps) {
  const contextWindowLimit =
    metrics.contextWindowLimit && metrics.contextWindowLimit > 0
      ? metrics.contextWindowLimit
      : resolveModelContextWindow(metrics.activeModel || 'gemini-3.8-flash');

  const usagePercent = contextWindowLimit > 0
    ? Math.min(100, Math.round((metrics.currentContextTokens / contextWindowLimit) * 100))
    : 0;

  const remainingTokens = Math.max(0, contextWindowLimit - metrics.currentContextTokens);

  const computedCost = calculateTokenCost({
    model: metrics.activeModel || 'gemini-3.8-flash',
    billedPromptTokens: metrics.billedInputTokens,
    rawPromptTokens: metrics.billedInputTokens + metrics.cachedTokens,
    cachedPromptTokens: metrics.cachedTokens,
    completionTokens: metrics.billedOutputTokens,
  });

  const costUsd = metrics.estimatedCostUsd ?? computedCost.totalCostUsd;
  const costJpy = metrics.estimatedCostJpy ?? computedCost.totalCostJpy;
  const savedUsd = metrics.savedCostUsd ?? computedCost.savedCostUsd;
  const savedJpy = metrics.savedCostJpy ?? computedCost.savedCostJpy;
  const costCapUsd = DEFAULT_COST_CAP_USD;
  const costCapJpy = Math.round(costCapUsd * USD_TO_JPY_RATE);
  const costPercent = Math.min(100, Math.round((costUsd / costCapUsd) * 100));

  return (
    <div className="h-full overflow-y-auto p-5 space-y-6 bg-[var(--card)] select-none text-xs">
      {/* Header */}
      <div className="flex items-center justify-between border-b-2 border-[var(--stroke)] pb-3">
        <div className="flex items-center gap-2">
          <Gauge size={18} className="text-[var(--accent)]" />
          <h3 className="font-bold text-base">コンテキスト使用状況 & 燃費最適化</h3>
        </div>

        <WobblyButton size="sm" onClick={onManualCompact}>
          <Archive size={13} />
          コンテキスト要約 (/compact)
        </WobblyButton>
      </div>

      {/* Context Window Gauge Card */}
      <div className="p-4 rounded-2xl border-2 border-[var(--stroke)] bg-[var(--background)] rough-shadow-sm space-y-3">
        <div className="flex justify-between items-center">
          <span className="font-bold flex items-center gap-1.5">
            <span>Context Window 使用率</span>
            {metrics.activeModel && (
              <span className="text-[10px] font-mono font-normal opacity-70">
                ({metrics.activeModel})
              </span>
            )}
          </span>
          <span className="font-mono font-bold text-sm text-[var(--accent)]">
            {formatTokens(metrics.currentContextTokens)} / {formatTokens(contextWindowLimit)} ({usagePercent}%)
          </span>
        </div>

        {/* Progress Bar */}
        <div className="w-full h-3 rounded-full bg-[var(--card)] border border-[var(--stroke)] overflow-hidden">
          <div
            className="h-full bg-[var(--accent)] transition-all duration-500 rounded-full"
            style={{ width: `${usagePercent}%` }}
          />
        </div>

        <div className="flex flex-wrap justify-between gap-y-1 text-[11px] opacity-70 font-mono">
          <span>現在: {metrics.currentContextTokens.toLocaleString()} tokens ({formatTokens(metrics.currentContextTokens)})</span>
          <span>残余: {remainingTokens.toLocaleString()} tokens ({formatTokens(remainingTokens)})</span>
          <span>上限: {contextWindowLimit.toLocaleString()} tokens ({formatTokens(contextWindowLimit)})</span>
        </div>
      </div>

      {/* Token Accounting Breakdown */}
      <div className="p-4 rounded-2xl border-2 border-[var(--stroke)] bg-[var(--background)] rough-shadow-sm space-y-3">
        <div className="font-bold flex items-center gap-1.5">
          <Database size={15} className="text-[var(--accent)]" />
          <span>累計トークン消費 (Billed Tokens)</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
          <div className="p-2.5 rounded-xl bg-[var(--card)] border border-[var(--stroke)]/30">
            <div className="text-[10px] opacity-60">入力 (Input)</div>
            <div className="font-bold font-mono text-sm mt-0.5">
              {formatTokens(metrics.billedInputTokens)}
            </div>
            <div className="text-[10px] opacity-50 font-mono mt-0.5">
              {metrics.billedInputTokens.toLocaleString()}
            </div>
          </div>
          <div className="p-2.5 rounded-xl bg-[var(--card)] border border-[var(--stroke)]/30">
            <div className="text-[10px] opacity-60">出力 (Output)</div>
            <div className="font-bold font-mono text-sm mt-0.5">
              {formatTokens(metrics.billedOutputTokens)}
            </div>
            <div className="text-[10px] opacity-50 font-mono mt-0.5">
              {metrics.billedOutputTokens.toLocaleString()}
            </div>
          </div>
          <div className="p-2.5 rounded-xl bg-[var(--card)] border border-[var(--stroke)]/30">
            <div className="text-[10px] opacity-60">キャッシュ (Cached)</div>
            <div className="font-bold font-mono text-sm mt-0.5 text-[var(--warm-success)]">
              {formatTokens(metrics.cachedTokens)}
            </div>
            <div className="text-[10px] opacity-50 font-mono mt-0.5">
              {metrics.cachedTokens.toLocaleString()}
            </div>
          </div>
          <div className="p-2.5 rounded-xl bg-[var(--card)] border border-[var(--stroke)]/30">
            <div className="text-[10px] opacity-60">合計 (Total)</div>
            <div className="font-bold font-mono text-sm mt-0.5 text-[var(--accent)]">
              {formatTokens(metrics.totalTokens)}
            </div>
            <div className="text-[10px] opacity-50 font-mono mt-0.5">
              {metrics.totalTokens.toLocaleString()}
            </div>
          </div>
        </div>

        {/* Real-time Estimated Cost & Safety Circuit Breaker */}
        <div className="pt-2 border-t border-[var(--stroke)]/20 space-y-2">
          <div className="flex justify-between items-center p-2.5 rounded-xl bg-[var(--card)] border border-[var(--stroke)]/30">
            <span className="flex items-center gap-1.5 font-bold">
              <Coins size={14} className="text-[var(--warm-accent)]" />
              推定費用 (Estimated Cost):
            </span>
            <span className="font-mono font-bold text-sm text-[var(--accent)]">
              ${costUsd.toFixed(4)} USD (約 ¥{costJpy.toFixed(2)} JPY)
            </span>
          </div>

          <div className="flex justify-between items-center text-[11px] px-2 opacity-80">
            <span>Prefix Cache 節約額 (Cache Savings):</span>
            <span className="font-mono font-bold text-[var(--warm-success)]">
              -${savedUsd.toFixed(4)} USD (約 ¥{savedJpy.toFixed(2)} JPY)
            </span>
          </div>

          <div className="flex justify-between items-center text-[11px] px-2 opacity-80">
            <span className="flex items-center gap-1">
              <ShieldAlert size={12} className="text-[var(--warm-accent)]" />
              自動停止上限 (Cost Cap Circuit Breaker):
            </span>
            <span className="font-mono font-bold">
              ${costCapUsd.toFixed(2)} USD / 約 ¥{costCapJpy} JPY ({costPercent}%)
            </span>
          </div>
        </div>
      </div>

      {/* Pruning & Compaction Stats */}
      <div className="p-4 rounded-2xl border-2 border-[var(--stroke)] bg-[var(--background)] rough-shadow-sm space-y-3">
        <div className="font-bold flex items-center gap-1.5">
          <Scissors size={15} className="text-[var(--warm-accent)]" />
          <span>Clean-Room コンテキスト枝刈り (Pruning & Compaction)</span>
        </div>

        <div className="flex justify-between items-center text-xs p-2 rounded-xl bg-[var(--card)] border border-[var(--stroke)]/30">
          <span>削減文字数 (Pruned Chars):</span>
          <span className="font-mono font-bold text-[var(--warm-success)]">
            {metrics.prunedChars > 0 ? `-${metrics.prunedChars.toLocaleString()} chars` : '0 chars'}
          </span>
        </div>

        <div className="flex justify-between items-center text-xs p-2 rounded-xl bg-[var(--card)] border border-[var(--stroke)]/30">
          <span>Auto-Compaction 実行回数:</span>
          <span className="font-mono font-bold">{metrics.compactionCount} 回</span>
        </div>

        {/* Logs */}
        {metrics.compactionLogs && metrics.compactionLogs.length > 0 && (
          <div className="mt-2 space-y-1 font-mono text-[11px] opacity-75">
            {metrics.compactionLogs.map((log, idx) => (
              <div key={idx}>• {log}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
