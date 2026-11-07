import React, { useRef, useState } from 'react';
import type { DiscoveredModel } from '@melonpan/core';
import type { ProviderType } from '../../types.js';
import type { KosenSessionRecord, ModelTierConfig } from './types.js';
import { retryKosenGeneration } from './retry-generation.js';

const providers: ProviderType[] = ['gemini', 'openai', 'anthropic', 'openrouter', 'orcarouter', 'groq', 'surplus'];
const efforts: ModelTierConfig['thinkingEffort'][] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

export function RetryGeneration({ session, catalog, onStarted, onClose }: {
  session: KosenSessionRecord;
  catalog: Partial<Record<ProviderType, { models: DiscoveredModel[] }>>;
  onStarted: (session: KosenSessionRecord) => void;
  onClose: () => void;
}) {
  const [config, setConfig] = useState<ModelTierConfig>({
    tier: session.model_tier, label: session.model_tier, description: '',
    provider: session.provider, model: session.model_name, thinkingEffort: session.thinking_effort,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const supported = catalog[config.provider]?.models.find(model => model.id === config.model)?.supportedEfforts;
  const invalidEffort = supported !== undefined && !supported.includes(config.thinkingEffort);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting.current || invalidEffort || !config.model.trim()) return;
    submitting.current = true; setBusy(true); setError('');
    try { onStarted(await retryKosenGeneration(session.id, config)); }
    catch (err) { setError(err instanceof Error ? err.message : '再生成を開始できませんでした。'); }
    finally { submitting.current = false; setBusy(false); }
  };
  return <form onSubmit={submit} className="border-2 border-[var(--stroke)] rounded-2xl p-4 space-y-3">
    <h3 className="font-bold">設定を変更して再生成</h3>
    <p className="text-xs">元の内容を引き継いだ新しいセッションを作成します。再生成には API 利用料金がかかります。</p>
    <p className="text-xs break-words">元のエラー: {session.error_message || '中断されました'}</p>
    <fieldset disabled={busy} className="flex flex-wrap gap-3">
      <label>プロバイダ <select value={config.provider} onChange={e => setConfig({ ...config, provider: e.target.value as ProviderType, model: '' })}>
        {providers.map(provider => <option key={provider}>{provider}</option>)}
      </select></label>
      <label>モデル <input required list="retry-models" value={config.model} onChange={e => setConfig({ ...config, model: e.target.value })} className="border rounded p-2" /></label>
      <datalist id="retry-models">{catalog[config.provider]?.models.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</datalist>
      <label>Reasoning effort <select value={invalidEffort ? '' : config.thinkingEffort} onChange={e => setConfig({ ...config, thinkingEffort: e.target.value as ModelTierConfig['thinkingEffort'] })}>
        {invalidEffort && <option value="" disabled>対応するレベルを選択してください</option>}
        {(supported ?? efforts).map(effort => <option key={effort}>{effort}</option>)}
      </select></label>
    </fieldset>
    {error && <p role="alert">{error}</p>}
    <div className="flex gap-4">
      <button type="submit" disabled={busy || invalidEffort || !config.model.trim()} className="border rounded px-3 py-2">{busy ? '開始中…' : 'この設定で再生成'}</button>
      <button type="button" disabled={busy} onClick={onClose}>閉じる</button>
    </div>
  </form>;
}
