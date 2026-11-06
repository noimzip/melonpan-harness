import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import {
  Shield,
  Sliders,
  Activity,
  Trophy,
  Key,
  Save,
  Trash2,
  Eye,
  EyeOff,
  StopCircle,
  RefreshCw,
  LogOut,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  Code2,
  ArrowLeft,
} from 'lucide-react';
import { HandDrawnFilter } from '../../../components/HandDrawnFilter';
import { WobblyCard } from '../../../components/WobblyCard';
import { WobblyButton } from '../../../components/WobblyButton';
import { ProviderType } from '../../../types';
import { fetchDiscoveredModels, DiscoveredModel } from '@melonpan/core';
import {
  ALL_SUPPORTED_MODELS,
  getStoredApiKeys,
  maskApiKey,
  saveStoredApiKey,
} from '../../../services/provider-factory';
import {
  DEFAULT_EXHIBITION_SETTINGS,
  DEFAULT_MODEL_TIERS,
  ExhibitionSettings,
  KosenGameRecord,
  KosenSessionRecord,
  ModelTier,
  ModelTiersMap,
} from '../types';
import {
  checkServerApiKeyStatus,
  checkStaffPasskeySession,
  deleteKosenGame,
  deleteKosenSession,
  fetchExhibitionSettings,
  fetchModelTiers,
  getStaffEnrollmentSecretStatus,
  getSupabaseClient,
  listKosenSessions,
  listPublicKosenGames,
  registerStaffPasskey,
  saveStaffEnrollmentSecret,
  signInWithStaffPasskey,
  saveExhibitionSettings,
  saveModelTiers,
  saveServerApiKey,
  signOutStaff,
  toggleGamePublicVisibility,
} from '../supabase';
import { stopKosenGenerationJob } from '../kosen-runner';
import { requestServerGeneration } from '../server-provider';

const SERVER_KEY_PROVIDERS = ['gemini', 'openrouter', 'surplus'] as const;
type ServerKeyProvider = (typeof SERVER_KEY_PROVIDERS)[number];
const SERVER_KEY_LABELS: Record<ServerKeyProvider, string> = { gemini: 'Gemini', openrouter: 'OpenRouter', surplus: 'Surplus' };

type AdminTab = 'models' | 'sessions' | 'games' | 'keys';

const PROVIDERS: ProviderType[] = [
  'gemini',
  'openai',
  'anthropic',
  'openrouter',
  'orcarouter',
  'groq',
  'surplus',
];

