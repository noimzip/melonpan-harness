import React, { useEffect, useState } from 'react';
import { invokeKosenAiProxy } from './supabase.js';
interface Log { id: string; created_at: string; session_id?: string; provider?: string; model?: string; event: string; details: Record<string, unknown> }
export function GenerationLogs() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [provider, setProvider] = useState('');
  const [event, setEvent] = useState('');
  const [since, setSince] = useState('');
  const [offset, setOffset] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    invokeKosenAiProxy<{ logs: Log[] }>('list_generation_logs', { provider, event, since: since ? new Date(since).toISOString() : undefined, offset })
      .then(data => { if (!cancelled) setLogs(data.logs); })
      .catch(() => { if (!cancelled) setError('ログを取得できませんでした。再読み込みしてください。'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [provider, event, since, offset, refresh]);
  return <section className="space-y-4">
    <h2 className="text-xl font-bold">生成ログ（過去30日）</h2>
    <div className="flex flex-wrap gap-3">
      <label>プロバイダ <input className="border rounded p-2" value={provider} onChange={e => { setProvider(e.target.value); setOffset(0); }} placeholder="surplus" /></label>
      <label>状態 <select className="border rounded p-2" value={event} onChange={e => { setEvent(e.target.value); setOffset(0); }}>
        <option value="">すべて</option>{Object.entries({ started: '開始', tool: 'ツール実行', completed: '完了', cancelled: '中断', failed: '失敗', provider_error: 'プロバイダエラー' }).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label>日時以降 <input type="datetime-local" value={since} onChange={e => { setSince(e.target.value); setOffset(0); }} /></label>
      <button onClick={() => setRefresh(v => v + 1)}>再読み込み</button>
    </div>
    {loading ? <p role="status">取得中…</p> : error ? <p role="alert">{error}</p> : logs.length === 0 ? <p>ログがありません。</p> : logs.map(log => <details key={log.id} className="border rounded p-3">
      <summary className="cursor-pointer">{new Date(log.created_at).toLocaleString()} · {log.event} · {log.provider} · {log.model}</summary>
      <p className="break-all">セッション: {log.session_id || 'なし'}</p>
      <pre className="whitespace-pre-wrap break-all text-sm">{JSON.stringify(log.details, null, 2)}</pre>
    </details>)}
    <div className="flex gap-4"><button disabled={loading || offset === 0} onClick={() => setOffset(v => Math.max(0, v - 100))}>前の100件</button><button disabled={loading || logs.length < 100} onClick={() => setOffset(v => v + 100)}>次の100件</button></div>
  </section>;
}
