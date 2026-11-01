import { useState } from 'react';
import {
  FileEdit,
  FileCode,
  Terminal,
  Search,
  Globe,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ChevronDown,
  ChevronRight,
  ShieldAlert,
} from 'lucide-react';
import { WebToolCall } from '../types';

interface ToolCardProps {
  toolCall: WebToolCall;
}

export function ToolCard({ toolCall }: ToolCardProps) {
  const [expanded, setExpanded] = useState(false);

  let icon = <FileCode size={15} />;
  let categoryLabel = 'ツール実行';

  if (toolCall.name.includes('write') || toolCall.name.includes('edit')) {
    icon = <FileEdit size={15} />;
    categoryLabel = 'ファイル変更';
  } else if (toolCall.name.includes('command') || toolCall.name.includes('bash')) {
    icon = <Terminal size={15} />;
    categoryLabel = 'コマンド実行';
  } else if (toolCall.name.includes('search') || toolCall.name.includes('grep')) {
    icon = <Search size={15} />;
    categoryLabel = '検索';
  } else if (toolCall.name.includes('web') || toolCall.name.includes('fetch')) {
    icon = <Globe size={15} />;
    categoryLabel = 'Web探索';
  }

  let statusBadge = (
    <span className="flex items-center gap-1 text-xs text-[var(--warm-accent)]">
      <Loader2 size={12} className="animate-spin" /> 実行中
    </span>
  );

  if (toolCall.status === 'success') {
    statusBadge = (
      <span className="flex items-center gap-1 text-xs text-[var(--warm-success)] font-medium">
        <CheckCircle2 size={12} /> 完了
      </span>
    );
  } else if (toolCall.status === 'error') {
    statusBadge = (
      <span className="flex items-center gap-1 text-xs text-[var(--warm-error)] font-medium">
        <AlertCircle size={12} /> エラー
      </span>
    );
  } else if (toolCall.status === 'denied') {
    statusBadge = (
      <span className="flex items-center gap-1 text-xs text-[var(--warm-error)] font-medium">
        <ShieldAlert size={12} /> 拒否
      </span>
    );
  }

  return (
    <div className="my-2 bg-[var(--background)]/80 rounded-xl border border-[var(--stroke)]/40 overflow-hidden text-xs">
      <div
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-black/5 select-none"
      >
        <div className="flex items-center gap-2">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span className="text-[var(--accent)]">{icon}</span>
          <span className="font-semibold text-[var(--foreground)]">{toolCall.name}</span>
          {toolCall.args.path && (
            <span className="font-mono text-[11px] opacity-70 truncate max-w-[160px]">
              {toolCall.args.path}
            </span>
          )}
          {toolCall.args.command && (
            <span className="font-mono text-[11px] opacity-70 truncate max-w-[160px]">
              $ {toolCall.args.command}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {statusBadge}
        </div>
      </div>

      {expanded && (
        <div className="p-3 border-t border-[var(--stroke)]/30 space-y-2 bg-[var(--card)]/40">
          <div>
            <div className="font-semibold opacity-75 mb-1">引数 (Arguments):</div>
            <pre className="p-2 bg-[var(--background)] rounded-lg border border-[var(--stroke)]/20 overflow-x-auto text-[11px]">
              {JSON.stringify(toolCall.args, null, 2)}
            </pre>
          </div>

          {toolCall.result && (
            <div>
              <div className="font-semibold opacity-75 mb-1">実行結果 (Result):</div>
              <pre className="p-2 bg-[var(--background)] rounded-lg border border-[var(--stroke)]/20 overflow-x-auto text-[11px] max-h-40">
                {typeof toolCall.result === 'string'
                  ? toolCall.result
                  : JSON.stringify(toolCall.result, null, 2)}
              </pre>
            </div>
          )}

          {toolCall.diff?.unifiedDiff && (
            <div>
              <div className="font-semibold opacity-75 mb-1">差分 (Diff):</div>
              <pre className="p-2 bg-[#2d2421] text-[#e0d5c5] rounded-lg overflow-x-auto text-[11px] font-mono">
                {toolCall.diff.unifiedDiff}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
