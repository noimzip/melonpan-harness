import React, { useState } from 'react';
import {
  ShieldAlert,
  Terminal,
  FileEdit,
  Globe,
  FileCode,
  Check,
  CheckCheck,
  X,
  Settings,
} from 'lucide-react';
import { PermissionRequest, PermissionPolicyConfig } from '../types';
import { WobblyButton } from './WobblyButton';

interface PermissionModalProps {
  request: PermissionRequest | null;
  policy: PermissionPolicyConfig;
  onUpdatePolicy: (policy: PermissionPolicyConfig) => void;
  isOpenSettings: boolean;
  onCloseSettings: () => void;
}

export function PermissionModal({
  request,
  policy,
  onUpdatePolicy,
  isOpenSettings,
  onCloseSettings,
}: PermissionModalProps) {
  const [localPolicy, setLocalPolicy] = useState<PermissionPolicyConfig>(policy);

  if (!request && !isOpenSettings) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in select-none">
      {/* 1. Interactive Permission Approval Modal */}
      {request && (
        <div className="bg-[var(--card)] border-2 border-[var(--stroke)] rounded-3xl rough-shadow max-w-lg w-full p-6 space-y-5 animate-in zoom-in-95">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#fee2e2] border-2 border-[#ef4444] text-[#b91c1c] flex items-center justify-center shrink-0">
              <ShieldAlert size={22} />
            </div>
            <div>
              <h3 className="font-bold text-base">セキュリティ権限の確認</h3>
              <p className="text-xs opacity-70">
                エージェントが次のツールを実行しようとしています。許可しますか？
              </p>
            </div>
          </div>

          <div className="bg-[var(--background)] p-3.5 rounded-2xl border border-[var(--stroke)]/40 space-y-2 text-xs">
            <div className="flex justify-between items-center">
              <span className="font-semibold opacity-70">対象ツール:</span>
              <span className="font-mono font-bold text-[var(--accent)]">{request.toolName}</span>
            </div>

            {request.commandString && (
              <div>
                <span className="font-semibold opacity-70">実行コマンド:</span>
                <pre className="mt-1 p-2 bg-black/5 rounded-lg font-mono text-[11px] overflow-x-auto">
                  $ {request.commandString}
                </pre>
              </div>
            )}

            {request.filePath && (
              <div>
                <span className="font-semibold opacity-70">ファイルパス:</span>
                <div className="mt-1 font-mono">{request.filePath}</div>
              </div>
            )}

            {request.diffPreview && (
              <div>
                <span className="font-semibold opacity-70">変更差分プレビュー:</span>
                <pre className="mt-1 p-2 bg-[#2d2421] text-[#e0d5c5] rounded-lg font-mono text-[11px] max-h-36 overflow-y-auto">
                  {request.diffPreview}
                </pre>
              </div>
            )}
          </div>

          <div className="flex flex-col sm:flex-row gap-2 justify-end pt-2">
            <WobblyButton
              variant="outline"
              size="sm"
              onClick={() => request.resolve('deny')}
              className="text-[var(--warm-error)] hover:bg-[var(--error-bg)]"
            >
              <X size={14} />
              拒否 (Deny)
            </WobblyButton>
            <WobblyButton
              variant="secondary"
              size="sm"
              onClick={() => request.resolve('always_allow')}
            >
              <CheckCheck size={14} />
              セッション中常に許可
            </WobblyButton>
            <WobblyButton size="sm" onClick={() => request.resolve('allow_once')}>
              <Check size={14} />
              1回のみ許可
            </WobblyButton>
          </div>
        </div>
      )}

      {/* 2. Permission Policy Settings Modal */}
      {!request && isOpenSettings && (
        <div className="bg-[var(--card)] border-2 border-[var(--stroke)] rounded-3xl rough-shadow max-w-md w-full p-6 space-y-5 animate-in zoom-in-95 text-xs">
          <div className="flex items-center justify-between border-b-2 border-[var(--stroke)] pb-3">
            <div className="flex items-center gap-2">
              <Settings size={18} className="text-[var(--accent)]" />
              <h3 className="font-bold text-base">権限ポリシー設定 (Security Policy)</h3>
            </div>
            <button onClick={onCloseSettings} className="p-1 hover:bg-black/5 rounded-lg">
              <X size={16} />
            </button>
          </div>

          <p className="opacity-75 leading-relaxed">
            ツール種別ごとのデフォルト権限ポリシー（自動許可 / 毎回確認 / 常に拒否）を設定します。
          </p>

          <div className="space-y-3">
            {(['read', 'write', 'command', 'web'] as const).map((cat) => {
              const labels = {
                read: 'ファイル読取 (read_file, list_files, grep_search)',
                write: 'ファイル書込・編集 (write_file, edit_file)',
                command: 'シェル・コマンド実行 (run_command)',
                web: 'Webアクセス (web_search, fetch_url)',
              };

              return (
                <div key={cat} className="p-3 bg-[var(--background)] rounded-2xl border border-[var(--stroke)]/30 space-y-1.5">
                  <div className="font-semibold">{labels[cat]}</div>
                  <div className="grid grid-cols-3 gap-1 bg-[var(--card)] p-1 rounded-xl">
                    {(['allow', 'ask', 'deny'] as const).map((val) => (
                      <button
                        key={val}
                        onClick={() => {
                          const updated = { ...localPolicy, [cat]: val };
                          setLocalPolicy(updated);
                          onUpdatePolicy(updated);
                        }}
                        className={[
                          'py-1 rounded-lg text-xs font-medium capitalize transition-all',
                          localPolicy[cat] === val
                            ? 'bg-[var(--accent)] text-white shadow-sm'
                            : 'opacity-70 hover:opacity-100',
                        ].join(' ')}
                      >
                        {val === 'allow' ? '許可' : val === 'ask' ? '確認' : '拒否'}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex justify-end pt-2">
            <WobblyButton size="sm" onClick={onCloseSettings}>
              閉じる
            </WobblyButton>
          </div>
        </div>
      )}
    </div>
  );
}
