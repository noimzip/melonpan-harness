import { useState } from 'react';
import {
  GitFork,
  ChevronDown,
  ChevronRight,
  Brain,
  Wrench,
  Clock,
  Coins,
  CheckCircle,
  AlertTriangle,
  Loader2,
  Sparkles,
} from 'lucide-react';
import { SubagentTrace } from '../types';

interface SubagentTreeProps {
  subagents: SubagentTrace[];
}

export function SubagentTree({ subagents }: SubagentTreeProps) {
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  if (!subagents || subagents.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 text-center select-none">
        <div className="w-16 h-16 rounded-full bg-[var(--card)] border-2 border-[var(--stroke)] rough-shadow flex items-center justify-center text-2xl mb-4">
          🤖
        </div>
        <h3 className="font-bold text-lg mb-2">サブエージェント履歴</h3>
        <p className="text-sm opacity-70 max-w-md leading-relaxed">
          タスク実行中にディスパッチされた ReAct サブエージェント（<code>researcher</code> や <code>code-reviewer</code>）の思考・ツール・監査レポートがここにリアルタイム表示されます。
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4 space-y-3 bg-[var(--card)] select-none">
      <div className="font-bold text-xs opacity-75 uppercase tracking-wider mb-2">
        サブエージェント実行ツリー ({subagents.length} 件)
      </div>

      {subagents.map((agent) => {
        const isExpanded = expandedIds[agent.id] ?? true;

        let verdictBadge = (
          <span className="flex items-center gap-1 text-xs text-[var(--warm-accent)]">
            <Loader2 size={12} className="animate-spin" /> 実行中
          </span>
        );

        if (agent.verdict === 'PASS') {
          verdictBadge = (
            <span className="px-2 py-0.5 rounded-full bg-[#dcfce7] border border-[#22c55e] text-[#15803d] text-[11px] font-bold flex items-center gap-1">
              <CheckCircle size={11} /> PASS
            </span>
          );
        } else if (agent.verdict === 'WARN') {
          verdictBadge = (
            <span className="px-2 py-0.5 rounded-full bg-[#fef9c3] border border-[#eab308] text-[#854d0e] text-[11px] font-bold flex items-center gap-1">
              <AlertTriangle size={11} /> WARN
            </span>
          );
        }

        return (
          <div
            key={agent.id}
            className="rounded-2xl border-2 border-[var(--stroke)] bg-[var(--background)] overflow-hidden rough-shadow-sm text-xs"
          >
            {/* Header */}
            <div
              onClick={() => toggleExpand(agent.id)}
              className="px-4 py-3 cursor-pointer hover:bg-black/5 flex items-center justify-between border-b border-[var(--stroke)]/20"
            >
              <div className="flex items-center gap-2">
                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <div className="w-6 h-6 rounded-lg bg-[var(--accent)] text-white flex items-center justify-center font-mono font-bold text-[10px]">
                  {agent.agentName.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <div className="font-bold text-[var(--foreground)]">{agent.agentName}</div>
                  <div className="text-[10px] opacity-60">{agent.role}</div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="hidden sm:flex items-center gap-3 opacity-70 text-[11px]">
                  <span className="flex items-center gap-1">
                    <Clock size={11} /> {agent.durationMs}ms
                  </span>
                  <span className="flex items-center gap-1">
                    <Coins size={11} /> {agent.tokens.total} tokens
                  </span>
                </div>
                {verdictBadge}
              </div>
            </div>

            {/* Expanded Body */}
            {isExpanded && (
              <div className="p-4 space-y-3 bg-[var(--card)]/40">
                {/* Task prompt */}
                <div>
                  <div className="font-semibold opacity-70 mb-1">指示プロンプト:</div>
                  <div className="p-2.5 rounded-xl bg-[var(--background)] border border-[var(--stroke)]/20 font-mono text-[11px]">
                    {agent.taskPrompt}
                  </div>
                </div>

                {/* Subagent thoughts */}
                {agent.thoughts && agent.thoughts.length > 0 && (
                  <div>
                    <div className="font-semibold opacity-70 mb-1 flex items-center gap-1">
                      <Brain size={12} className="text-[var(--accent)]" />
                      内部思考プロセス:
                    </div>
                    <div className="p-2.5 rounded-xl bg-[var(--background)] border border-[var(--stroke)]/20 font-mono text-[11px] space-y-1">
                      {agent.thoughts.map((th, idx) => (
                        <div key={idx} className="opacity-85">
                          • {th}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Final Audit Report */}
                {agent.report && (
                  <div>
                    <div className="font-semibold opacity-70 mb-1">最終監査レポート:</div>
                    <div className="p-2.5 rounded-xl bg-[var(--background)] border border-[var(--stroke)]/20 font-sans text-[12px] leading-relaxed">
                      {agent.report}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
