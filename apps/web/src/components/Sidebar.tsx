import React, { useState } from 'react';
import {
  Plus,
  Trash2,
  Edit2,
  Check,
  X,
  Sun,
  Moon,
  Settings,
  Sparkles,
  Shield,
  Layers,
  MonitorPlay,
} from 'lucide-react';
import { Session } from '../types';
import { WobblyButton } from './WobblyButton';

interface SidebarProps {
  sessions: Session[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onDeleteSession: (id: string) => void;
  onRenameSession: (id: string, newName: string) => void;
  sessionMode: 'auto' | 'plan' | 'act';
  onChangeMode: (mode: 'auto' | 'plan' | 'act') => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onOpenSettings: () => void;
  onOpenKiosk: () => void;
}

export function Sidebar({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  onRenameSession,
  sessionMode,
  onChangeMode,
  theme,
  onToggleTheme,
  onOpenSettings,
  onOpenKiosk,
}: SidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const handleStartRename = (e: React.MouseEvent, s: Session) => {
    e.stopPropagation();
    setEditingId(s.id);
    setEditingName(s.name);
  };

  const handleSaveRename = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (editingName.trim()) {
      onRenameSession(id, editingName.trim());
    }
    setEditingId(null);
  };

  const handleCancelRename = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(null);
  };

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm('このセッションを削除してもよろしいですか？')) {
      onDeleteSession(id);
    }
  };

  return (
    <aside className="w-72 sm:w-80 h-full flex flex-col bg-[var(--card)] border-r-2 border-[var(--stroke)] select-none">
      {/* Header */}
      <div className="p-4 flex items-center justify-between border-b-2 border-[var(--stroke)]">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🍈</span>
          <span className="font-bold text-lg tracking-wide">チャット一覧</span>
        </div>
      </div>

      {/* New Chat Button */}
      <div className="p-4">
        <WobblyButton
          onClick={onNewSession}
          className="w-full justify-center !py-2.5 text-base"
          variant="secondary"
        >
          <Plus size={18} />
          新しいチャット
        </WobblyButton>
      </div>

      {/* Session List */}
      <div className="flex-1 overflow-y-auto px-3 space-y-2">
        {sessions.map((s) => {
          const isActive = s.id === activeSessionId;
          const isEditing = editingId === s.id;

          return (
            <div
              key={s.id}
              onClick={() => onSelectSession(s.id)}
              className={[
                'group flex items-center justify-between px-3.5 py-2.5 rounded-xl cursor-pointer transition-all',
                isActive
                  ? 'bg-[var(--aesthetic-white)] rough-outline rough-shadow-sm font-semibold text-[var(--accent)]'
                  : 'hover:bg-black/5 text-[var(--foreground)]',
              ].join(' ')}
            >
              {isEditing ? (
                <div className="flex items-center gap-1.5 w-full" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="text"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    className="flex-1 bg-transparent border-b-2 border-[var(--stroke)] text-sm px-1 py-0.5 outline-none font-sans"
                    autoFocus
                  />
                  <button
                    onClick={(e) => handleSaveRename(e, s.id)}
                    className="p-1 text-[var(--warm-success)] hover:scale-110"
                    title="保存"
                  >
                    <Check size={16} />
                  </button>
                  <button
                    onClick={handleCancelRename}
                    className="p-1 text-[var(--warm-error)] hover:scale-110"
                    title="キャンセル"
                  >
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <>
                  <span className="truncate text-sm flex-1 mr-2">{s.name}</span>
                  <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity">
                    <button
                      onClick={(e) => handleStartRename(e, s)}
                      className="p-1 hover:text-[var(--accent)] hover:scale-110"
                      title="名前を変更"
                    >
                      <Edit2 size={14} />
                    </button>
                    {sessions.length > 1 && (
                      <button
                        onClick={(e) => handleDelete(e, s.id)}
                        className="p-1 hover:text-[var(--warm-error)] hover:scale-110"
                        title="削除"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Mode Selector Card */}
      <div className="p-3 border-t-2 border-[var(--stroke)] bg-[var(--background)]/40">
        <div className="text-xs font-semibold mb-2 flex items-center gap-1.5 opacity-80">
          <Layers size={14} />
          実行モード選択
        </div>
        <div className="grid grid-cols-3 gap-1 bg-[var(--card)] p-1 rounded-xl rough-outline-thin">
          <button
            onClick={() => onChangeMode('auto')}
            className={[
              'py-1.5 text-xs rounded-lg font-medium transition-colors',
              sessionMode === 'auto'
                ? 'bg-[var(--accent)] text-white shadow-sm'
                : 'hover:bg-black/5 opacity-70',
            ].join(' ')}
          >
            通常
          </button>
          <button
            onClick={() => onChangeMode('plan')}
            className={[
              'py-1.5 text-xs rounded-lg font-medium transition-colors',
              sessionMode === 'plan'
                ? 'bg-[var(--accent)] text-white shadow-sm'
                : 'hover:bg-black/5 opacity-70',
            ].join(' ')}
          >
            Plan Mode
          </button>
          <button
            onClick={() => onChangeMode('act')}
            className={[
              'py-1.5 text-xs rounded-lg font-medium transition-colors',
              sessionMode === 'act'
                ? 'bg-[var(--accent)] text-white shadow-sm'
                : 'hover:bg-black/5 opacity-70',
            ].join(' ')}
          >
            Act Only
          </button>
        </div>
      </div>

      {/* Theme Toggle Card */}
      <div className="p-3 border-t-2 border-[var(--stroke)] bg-[var(--background)]/30 flex items-center justify-between">
        <span className="text-xs font-semibold opacity-80">外観</span>
        <div className="flex gap-1 bg-[var(--card)] p-1 rounded-xl rough-outline-thin">
          <button
            onClick={() => theme !== 'light' && onToggleTheme()}
            className={[
              'px-2.5 py-1 text-xs rounded-lg flex items-center gap-1 font-medium transition-all',
              theme === 'light'
                ? 'bg-[var(--accent)] text-white shadow-sm'
                : 'opacity-70 hover:opacity-100',
            ].join(' ')}
          >
            <Sun size={12} />
            ライト
          </button>
          <button
            onClick={() => theme !== 'dark' && onToggleTheme()}
            className={[
              'px-2.5 py-1 text-xs rounded-lg flex items-center gap-1 font-medium transition-all',
              theme === 'dark'
                ? 'bg-[var(--accent)] text-white shadow-sm'
                : 'opacity-70 hover:opacity-100',
            ].join(' ')}
          >
            <Moon size={12} />
            ダーク
          </button>
        </div>
      </div>

      {/* Footer Settings & Kiosk Mode Buttons */}
      <div className="p-3 border-t-2 border-[var(--stroke)] flex gap-2">
        <button
          onClick={onOpenSettings}
          className="flex-1 py-2 px-3 rounded-xl border-2 border-[var(--stroke)] bg-[var(--card)] hover:bg-[var(--background)] flex items-center justify-center gap-1.5 text-xs font-semibold rough-shadow-sm"
        >
          <Settings size={14} />
          設定とヘルプ
        </button>
        <button
          onClick={onOpenKiosk}
          className="py-2 px-3 rounded-xl border-2 border-[var(--stroke)] bg-[var(--accent)] text-white hover:brightness-105 flex items-center justify-center gap-1.5 text-xs font-semibold rough-shadow-sm"
          title="展示キオスクモード"
        >
          <MonitorPlay size={14} />
          展示
        </button>
      </div>
    </aside>
  );
}
