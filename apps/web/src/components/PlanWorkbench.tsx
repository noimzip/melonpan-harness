import React, { useState } from 'react';
import {
  CheckSquare,
  Square,
  CheckCircle2,
  XCircle,
  Clock,
  Edit3,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import { PlanState, PlanTask } from '../types';
import { WobblyButton } from './WobblyButton';

interface PlanWorkbenchProps {
  plan?: PlanState;
  onApprove: () => void;
  onReject: () => void;
  onRequestRevision: (feedback: string) => void;
  onUpdatePlanMarkdown: (markdown: string) => void;
  onUpdateTasks?: (tasks: PlanTask[]) => void;
}

export function PlanWorkbench({
  plan,
  onApprove,
  onReject,
  onRequestRevision,
  onUpdatePlanMarkdown,
  onUpdateTasks,
}: PlanWorkbenchProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(plan?.rawMarkdown || '');
  const [feedbackText, setFeedbackText] = useState('');
  const [showFeedbackInput, setShowFeedbackInput] = useState(false);

  if (!plan) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 text-center select-none">
        <div className="w-16 h-16 rounded-full bg-[var(--card)] border-2 border-[var(--stroke)] rough-shadow flex items-center justify-center text-2xl mb-4">
          📝
        </div>
        <h3 className="font-bold text-lg mb-2">計画書はまだありません</h3>
        <p className="text-sm opacity-70 max-w-md leading-relaxed">
          左下のモード選択を「Plan Mode」にするか、プロンプトに「/plan」と入力して指示を送ると、エージェントが実装前に詳細な計画書（plan.md）を作成します。
        </p>
      </div>
    );
  }

  const handleToggleTask = (taskId: string) => {
    const updatedTasks = plan.tasks.map((t) =>
      t.id === taskId
        ? {
            ...t,
            status:
              t.status === 'completed'
                ? ('pending' as const)
                : ('completed' as const),
          }
        : t
    );
    if (onUpdateTasks) {
      onUpdateTasks(updatedTasks);
    } else {
      plan.tasks = updatedTasks;
    }
  };

  const handleSaveEdit = () => {
    onUpdatePlanMarkdown(editText);
    setIsEditing(false);
  };

  let statusBadge = (
    <span className="px-2.5 py-1 rounded-full bg-[#faecd8] border border-[#af734a] text-[#af734a] text-xs font-semibold flex items-center gap-1">
      <Clock size={12} /> レビュー待ち (Pending)
    </span>
  );

  if (plan.status === 'approved') {
    statusBadge = (
      <span className="px-2.5 py-1 rounded-full bg-[#dcfce7] border border-[#22c55e] text-[#15803d] text-xs font-semibold flex items-center gap-1">
        <CheckCircle2 size={12} /> 承認済み (Approved)
      </span>
    );
  } else if (plan.status === 'rejected') {
    statusBadge = (
      <span className="px-2.5 py-1 rounded-full bg-[#fee2e2] border border-[#ef4444] text-[#b91c1c] text-xs font-semibold flex items-center gap-1">
        <XCircle size={12} /> 却下済み (Rejected)
      </span>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[var(--card)] select-none">
      {/* Workbench Header */}
      <div className="px-5 py-3 border-b-2 border-[var(--stroke)] bg-[var(--background)]/60 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="font-bold text-sm flex items-center gap-1.5">
            📝 開発計画ワークベンチ (Plan Review)
          </span>
          {statusBadge}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setEditText(plan.rawMarkdown);
              setIsEditing(!isEditing);
            }}
            className="px-2.5 py-1 rounded-lg border border-[var(--stroke)] text-xs font-medium hover:bg-black/5 flex items-center gap-1"
          >
            <Edit3 size={13} />
            {isEditing ? 'プレビュー' : '編集'}
          </button>
        </div>
      </div>

      {/* Main Plan Body */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {isEditing ? (
          <div className="h-full flex flex-col">
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              className="flex-1 w-full bg-[var(--background)] border-2 border-[var(--stroke)] rounded-xl p-4 font-mono text-sm leading-relaxed outline-none resize-none"
            />
            <div className="flex justify-end gap-2 mt-3">
              <WobblyButton size="sm" variant="outline" onClick={() => setIsEditing(false)}>
                キャンセル
              </WobblyButton>
              <WobblyButton size="sm" onClick={handleSaveEdit}>
                保存する
              </WobblyButton>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Checklist items */}
            {plan.tasks && plan.tasks.length > 0 && (
              <div className="bg-[var(--background)] p-4 rounded-2xl rough-outline border-2 border-[var(--stroke)]">
                <div className="text-xs font-bold mb-3 opacity-80 uppercase tracking-wider">
                  チェックリスト
                </div>
                <div className="space-y-2">
                  {plan.tasks.map((task) => (
                    <div
                      key={task.id}
                      onClick={() => handleToggleTask(task.id)}
                      className="flex items-center gap-2.5 p-2 rounded-xl hover:bg-black/5 cursor-pointer text-sm"
                    >
                      {task.status === 'completed' ? (
                        <CheckSquare size={17} className="text-[var(--warm-success)] shrink-0" />
                      ) : (
                        <Square size={17} className="opacity-60 shrink-0" />
                      )}
                      <span
                        className={task.status === 'completed' ? 'line-through opacity-60' : ''}
                      >
                        {task.title}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Markdown Plan Content */}
            <div className="bg-[var(--background)] p-5 rounded-2xl rough-outline border-2 border-[var(--stroke)] text-sm leading-relaxed whitespace-pre-wrap font-sans">
              {plan.rawMarkdown}
            </div>
          </div>
        )}

        {/* Feedback revision box */}
        {showFeedbackInput && (
          <div className="p-4 bg-[var(--background)] rounded-2xl border-2 border-[var(--warm-accent)] space-y-2 animate-in fade-in">
            <div className="font-semibold text-xs text-[var(--accent)]">
              修正・再計画の指示を入力してください:
            </div>
            <textarea
              rows={2}
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              placeholder="例: ボス戦のフェーズを先に追加して、パーティクルは控えめにしてください..."
              className="w-full bg-[var(--card)] border border-[var(--stroke)]/40 rounded-xl p-2.5 text-xs outline-none"
            />
            <div className="flex justify-end gap-2">
              <WobblyButton
                size="sm"
                variant="outline"
                onClick={() => setShowFeedbackInput(false)}
              >
                キャンセル
              </WobblyButton>
              <WobblyButton
                size="sm"
                onClick={() => {
                  if (feedbackText.trim()) {
                    onRequestRevision(feedbackText.trim());
                    setShowFeedbackInput(false);
                    setFeedbackText('');
                  }
                }}
              >
                修正指示を送信
              </WobblyButton>
            </div>
          </div>
        )}
      </div>

      {/* Plan Action Bar */}
      {plan.status === 'pending_review' && (
        <div className="p-4 border-t-2 border-[var(--stroke)] bg-[var(--background)]/80 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <WobblyButton
              variant="outline"
              size="sm"
              onClick={() => setShowFeedbackInput(!showFeedbackInput)}
            >
              <RotateCcw size={14} />
              修正指示
            </WobblyButton>
            <WobblyButton variant="danger" size="sm" onClick={onReject}>
              <XCircle size={14} />
              却下 (Reject)
            </WobblyButton>
          </div>

          <WobblyButton onClick={onApprove} className="!px-6">
            <CheckCircle2 size={16} />
            承認して実装を開始 (Approve & Act)
          </WobblyButton>
        </div>
      )}
    </div>
  );
}
