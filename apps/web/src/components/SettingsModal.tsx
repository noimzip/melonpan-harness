import React, { useState } from 'react';
import {
  Settings,
  X,
  Key,
  Cpu,
  Check,
  Globe,
} from 'lucide-react';
import { ProviderConfig } from '../types';
import { WobblyButton } from './WobblyButton';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: ProviderConfig;
  onSaveConfig: (newConfig: ProviderConfig) => void;
}

export function SettingsModal({
  isOpen,
  onClose,
  config,
  onSaveConfig,
}: SettingsModalProps) {
  const [local, setLocal] = useState<ProviderConfig>(config);
  const [savedSuccess, setSavedSuccess] = useState(false);

  if (!isOpen) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveConfig(local);
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      onClose();
    }, 800);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in select-none">
      <div className="bg-[var(--card)] border-2 border-[var(--stroke)] rounded-3xl rough-shadow max-w-lg w-full p-6 space-y-5 animate-in zoom-in-95 text-xs">
        {/* Header */}
        <div className="flex items-center justify-between border-b-2 border-[var(--stroke)] pb-3">
          <div className="flex items-center gap-2">
            <Settings size={18} className="text-[var(--accent)]" />
            <h3 className="font-bold text-base">プロバイダー & APIキー設定</h3>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-black/5 rounded-lg">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSave} className="space-y-4">
          {/* Provider Selection */}
          <div className="space-y-1.5">
            <label className="font-bold flex items-center gap-1.5 opacity-80">
              <Cpu size={14} />
              推論プロバイダー (Provider)
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              {[
                { id: 'gemini', label: '⚡ Google Gemini' },
                { id: 'openai', label: '🤖 OpenAI Compatible' },
                { id: 'anthropic', label: '🧠 Anthropic Claude' },
                { id: 'openrouter', label: '🔀 OpenRouter' },
                { id: 'orcarouter', label: '🐋 OrcaRouter' },
                { id: 'groq', label: '⚡ Groq (Llama)' },
                { id: 'bridge', label: '🔌 Local Node.js Bridge' },
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() =>
                    setLocal((prev) => ({
                      ...prev,
                      provider: item.id as ProviderConfig['provider'],
                    }))
                  }
                  className={[
                    'p-2 rounded-xl text-left font-medium border-2 transition-all',
                    local.provider === item.id
                      ? 'border-[var(--stroke)] bg-[var(--aesthetic-white)] rough-shadow-sm font-bold text-[var(--accent)]'
                      : 'border-transparent hover:bg-black/5 opacity-70',
                  ].join(' ')}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {/* API Key */}
          {local.provider !== 'bridge' && (
            <div className="space-y-1 animate-in fade-in">
              <label className="font-bold flex items-center gap-1 opacity-80">
                <Key size={13} />
                APIキー (ブラウザ内にのみ安全に保存されます)
              </label>
              <input
                type="password"
                value={local.apiKey}
                onChange={(e) => setLocal((prev) => ({ ...prev, apiKey: e.target.value }))}
                placeholder="AIza... または sk-..."
                className="w-full bg-[var(--background)] border border-[var(--stroke)]/40 rounded-xl px-3 py-2 outline-none font-mono text-xs"
              />
            </div>
          )}

          {/* Node.js Bridge URL */}
          {local.provider === 'bridge' && (
            <div className="space-y-1 animate-in fade-in">
              <label className="font-bold flex items-center gap-1 opacity-80">
                <Globe size={13} />
                ローカルブリッジサーバーURL (Local Node.js HTTP/WebSocket)
              </label>
              <input
                type="text"
                value={local.bridgeUrl}
                onChange={(e) => setLocal((prev) => ({ ...prev, bridgeUrl: e.target.value }))}
                placeholder="http://localhost:3001/api/agent"
                className="w-full bg-[var(--background)] border border-[var(--stroke)]/40 rounded-xl px-3 py-2 outline-none font-mono text-xs"
              />
            </div>
          )}

          {/* Footer Action */}
          <div className="flex justify-end gap-2 pt-2 border-t border-[var(--stroke)]/20">
            <WobblyButton size="sm" variant="outline" onClick={onClose}>
              キャンセル
            </WobblyButton>
            <WobblyButton size="sm" type="submit">
              {savedSuccess ? (
                <>
                  <Check size={14} className="text-[var(--warm-success)]" />
                  保存しました！
                </>
              ) : (
                '設定を保存'
              )}
            </WobblyButton>
          </div>
        </form>
      </div>
    </div>
  );
}
