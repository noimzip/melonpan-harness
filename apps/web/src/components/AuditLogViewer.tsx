import React, { useState, useMemo } from 'react';
import {
  ScrollText,
  Download,
  Filter,
  Search,
  CheckCircle2,
  AlertTriangle,
  Coins,
  Cpu,
  Brain,
  Wrench,
  ChevronDown,
  ChevronRight,
  FileCode,
  Clock,
} from 'lucide-react';
import { Session } from '../types';
import {
  AgentEvent,
  formatEventAsText,
  formatTranscriptMarkdown,
  formatTranscriptJsonl,
  formatTokens,
} from '@melonpan/core';
import { WobblyButton } from './WobblyButton';

interface AuditLogViewerProps {
  session: Session;
}

type LogCategory = 'all' | 'thought' | 'tool' | 'error' | 'metrics';

export function AuditLogViewer({ session }: AuditLogViewerProps) {
  const [filterCategory, setFilterCategory] = useState<LogCategory>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedIndices, setExpandedIndices] = useState<Set<number>>(new Set());

  const events: AgentEvent[] = session.events || [];

  // デルタ系以外の重要なログイベントを抽出
  const filteredEvents = useMemo(() => {
    return events.filter((ev) => {
      // デルタイベントはログ一覧を埋め尽くすため非表示
      if (
        ev.type === 'THOUGHT_DELTA' ||
        ev.type === 'TEXT_DELTA' ||
        ev.type === 'TOOL_CALL_DELTA'
      ) {
        return false;
      }

      // カテゴリフィルター
      if (filterCategory === 'thought' && ev.type !== 'THOUGHT') return false;
      if (
        filterCategory === 'tool' &&
        ev.type !== 'TOOL_CALL' &&
        ev.type !== 'TOOL_RESULT' &&
        ev.type !== 'FILE_CHANGED'
      ) {
        return false;
      }
      if (filterCategory === 'error' && ev.type !== 'ERROR' && !ev.payload?.isError) {
        return false;
      }
      if (filterCategory === 'metrics' && ev.type !== 'USAGE' && ev.type !== 'CONTEXT_COMPACTED') {
        return false;
      }

      // 検索フィルター
      if (searchQuery.trim()) {
        const text = formatEventAsText(ev).toLowerCase();
        if (!text.includes(searchQuery.toLowerCase())) {
          return false;
        }
      }

      return true;
    });
  }, [events, filterCategory, searchQuery]);

  const toggleExpand = (index: number) => {
    setExpandedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const handleDownloadJsonl = () => {
    const jsonlContent = formatTranscriptJsonl(events);
    const blob = new Blob([jsonlContent], { type: 'application/x-ndjson;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${session.id}_audit_log.jsonl`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadMarkdown = () => {
    const lastUserMsg = session.messages.filter((m) => m.role === 'user').pop();
    const mdContent = formatTranscriptMarkdown({
      sessionId: session.id,
      model: session.metrics?.activeModel || 'gemini-3.8-flash',
      mode: session.mode,
      prompt: lastUserMsg?.content || '',
      events,
    });
    const blob = new Blob([mdContent], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${session.id}_transcript.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const getEventBadge = (ev: AgentEvent) => {
    switch (ev.type) {
      case 'THOUGHT':
        return {
          icon: <Brain size={13} className="text-purple-500" />,
          label: '思考 (Thought)',
          bg: 'bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/20',
        };
      case 'TOOL_CALL':
        return {
          icon: <Wrench size={13} className="text-blue-500" />,
          label: `Tool: ${ev.payload?.name || 'call'}`,
          bg: 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20',
        };
      case 'TOOL_RESULT':
        return ev.payload?.isError
          ? {
              icon: <AlertTriangle size={13} className="text-red-500" />,
              label: `Tool Error: ${ev.payload?.name || ''}`,
              bg: 'bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/20',
            }
          : {
              icon: <CheckCircle2 size={13} className="text-emerald-500" />,
              label: `Tool Result: ${ev.payload?.name || ''}`,
              bg: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20',
            };
      case 'FILE_CHANGED':
        return {
          icon: <FileCode size={13} className="text-amber-500" />,
          label: `File: ${ev.payload?.path || ''}`,
          bg: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20',
        };
      case 'USAGE':
        return {
          icon: <Coins size={13} className="text-[var(--accent)]" />,
          label: `Usage (Turn ${ev.payload?.turn ?? 1})`,
          bg: 'bg-amber-500/10 text-[var(--accent)] border-amber-500/20',
        };
      case 'ERROR':
        return {
          icon: <AlertTriangle size={13} className="text-red-500" />,
          label: 'エラー (Error)',
          bg: 'bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/20',
        };
      default:
        return {
          icon: <Cpu size={13} className="text-slate-500" />,
          label: ev.type,
          bg: 'bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/20',
        };
    }
  };

  return (
    <div className="h-full flex flex-col p-5 space-y-4 bg-[var(--card)] select-none text-xs overflow-hidden">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between border-b-2 border-[var(--stroke)] pb-3 gap-2 flex-shrink-0">
        <div className="flex items-center gap-2">
          <ScrollText size={18} className="text-[var(--accent)]" />
          <div>
            <h3 className="font-bold text-base">実行ログ & 監査タイムライン (Audit Logs)</h3>
            <div className="text-[11px] opacity-60">
              セッション内の全思考プロセス・ツール実行・トークン消費・差分を時系列で追跡
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <WobblyButton size="sm" onClick={handleDownloadJsonl} disabled={events.length === 0}>
            <Download size={13} />
            JSONL
          </WobblyButton>
          <WobblyButton size="sm" onClick={handleDownloadMarkdown} disabled={events.length === 0}>
            <Download size={13} />
            Markdown
          </WobblyButton>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 flex-shrink-0">
        <div className="flex items-center gap-1 bg-[var(--background)] p-1 rounded-xl border border-[var(--stroke)]/50">
          <Filter size={13} className="opacity-50 ml-1.5" />
          {[
            { id: 'all', label: 'すべて' },
            { id: 'thought', label: '💭 思考' },
            { id: 'tool', label: '⚡ ツール' },
            { id: 'error', label: '⚠️ エラー' },
            { id: 'metrics', label: '💰 費用/消費' },
          ].map((cat) => (
            <button
              key={cat.id}
              onClick={() => setFilterCategory(cat.id as LogCategory)}
              className={[
                'px-2 py-1 rounded-lg text-xs font-semibold transition-all',
                filterCategory === cat.id
                  ? 'bg-[var(--accent)] text-white'
                  : 'hover:bg-black/5 opacity-70',
              ].join(' ')}
            >
              {cat.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-[var(--background)] border border-[var(--stroke)]/50">
          <Search size={13} className="opacity-50" />
          <input
            type="text"
            placeholder="ログを検索..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-transparent border-none outline-none text-xs w-36 sm:w-48 placeholder:opacity-40"
          />
        </div>
      </div>

      {/* Log Events List */}
      <div className="flex-1 overflow-y-auto space-y-2 pr-1">
        {filteredEvents.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center p-8 text-center opacity-60">
            <ScrollText size={32} className="mb-2 stroke-1" />
            <div className="font-bold">該当するログがありません</div>
            <div className="text-[11px]">エージェントを実行するとここに詳細な時系列ログが記録されます。</div>
          </div>
        ) : (
          filteredEvents.map((ev, idx) => {
            const badge = getEventBadge(ev);
            const isExpanded = expandedIndices.has(idx);
            const timeStr = ev.timestamp
              ? new Date(ev.timestamp).toLocaleTimeString()
              : '--:--:--';

            return (
              <div
                key={idx}
                className="p-2.5 rounded-xl border border-[var(--stroke)]/40 bg-[var(--background)] rough-shadow-sm space-y-1.5 text-xs transition-all"
              >
                <div
                  className="flex items-center justify-between cursor-pointer select-none"
                  onClick={() => toggleExpand(idx)}
                >
                  <div className="flex items-center gap-2">
                    <span className="opacity-40 hover:opacity-100">
                      {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-mono text-[11px] border font-bold ${badge.bg}`}
                    >
                      {badge.icon}
                      {badge.label}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 opacity-50 font-mono text-[11px]">
                    <Clock size={11} />
                    <span>{timeStr}</span>
                  </div>
                </div>

                {/* Summary / Preview */}
                <div className="text-[11px] opacity-80 pl-6 font-mono break-all line-clamp-2">
                  {ev.type === 'THOUGHT' && String(ev.payload?.thought || '').slice(0, 150)}
                  {ev.type === 'TOOL_CALL' &&
                    `Args: ${JSON.stringify(ev.payload?.args || {})}`}
                  {ev.type === 'TOOL_RESULT' &&
                    `Output (${ev.payload?.output?.length || 0} chars): ${String(ev.payload?.output || '').slice(0, 120)}`}
                  {ev.type === 'FILE_CHANGED' &&
                    `${ev.payload?.action || 'write'} ${ev.payload?.path} (${ev.payload?.content?.length || 0} chars)`}
                  {ev.type === 'USAGE' &&
                    `Input: ${ev.payload?.billedPromptTokens || ev.payload?.promptTokens} | Output: ${ev.payload?.completionTokens} | Total: ${ev.payload?.totalTokens}${ev.payload?.contextWindowTokens !== undefined ? ` | Ctx: ${formatTokens(ev.payload.contextWindowTokens)}/${formatTokens(ev.payload.maxContextWindowTokens || 0)}` : ''}${ev.payload?.cost ? ` | Cost: $${ev.payload.cost.totalCostUsd.toFixed(4)}` : ''}`}
                  {ev.type === 'COMPLETE' &&
                    `Turns: ${ev.payload?.turns} | Time: ${ev.payload?.durationMs}ms | ${ev.payload?.summary}`}
                  {ev.type === 'ERROR' && String(ev.payload?.message || '')}
                </div>

                {/* Expanded Details */}
                {isExpanded && (
                  <div className="mt-2 pt-2 border-t border-[var(--stroke)]/20 pl-6 space-y-2 font-mono text-[11px]">
                    <div className="bg-[var(--card)] p-2.5 rounded-lg border border-[var(--stroke)]/30 overflow-x-auto max-h-60 overflow-y-auto whitespace-pre-wrap">
                      {formatEventAsText(ev) || JSON.stringify(ev.payload, null, 2)}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