export function AdminPanelPage() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(true);
  const [authError, setAuthError] = useState('');

  const [activeTab, setActiveTab] = useState<AdminTab>('models');
  const [modelTiers, setModelTiers] = useState<ModelTiersMap>(DEFAULT_MODEL_TIERS);
  const [settings, setSettings] = useState<ExhibitionSettings>(DEFAULT_EXHIBITION_SETTINGS);
  const [sessions, setSessions] = useState<KosenSessionRecord[]>([]);
  const [games, setGames] = useState<KosenGameRecord[]>([]);
  const [serverKeyStatus, setServerKeyStatus] = useState<Record<string, { configured: boolean; maskedKey: string | null; unavailable?: boolean }>>({});
  const [serverKeyInputs, setServerKeyInputs] = useState<Record<string, string>>({});
  const [isSavingServerKey, setIsSavingServerKey] = useState<string | null>(null);
  const [enrollmentSecretStatus, setEnrollmentSecretStatus] = useState<{
    configured: boolean;
    maskedSecret: string | null;
    secretLength: number;
  }>({ configured: false, maskedSecret: null, secretLength: 0 });
  const [newEnrollmentSecret, setNewEnrollmentSecret] = useState('');
  const [isSavingSecret, setIsSavingSecret] = useState(false);
  const [newPasskeyEmail, setNewPasskeyEmail] = useState('staff@kosen.local');
  const [isRegisteringPasskey, setIsRegisteringPasskey] = useState(false);
  const [apiKeys, setApiKeys] = useState<Record<string, string>>(() => getStoredApiKeys());
  const [catalog, setCatalog] = useState<Partial<Record<ProviderType, { status: string; models: DiscoveredModel[] }>>>({});
  const [refreshModels, setRefreshModels] = useState(0);
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [saveNotice, setSaveNotice] = useState('');
  const [qrModalSessionId, setQrModalSessionId] = useState<string | null>(null);

  const loadAllAdminData = async () => {
    const [t, s, sessList, gameList, keyStat, secStat] = await Promise.all([
      fetchModelTiers(),
      fetchExhibitionSettings(),
      listKosenSessions(50),
      listPublicKosenGames(true),
      Promise.all(SERVER_KEY_PROVIDERS.map(async (provider) => [provider, await checkServerApiKeyStatus(provider)] as const)).then(Object.fromEntries),
      getStaffEnrollmentSecretStatus(),
    ]);
    setModelTiers(t);
    setSettings(s);
    setSessions(sessList);
    setGames(gameList);
    setServerKeyStatus(keyStat);
    setEnrollmentSecretStatus(secStat);
  };

  useEffect(() => {
    checkStaffPasskeySession().then((info) => {
      if (info.isAuthenticated) {
        setIsAuthenticated(true);
      }
    });
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      loadAllAdminData();
    }
  }, [isAuthenticated]);

  useEffect(() => {
    let cancelled = false;
    const providers = [...new Set(Object.values(modelTiers).map(t => t.provider))];
    for (const provider of providers) {
      const usesServer = SERVER_KEY_PROVIDERS.includes(provider as ServerKeyProvider);
      const serverStatus = serverKeyStatus[provider];
      if (usesServer && !serverStatus) continue;
      const key = usesServer ? (serverStatus?.configured ? 'server' : '') : apiKeys[provider];
      if (!key) {
        setCatalog(prev => ({ ...prev, [provider]: { status: serverStatus?.unavailable ? 'サーバーのキー状態を取得できません' : 'APIキーが未設定です', models: [] } }));
        continue;
      }
      setCatalog(prev => ({ ...prev, [provider]: { status: '取得中…', models: [] } }));
      fetchDiscoveredModels({ [provider]: key }, { throwOnError: true, ...(usesServer ? { fetchImpl: (_url: RequestInfo | URL, init?: RequestInit) => requestServerGeneration(provider as ServerKeyProvider, null, init?.signal ?? undefined, 'list_provider_models') } : {}) }).then(models => {
        if (!cancelled) setCatalog(prev => ({ ...prev, [provider]: {
          status: models.length ? '' : '利用可能なモデルがありません。', models,
        } }));
      }).catch(() => {
        if (!cancelled) setCatalog(prev => ({ ...prev, [provider]: { status: 'モデルの取得に失敗しました', models: [] } }));
      });
    }
    return () => { cancelled = true; };
  }, [modelTiers.fast.provider, modelTiers.think.provider, modelTiers.ultra.provider, apiKeys, serverKeyStatus, refreshModels]);

  const handleLoginWithPasskey = async () => {
    setAuthError('');
    const res = await signInWithStaffPasskey();
    if (res.success) {
      setIsAuthenticated(true);
    } else {
      setAuthError(res.error || 'パスキー認証に失敗しました');
    }
  };

  const handleLogout = async () => {
    sessionStorage.removeItem('melonpan_kosen_admin_auth');
    await signOutStaff();
    setIsAuthenticated(false);
  };

  const handleSaveModelsAndSettings = async () => {
    const invalid = Object.values(modelTiers).some(tier => {
      const levels = catalog[tier.provider]?.models.find(m => m.id === tier.model)?.supportedEfforts;
      return levels !== undefined && !levels.includes(tier.thinkingEffort);
    });
    if (invalid) {
      setSaveNotice('対応する思考レベルを選択してください。');
      return;
    }
    await Promise.all([saveModelTiers(modelTiers), saveExhibitionSettings(settings)]);
    setSaveNotice('設定をSupabaseに保存しました！');
    setTimeout(() => setSaveNotice(''), 3000);
  };

  const handleSaveServerKey = async (e: React.FormEvent, provider: ServerKeyProvider) => {
    e.preventDefault();
    const key = serverKeyInputs[provider]?.trim();
    if (!key) return;
    setIsSavingServerKey(provider);
    try {
      const ok = await saveServerApiKey(key, provider);
      if (ok) {
        setSaveNotice(`${provider} の API キーをサーバーに保存しました。`);
        setServerKeyInputs(prev => ({ ...prev, [provider]: '' }));
        const status = await checkServerApiKeyStatus(provider);
        setServerKeyStatus(prev => ({ ...prev, [provider]: status }));
      } else {
        setSaveNotice('サーバーキーの保存に失敗しました。');
      }
    } finally {
      setIsSavingServerKey(null);
      setTimeout(() => setSaveNotice(''), 4000);
    }
  };

  const handleSaveEnrollmentSecret = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEnrollmentSecret.trim()) return;
    setIsSavingSecret(true);
    try {
      const ok = await saveStaffEnrollmentSecret(newEnrollmentSecret.trim());
      if (ok) {
        setSaveNotice('スタッフ登録シークレットキーを更新しました！');
        setNewEnrollmentSecret('');
        const stat = await getStaffEnrollmentSecretStatus();
        setEnrollmentSecretStatus(stat);
      } else {
        setSaveNotice('シークレットキーの保存に失敗しました。');
      }
    } finally {
      setIsSavingSecret(false);
      setTimeout(() => setSaveNotice(''), 4000);
    }
  };

  const handleRegisterNewPasskey = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsRegisteringPasskey(true);
    try {
      const res = await registerStaffPasskey(newPasskeyEmail.trim());
      if (res.success) {
        setSaveNotice('新しいスタッフパスキーを登録しました！');
      } else {
        setSaveNotice(`パスキー登録失敗: ${res.error}`);
      }
    } finally {
      setIsRegisteringPasskey(false);
      setTimeout(() => setSaveNotice(''), 4000);
    }
  };

  const handleSaveProviderKey = (provider: ProviderType) => {
    const val = keyInputs[provider];
    if (val !== undefined) {
      saveStoredApiKey(provider, val);
      setApiKeys(getStoredApiKeys());
      setSaveNotice(`${provider.toUpperCase()} のローカル設定を保存しました`);
      setTimeout(() => setSaveNotice(''), 3000);
    }
  };

  const handleStopSession = async (sessionId: string) => {
    stopKosenGenerationJob(sessionId);
    await loadAllAdminData();
  };

  const handleDeleteSessionRecord = async (sessionId: string) => {
    await deleteKosenSession(sessionId);
    await loadAllAdminData();
  };

  const handleToggleGamePublic = async (game: KosenGameRecord) => {
    await toggleGamePublicVisibility(game.id, !game.is_public);
    await loadAllAdminData();
  };

  const handleDeleteGameRecord = async (gameId: string) => {
    await deleteKosenGame(gameId);
    await loadAllAdminData();
  };

  // ─── LOGIN GATE ───
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)] flex flex-col items-center justify-center p-6 font-sans">
        <HandDrawnFilter />
        <WobblyCard className="max-w-md w-full p-8 space-y-6 text-center">
          <div className="inline-flex p-4 rounded-3xl bg-[var(--card)] border-2 border-[var(--stroke)] text-[var(--accent)] shadow-sm">
            <Shield size={36} />
          </div>
          <div>
            <h1 className="text-xl font-extrabold">管理者用パネル（保護中）</h1>
            <p className="text-xs opacity-70 mt-1">高専祭運営スタッフ専用 / パスキー生体認証</p>
          </div>

          <div className="space-y-3">
            <WobblyButton
              type="button"
              variant="primary"
              className="w-full justify-center py-3.5"
              onClick={handleLoginWithPasskey}
            >
              <Key size={18} />
              <span>パスキーでロック解除</span>
            </WobblyButton>
            <p className="text-[11px] opacity-70">
              Touch ID / Face ID / Windows Hello のみで認証します（パスワード不要）
            </p>
          </div>

          {authError && (
            <p className="text-xs text-[var(--warm-error)] font-bold">{authError}</p>
          )}

          <div className="pt-2 border-t border-[var(--stroke)]/20">
            <Link to="/kiosk" className="text-xs underline opacity-75">
              ← キオスク画面へ戻る
            </Link>
          </div>
        </WobblyCard>
      </div>
    );
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173';

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)] flex flex-col font-sans">
      <HandDrawnFilter />

      {/* Admin Top Header */}
      <header className="px-4 sm:px-8 py-4 bg-[var(--card)] border-b-2 border-[var(--stroke)] flex flex-wrap items-center justify-between gap-3 sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <Shield size={26} className="text-[var(--accent)]" />
          <div>
            <h1 className="text-lg font-extrabold">高専祭 管理者用パネル (Admin Console)</h1>
            <p className="text-xs opacity-70">
              モデル・プロバイダー管理 / セッション監視 / QR・公開作品モデレーション
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link to="/kiosk">
            <WobblyButton variant="secondary" size="sm">
              <ArrowLeft size={14} />
              体験画面
            </WobblyButton>
          </Link>
          <Link to="/gallery">
            <WobblyButton variant="secondary" size="sm">
              <Trophy size={14} />
              公開ギャラリー
            </WobblyButton>
          </Link>
          <Link to="/ide">
            <WobblyButton variant="secondary" size="sm">
              <Code2 size={14} />
              Web IDE
            </WobblyButton>
          </Link>
          <WobblyButton variant="outline" size="sm" onClick={loadAllAdminData}>
            <RefreshCw size={14} />
            再読込
          </WobblyButton>
          <WobblyButton variant="danger" size="sm" onClick={handleLogout}>
            <LogOut size={14} />
            ログアウト
          </WobblyButton>
        </div>
      </header>

      {/* Sub-navigation Tabs */}
      <div className="bg-[var(--card)]/60 border-b border-[var(--stroke)]/30 px-4 sm:px-8 py-2.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {[
            { id: 'models', label: 'モデル割り当て管理 (高速/思考/超思考)', icon: <Sliders size={15} /> },
            { id: 'keys', label: 'サーバーAPIキー & パスキー管理', icon: <Key size={15} /> },
            { id: 'sessions', label: `動作セッション & QR管理 (${sessions.length})`, icon: <Activity size={15} /> },
            { id: 'games', label: `成果物公開管理 (${games.length})`, icon: <Trophy size={15} /> },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as AdminTab)}
              className={[
                'px-3.5 py-2 rounded-2xl text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-all',
                activeTab === tab.id
                  ? 'bg-[var(--accent)] text-white shadow-sm'
                  : 'bg-[var(--background)] hover:bg-black/5',
              ].join(' ')}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {saveNotice && (
          <div className="flex items-center gap-1.5 text-xs font-bold text-[var(--warm-success)] bg-[var(--background)] px-3 py-1.5 rounded-full border border-[var(--warm-success)]">
            <CheckCircle2 size={14} />
            <span>{saveNotice}</span>
          </div>
        )}
      </div>

      {/* Main Content */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-4 sm:p-8 space-y-6">
        {/* ─── TAB 1: MODEL TIER CONFIGURATION ─── */}
        {activeTab === 'models' && (
          <div className="space-y-6">
            <WobblyCard className="p-6 space-y-6">
              <div className="flex items-center justify-between border-b border-[var(--stroke)]/20 pb-3">
                <div>
                  <h2 className="text-lg font-extrabold">
                    体験者用モデル選択肢（高速・思考・超思考）の詳細マッピング
                  </h2>
                  <p className="text-xs opacity-75">
                    体験者が選ぶ3つのボタンに対して、実際に使用するプロバイダー・モデル名・思考レベルを動的に変更できます。
                  </p>
                </div>
                <WobblyButton variant="primary" onClick={handleSaveModelsAndSettings}>
                  <Save size={16} />
                  設定を保存する
                </WobblyButton>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {(['fast', 'think', 'ultra'] as ModelTier[]).map((tierKey) => {
                  const tier = modelTiers[tierKey] || DEFAULT_MODEL_TIERS[tierKey];
                  const supported = catalog[tier.provider]?.models.find(m => m.id === tier.model)?.supportedEfforts;
                  const invalidEffort = supported !== undefined && !supported.includes(tier.thinkingEffort);
                  const levels = supported ?? ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
                  const updateTier = (patch: Partial<typeof tier>) => {
                    setModelTiers((prev) => ({
                      ...prev,
                      [tierKey]: { ...prev[tierKey], ...patch },
                    }));
                  };

                  return (
                    <div
                      key={tierKey}
                      className="p-5 rounded-2xl border-2 border-[var(--stroke)] bg-[var(--background)] space-y-4"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-extrabold text-base">{tier.label}</span>
                        <span className="px-2.5 py-0.5 rounded-full bg-[var(--warm-badge)] text-xs font-mono">
                          {tierKey.toUpperCase()}
                        </span>
                      </div>

                      <div className="space-y-1">
                        <label className="block text-xs font-bold">プロバイダー</label>
                        <select
                          value={tier.provider}
                          onChange={(e) =>
                            updateTier({ provider: e.target.value as ProviderType })
                          }
                          className="w-full px-3 py-2 rounded-xl border border-[var(--stroke)] bg-[var(--card)] text-xs font-bold"
                        >
                          {PROVIDERS.map((p) => (
                            <option key={p} value={p}>
                              {p}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-1">
                        <label className="block text-xs font-bold">詳細モデルID (直接入力または選択)</label>
                        <input
                          type="text"
                          list={`models-list-${tierKey}`}
                          value={tier.model}
                          onChange={(e) => updateTier({ model: e.target.value })}
                          className="w-full px-3 py-2 rounded-xl border border-[var(--stroke)] bg-[var(--card)] text-xs font-mono"
                        />
                        <datalist id={`models-list-${tierKey}`}>
                          {(catalog[tier.provider]?.models || []).map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name || m.id}
                            </option>
                          ))}
                        </datalist>
                        <p className="text-xs">{catalog[tier.provider]?.status}</p>
                        <button type="button" className="text-xs underline" onClick={() => setRefreshModels(n => n + 1)}>モデルを再取得</button>
                      </div>

                      <div className="space-y-1">
                        <label className="block text-xs font-bold">思考レベル (Thinking Effort)</label>
                        <select
                          value={invalidEffort ? '' : tier.thinkingEffort}
                          onChange={(e) =>
                            updateTier({
                              thinkingEffort: e.target.value as typeof tier.thinkingEffort,
                            })
                          }
                          className="w-full px-3 py-2 rounded-xl border border-[var(--stroke)] bg-[var(--card)] text-xs font-bold"
                        >
                          {invalidEffort && <option value="" disabled>対応するレベルを選択してください</option>}
                          {levels.map(level => <option key={level} value={level}>{level}</option>)}
                        </select>
                        <p className="text-xs">{supported === undefined ? 'モデルごとの対応状況は不明です。' : supported.length ? 'APIが返した対応レベルを表示しています。' : 'このモデルは effort を指定できません。'}</p>
                        {tier.provider === 'anthropic' && <p className="text-xs">現在の Anthropic 互換 API は effort を適用できません。</p>}
                      </div>

                      <div className="space-y-1">
                        <label className="block text-xs font-bold">体験者向け説明文</label>
                        <textarea
                          rows={3}
                          value={tier.description}
                          onChange={(e) => updateTier({ description: e.target.value })}
                          className="w-full px-3 py-2 rounded-xl border border-[var(--stroke)] bg-[var(--card)] text-xs resize-none"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Auxiliary AI Models (Helper, Toppings, Transcribe) */}
              <div className="pt-5 border-t border-[var(--stroke)]/20 space-y-4">
                <div>
                  <h3 className="text-base font-extrabold flex items-center gap-2">
                    <span>✨</span>
                    <span>AI機能別モデル設定（お手伝い・トッピング・音声文字起こし）</span>
                  </h3>
                  <p className="text-xs opacity-75">
                    プロンプト入力補助、トッピング10選提案、マイク音声認識に使用するLLMモデルを個別に変更できます。
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                  {/* 1. AI Helper Model */}
                  <div className="p-4 rounded-2xl border-2 border-[var(--stroke)]/60 bg-[var(--background)] space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-sm">💡 AIお手伝いモデル</span>
                      <span className="px-2 py-0.5 rounded-full bg-[var(--warm-badge)] text-[10px] font-bold">
                        アイデア拡張
                      </span>
                    </div>

                    <div className="space-y-1">
                      <label className="block text-[11px] font-bold">プロバイダー</label>
                      <select
                        value={settings.helperProvider || 'gemini'}
                        onChange={(e) =>
                          setSettings((prev) => ({
                            ...prev,
                            helperProvider: e.target.value as ProviderType,
                          }))
                        }
                        className="w-full px-2.5 py-1.5 rounded-xl border border-[var(--stroke)] bg-[var(--card)] text-xs font-bold"
                      >
                        {PROVIDERS.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="block text-[11px] font-bold">モデル名 / ID</label>
                      <input
                        type="text"
                        list="models-list-helper"
                        value={settings.helperModel || 'gemini-3.5-flash'}
                        onChange={(e) =>
                          setSettings((prev) => ({ ...prev, helperModel: e.target.value }))
                        }
                        className="w-full px-2.5 py-1.5 rounded-xl border border-[var(--stroke)] bg-[var(--card)] text-xs font-mono"
                        placeholder="gemini-3.5-flash"
                      />
                      <datalist id="models-list-helper">
                        {ALL_SUPPORTED_MODELS.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.label} ({m.provider})
                          </option>
                        ))}
                      </datalist>
                    </div>
                  </div>

                  {/* 2. Toppings Proposal Model */}
                  <div className="p-4 rounded-2xl border-2 border-[var(--stroke)]/60 bg-[var(--background)] space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-sm">🍕 トッピング提案モデル</span>
                      <span className="px-2 py-0.5 rounded-full bg-[var(--warm-badge)] text-[10px] font-bold">
                        10個のギミック提案
                      </span>
                    </div>

                    <div className="space-y-1">
                      <label className="block text-[11px] font-bold">プロバイダー</label>
                      <select
                        value={settings.toppingsProvider || 'gemini'}
                        onChange={(e) =>
                          setSettings((prev) => ({
                            ...prev,
                            toppingsProvider: e.target.value as ProviderType,
                          }))
                        }
                        className="w-full px-2.5 py-1.5 rounded-xl border border-[var(--stroke)] bg-[var(--card)] text-xs font-bold"
                      >
                        {PROVIDERS.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="block text-[11px] font-bold">モデル名 / ID</label>
                      <input
                        type="text"
                        list="models-list-toppings"
                        value={settings.toppingsModel || 'gemini-3.5-flash'}
                        onChange={(e) =>
                          setSettings((prev) => ({ ...prev, toppingsModel: e.target.value }))
                        }
                        className="w-full px-2.5 py-1.5 rounded-xl border border-[var(--stroke)] bg-[var(--card)] text-xs font-mono"
                        placeholder="gemini-3.5-flash"
                      />
                      <datalist id="models-list-toppings">
                        {ALL_SUPPORTED_MODELS.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.label} ({m.provider})
                          </option>
                        ))}
                      </datalist>
                    </div>
                  </div>

                  {/* 3. Audio Transcribe Model */}
                  <div className="p-4 rounded-2xl border-2 border-[var(--stroke)]/60 bg-[var(--background)] space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-sm">🎙️ 音声入力 (文字起こし) モデル</span>
                      <span className="px-2 py-0.5 rounded-full bg-[var(--accent)] text-white text-[10px] font-bold">
                        LLM音声認識
                      </span>
                    </div>

                    <div className="space-y-1">
                      <label className="block text-[11px] font-bold">プロバイダー</label>
                      <select
                        value={settings.transcribeProvider || 'gemini'}
                        onChange={(e) =>
                          setSettings((prev) => ({
                            ...prev,
                            transcribeProvider: e.target.value as ProviderType,
                          }))
                        }
                        className="w-full px-2.5 py-1.5 rounded-xl border border-[var(--stroke)] bg-[var(--card)] text-xs font-bold"
                      >
                        <option value="gemini">gemini</option>
                        <option value="openrouter">openrouter</option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="block text-[11px] font-bold">モデル名 (デフォルト: gemini-3.5-transcribe)</label>
                      <input
                        type="text"
                        value={settings.transcribeModel || 'gemini-3.5-transcribe'}
                        onChange={(e) =>
                          setSettings((prev) => ({ ...prev, transcribeModel: e.target.value }))
                        }
                        className="w-full px-2.5 py-1.5 rounded-xl border border-[var(--stroke)] bg-[var(--card)] text-xs font-mono"
                        placeholder="gemini-3.5-transcribe"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* General Exhibition Settings */}
              <div className="pt-4 border-t border-[var(--stroke)]/20 grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-1">
                  <label className="block text-xs font-bold">ブース表示タイトル</label>
                  <input
                    type="text"
                    value={settings.boothName}
                    onChange={(e) =>
                      setSettings((prev) => ({ ...prev, boothName: e.target.value }))
                    }
                    className="w-full px-3 py-2 rounded-xl border border-[var(--stroke)] bg-[var(--background)] text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-bold">
                    生成状況ページの消滅時間（完了後・分）
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={settings.statusExpireMinutes}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        statusExpireMinutes: Number(e.target.value) || 5,
                      }))
                    }
                    className="w-full px-3 py-2 rounded-xl border border-[var(--stroke)] bg-[var(--background)] text-xs font-mono"
                  />
                </div>
              </div>
            </WobblyCard>
          </div>
        )}

        {/* ─── TAB 2: SERVER API KEYS & PASSKEYS ─── */}
        {activeTab === 'keys' && (
          <div className="space-y-6">
            {/* 1. Supabase Server-Side API Key Management */}
            <WobblyCard className="p-6 space-y-4">
              <div className="border-b border-[var(--stroke)]/20 pb-3">
                <h2 className="text-lg font-extrabold flex items-center gap-2">
                  <Shield className="text-[var(--warm-success)]" size={20} />
                  サーバー側 API キー管理
                </h2>
                <p className="text-xs opacity-75 mt-1">
                  キーはサーバーに保存され、この画面には末尾のみ表示されます。Gemini・OpenRouter・Surplus のキーはゲーム生成で使用されます。環境変数のキーが設定されている場合はそちらが優先されます。キー管理には Supabase Auth のスタッフセッションが必要です。
                </p>
              </div>
              {SERVER_KEY_PROVIDERS.map((provider) => {
                const status = serverKeyStatus[provider];
                return (
                  <form key={provider} onSubmit={(e) => handleSaveServerKey(e, provider)} className="p-4 rounded-2xl border border-[var(--stroke)] bg-[var(--background)] space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-bold">{SERVER_KEY_LABELS[provider]}</span>
                      <span className="text-xs font-mono">{!status ? '確認中...' : status.unavailable ? '取得できません' : status.maskedKey || '未設定'}</span>
                    </div>
                    <label className="block text-xs font-bold" htmlFor={`server-key-${provider}`}>
                      {SERVER_KEY_LABELS[provider]} API キーを登録 / 更新
                    </label>
                    <div className="flex gap-2">
                      <input id={`server-key-${provider}`} type="password" autoComplete="off"
                        value={serverKeyInputs[provider] || ''}
                        onChange={(e) => setServerKeyInputs(prev => ({ ...prev, [provider]: e.target.value }))}
                        className="flex-1 min-w-0 px-3 py-2 rounded-xl border border-[var(--stroke)] bg-[var(--card)] text-xs font-mono" />
                      <WobblyButton type="submit" variant="primary" size="sm"
                        disabled={isSavingServerKey !== null || !serverKeyInputs[provider]?.trim()}>
                        <Save size={14} />{isSavingServerKey === provider ? '保存中...' : '保存'}
                      </WobblyButton>
                    </div>
                  </form>
                );
              })}
            </WobblyCard>

            {/* 2. Staff Passkeys (WebAuthn / FIDO2) & Enrollment Secret */}
            <WobblyCard className="p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-[var(--stroke)]/20 pb-3">
                <div>
                  <h2 className="text-lg font-extrabold flex items-center gap-2">
                    <Key className="text-[var(--accent)]" size={20} />
                    <span>スタッフ用 パスキー（WebAuthn / FIDO2）認証 & 登録保護</span>
                  </h2>
                  <p className="text-xs opacity-75">
                    パスワード漏洩リスクを排除し、Touch ID / Face ID / Windows Hello による生体認証のみで保護します。
                  </p>
                </div>
              </div>

              {/* 🔒 Enrollment Secret Guard Card */}
              <div className="p-4 rounded-2xl border-2 border-[var(--warm-badge)] bg-[var(--background)] space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="text-xs font-extrabold flex items-center gap-1.5 text-[var(--accent)]">
                      <Shield size={16} />
                      <span>部外者防止用 スタッフ登録シークレットキー</span>
                    </div>
                    <p className="text-xs opacity-75 leading-relaxed">
                      一般来場者が勝手にパスキーを作成してロック解除するのを防ぐマスターキーです。端末の初回登録時のみ入力が要求されます。サーバー環境変数で指定した値がある場合はそちらが優先されます。
                    </p>
                  </div>
                  <div className="px-2.5 py-1 rounded-full bg-[var(--card)] border border-[var(--stroke)] text-[10px] font-mono font-bold shrink-0">
                    現在のキー: {enrollmentSecretStatus.maskedSecret || '...ret (設定中)'}
                  </div>
                </div>

                <form onSubmit={handleSaveEnrollmentSecret} className="flex flex-col sm:flex-row gap-2 pt-1">
                  <input
                    type="password"
                    value={newEnrollmentSecret}
                    onChange={(e) => setNewEnrollmentSecret(e.target.value)}
                    placeholder="新しい登録用シークレットキーを入力"
                    className="flex-1 px-3 py-2 rounded-xl border border-[var(--stroke)] bg-[var(--card)] text-xs font-mono"
                  />
                  <WobblyButton
                    type="submit"
                    variant="primary"
                    size="sm"
                    disabled={isSavingSecret || !newEnrollmentSecret.trim()}
                  >
                    <Save size={14} />
                    {isSavingSecret ? '保存中...' : '登録キーを更新'}
                  </WobblyButton>
                </form>
              </div>

              <div className="p-4 rounded-2xl border border-[var(--stroke)] bg-[var(--background)] space-y-3">
                <div className="space-y-1">
                  <div className="text-xs font-bold">この管理端末のパスキー登録</div>
                  <p className="text-xs opacity-70">
                    現在開いているこの端末の Touch ID, Face ID, Windows Hello をスタッフ用パスキーとして登録します。
                  </p>
                </div>

                <form onSubmit={handleRegisterNewPasskey} className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="email"
                    value={newPasskeyEmail}
                    onChange={(e) => setNewPasskeyEmail(e.target.value)}
                    placeholder="スタッフメールアドレス (例: staff@kosen-festival.local)"
                    className="flex-1 px-3 py-2 rounded-xl border border-[var(--stroke)] bg-[var(--card)] text-xs font-mono"
                    required
                  />
                  <WobblyButton
                    type="submit"
                    variant="secondary"
                    size="sm"
                    disabled={isRegisteringPasskey || !newPasskeyEmail.trim()}
                  >
                    <Key size={14} />
                    {isRegisteringPasskey ? '端末認証中...' : 'この端末をパスキー登録'}
                  </WobblyButton>
                </form>
              </div>
            </WobblyCard>

            {/* 3. Client-Side Fallback Keys (Optional) */}
            <WobblyCard className="p-6 space-y-4 opacity-80">
              <h2 className="text-sm font-bold flex items-center gap-2">
                <span>⚠️</span>
                <span>オフライン / ローカル開発用クライアントキー（任意）</span>
              </h2>
              <p className="text-xs opacity-75">
                Supabase に接続できないオフライン環境やローカル専用テスト時にのみ使用されるブラウザ一時キーです。通常運用時は上のサーバーサイドキーが優先されます。
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {PROVIDERS.map((prov) => (
                  <div
                    key={prov}
                    className="p-3 rounded-xl border border-[var(--stroke)]/50 bg-[var(--background)] space-y-1.5"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold uppercase">{prov}</span>
                      <span className="font-mono opacity-60">
                        {maskApiKey(apiKeys[prov])}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="password"
                        value={keyInputs[prov] || ''}
                        onChange={(e) =>
                          setKeyInputs((prev) => ({ ...prev, [prov]: e.target.value }))
                        }
                        placeholder={`${prov} Key...`}
                        className="flex-1 px-2.5 py-1 rounded-lg border border-[var(--stroke)] bg-[var(--card)] text-xs font-mono"
                      />
                      <WobblyButton
                        variant="outline"
                        size="sm"
                        onClick={() => handleSaveProviderKey(prov)}
                      >
                        ローカル保存
                      </WobblyButton>
                    </div>
                  </div>
                ))}
              </div>
            </WobblyCard>
          </div>
        )}

        {/* ─── TAB 3: RUNNING SESSIONS & QR MANAGEMENT ─── */}
        {activeTab === 'sessions' && (
          <WobblyCard className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-extrabold">動作中のセッション・QRコード管理</h2>
                <p className="text-xs opacity-75">
                  進行中の生成タスクの監視、QRコードの再表示、緊急停止、削除を行えます。
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b-2 border-[var(--stroke)]">
                    <th className="py-2.5 px-3">状態</th>
                    <th className="py-2.5 px-3">年齢層</th>
                    <th className="py-2.5 px-3">プロンプト / 作品名</th>
                    <th className="py-2.5 px-3">モデル</th>
                    <th className="py-2.5 px-3">作成日時</th>
                    <th className="py-2.5 px-3 text-right">操作 / QR</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--stroke)]/20">
                  {sessions.map((s) => (
                    <tr key={s.id} className="hover:bg-black/5">
                      <td className="py-3 px-3">
                        <span
                          className={[
                            'px-2 py-0.5 rounded-full font-bold text-[10px]',
                            s.status === 'completed'
                              ? 'bg-[var(--warm-success)]/20 text-[var(--warm-success)]'
                              : s.status === 'running'
                              ? 'bg-[#fff3dc] text-[var(--accent)] animate-pulse'
                              : 'bg-[var(--warm-error)]/20 text-[var(--warm-error)]',
                          ].join(' ')}
                        >
                          {s.status.toUpperCase()}
                        </span>
                      </td>
                      <td className="py-3 px-3 font-mono">
                        {s.age_group === 'under12' ? '0〜12歳' : '13歳以上'}
                      </td>
                      <td className="py-3 px-3 max-w-xs">
                        <div className="font-bold truncate">
                          {s.game_title || '(名称未確定)'}
                        </div>
                        <div className="opacity-75 truncate">{s.prompt}</div>
                      </td>
                      <td className="py-3 px-3 font-mono">
                        {s.model_tier} ({s.model_name})
                      </td>
                      <td className="py-3 px-3 font-mono">
                        {new Date(s.created_at).toLocaleTimeString()}
                      </td>
                      <td className="py-3 px-3 text-right space-x-1.5">
                        <button
                          onClick={() => setQrModalSessionId(s.id)}
                          className="px-2.5 py-1 rounded-lg border border-[var(--stroke)] bg-[var(--background)] font-bold hover:bg-black/5 cursor-pointer"
                        >
                          QR表示
                        </button>
                        <Link
                          to={`/status/${s.id}`}
                          target="_blank"
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[var(--stroke)] bg-[var(--background)] font-bold"
                        >
                          実況 <ExternalLink size={11} />
                        </Link>
                        {s.status === 'running' && (
                          <button
                            onClick={() => handleStopSession(s.id)}
                            className="px-2.5 py-1 rounded-lg bg-[var(--warm-error)] text-white font-bold cursor-pointer inline-flex items-center gap-1"
                          >
                            <StopCircle size={12} /> 停止
                          </button>
                        )}
                        <button
                          onClick={() => handleDeleteSessionRecord(s.id)}
                          className="p-1.5 rounded-lg text-[var(--warm-error)] hover:bg-black/5 cursor-pointer"
                          title="削除"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </WobblyCard>
        )}

        {/* ─── TAB 4: PUBLIC GAMES MODERATION ─── */}
        {activeTab === 'games' && (
          <WobblyCard className="p-6 space-y-4">
            <h2 className="text-lg font-extrabold">成果物（みんなのゲーム公開ページ）公開状況管理</h2>
            <p className="text-xs opacity-75">
              公開されているゲームの公開/非公開の切り替えや、不適切な作品の削除を行えます。
            </p>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b-2 border-[var(--stroke)]">
                    <th className="py-2.5 px-3">公開状態</th>
                    <th className="py-2.5 px-3">作品名</th>
                    <th className="py-2.5 px-3">作品概要 (AI生成)</th>
                    <th className="py-2.5 px-3">プレイ数</th>
                    <th className="py-2.5 px-3">公開日時</th>
                    <th className="py-2.5 px-3 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--stroke)]/20">
                  {games.map((g) => (
                    <tr key={g.id} className="hover:bg-black/5">
                      <td className="py-3 px-3">
                        <span
                          className={[
                            'px-2.5 py-0.5 rounded-full font-bold text-[10px]',
                            g.is_public
                              ? 'bg-[var(--warm-success)]/20 text-[var(--warm-success)]'
                              : 'bg-black/10 opacity-60',
                          ].join(' ')}
                        >
                          {g.is_public ? '公開中' : '非公開'}
                        </span>
                      </td>
                      <td className="py-3 px-3 font-bold">{g.title}</td>
                      <td className="py-3 px-3 max-w-md truncate opacity-80">
                        {g.description}
                      </td>
                      <td className="py-3 px-3 font-mono">{g.play_count}</td>
                      <td className="py-3 px-3 font-mono">
                        {new Date(g.created_at).toLocaleString()}
                      </td>
                      <td className="py-3 px-3 text-right space-x-2">
                        <button
                          onClick={() => handleToggleGamePublic(g)}
                          className="px-2.5 py-1 rounded-lg border border-[var(--stroke)] bg-[var(--background)] font-bold inline-flex items-center gap-1 cursor-pointer"
                        >
                          {g.is_public ? (
                            <>
                              <EyeOff size={12} /> 非公開にする
                            </>
                          ) : (
                            <>
                              <Eye size={12} /> 公開する
                            </>
                          )}
                        </button>
                        <button
                          onClick={() => handleDeleteGameRecord(g.id)}
                          className="px-2.5 py-1 rounded-lg bg-[var(--warm-error)] text-white font-bold inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Trash2 size={12} /> 削除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </WobblyCard>
        )}
      </main>

      {/* QR Code Re-display Modal for Admin */}
      {qrModalSessionId && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <WobblyCard className="max-w-sm w-full p-6 text-center space-y-4">
            <h3 className="font-extrabold text-base">セッション QRコード再表示</h3>
            <p className="text-xs font-mono opacity-75">ID: {qrModalSessionId}</p>
            <div className="p-4 bg-white rounded-2xl border-2 border-[var(--stroke)] inline-block">
              <QRCodeSVG value={`${origin}/status/${qrModalSessionId}`} size={180} />
            </div>
            <div>
              <WobblyButton
                variant="secondary"
                size="sm"
                onClick={() => setQrModalSessionId(null)}
              >
                閉じる
              </WobblyButton>
            </div>
          </WobblyCard>
        </div>
      )}
    </div>
  );
}
