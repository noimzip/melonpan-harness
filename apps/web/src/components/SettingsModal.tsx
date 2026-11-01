import React, { useState } from 'react';
import {
  Settings,
  X,
  Key,
  Cpu,
  BrainCircuit,
  Sliders,
  Check,
  Globe,
  Sparkles,
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
            <h3 className="font-bold text-base">プロバイダー & LLM設定</h3>
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
                { id: 'simulation', label: '🍈 Simulation (オフライン)' },
                { id: 'gemini', label: '⚡ Google Gemini' },
                { id: 'openai', label: '🤖 OpenAI Compatible' },
                { id: 'openrouter', label: '🔀 OpenRouter' },
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

          {/* Model Name */}
          <div className="space-y-1">
            <label className="font-bold opacity-80">モデル名 (Model Identifier)</label>
            <input
              type="text"
              value={local.model}
              onChange={(e) => setLocal((prev) => ({ ...prev, model: e.target.value }))}
              placeholder="gemini-2.5-flash, gpt-4o, etc."
              className="w-full bg-[var(--background)] border border-[var(--stroke)]/40 rounded-xl px-3 py-2 outline-none font-mono text-xs"
            />
          </div>

          {/* API Key */}
          {local.provider !== 'simulation' && local.provider !== 'bridge' && (
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

          {/* Thinking Effort */}
          <div className="space-y-1.5">
            <label className="font-bold flex items-center gap-1.5 opacity-80">
              <BrainCircuit size={14} />
              思考深度 (Thinking Effort for Gemini 2.5/3 Flash & Pro)
            </label>
            <div className="grid grid-cols-4 gap-1 bg-[var(--background)] p-1 rounded-xl border border-[var(--stroke)]/30">
              {(['minimal', 'low', 'medium', 'high'] as const).map((eff) => (
                <button
                  key={eff}
                  type="button"
                  onClick={() => setLocal((prev) => ({ ...prev, thinkingEffort: eff }))}
                  className={[
                    'py-1 rounded-lg text-xs font-medium capitalize transition-all',
                    local.thinkingEffort === eff
                      ? 'bg-[var(--accent)] text-white shadow-sm'
                      : 'opacity-70 hover:opacity-100',
                  ].join(' ')}
                >
                  {eff}
                </button>
              ))}
            </div>
          </div>

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
