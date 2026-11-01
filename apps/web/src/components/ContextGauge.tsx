import React from 'react';
import {
  Gauge,
  Database,
  Scissors,
  Archive,
  RotateCw,
  Sparkles,
} from 'lucide-react';
import { ContextMetrics } from '../types';
import { WobblyButton } from './WobblyButton';

interface ContextGaugeProps {
  metrics: ContextMetrics;
  onManualCompact: () => void;
}

export function ContextGauge({ metrics, onManualCompact }: ContextGaugeProps) {
  const usagePercent = Math.min(
    100,
    Math.round((metrics.currentContextTokens / metrics.contextWindowLimit) * 100)
  );

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
          <span className="font-bold">Context Window 使用率</span>
          <span className="font-mono font-bold text-sm text-[var(--accent)]">
            {usagePercent}%
          </span>
        </div>

        {/* Progress Bar */}
        <div className="w-full h-3 rounded-full bg-[var(--card)] border border-[var(--stroke)] overflow-hidden">
          <div
            className="h-full bg-[var(--accent)] transition-all duration-500 rounded-full"
            style={{ width: `${usagePercent}%` }}
          />
        </div>

        <div className="flex justify-between text-[11px] opacity-70 font-mono">
          <span>現在: {metrics.currentContextTokens.toLocaleString()} tokens</span>
          <span>上限: {metrics.contextWindowLimit.toLocaleString()} tokens</span>
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
              {metrics.billedInputTokens.toLocaleString()}
            </div>
          </div>
          <div className="p-2.5 rounded-xl bg-[var(--card)] border border-[var(--stroke)]/30">
            <div className="text-[10px] opacity-60">出力 (Output)</div>
            <div className="font-bold font-mono text-sm mt-0.5">
              {metrics.billedOutputTokens.toLocaleString()}
            </div>
          </div>
          <div className="p-2.5 rounded-xl bg-[var(--card)] border border-[var(--stroke)]/30">
            <div className="text-[10px] opacity-60">キャッシュ (Cached)</div>
            <div className="font-bold font-mono text-sm mt-0.5 text-[var(--warm-success)]">
              {metrics.cachedTokens.toLocaleString()}
            </div>
          </div>
          <div className="p-2.5 rounded-xl bg-[var(--card)] border border-[var(--stroke)]/30">
            <div className="text-[10px] opacity-60">合計 (Total)</div>
            <div className="font-bold font-mono text-sm mt-0.5 text-[var(--accent)]">
              {metrics.totalTokens.toLocaleString()}
            </div>
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
