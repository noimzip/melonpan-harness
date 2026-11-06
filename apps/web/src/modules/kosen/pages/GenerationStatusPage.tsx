import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Brain,
  Code2,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Trophy,
  Sparkles,
  Terminal,
  ArrowLeft,
  Copy,
  Check,
  Play,
  Gamepad2,
  Maximize2,
  Minimize2,
  X,
} from 'lucide-react';
import { HandDrawnFilter } from '../../../components/HandDrawnFilter';
import { WobblyCard } from '../../../components/WobblyCard';
import { WobblyButton } from '../../../components/WobblyButton';
import { RubyText, useAgeContext } from '../age-context';
import { KosenEventRecord, KosenSessionRecord } from '../types';
import {
  fetchExhibitionSettings,
  getKosenSession,
  getSupabaseClient,
  isSessionStatusExpired,
  listKosenEvents,
} from '../supabase';

export function GenerationStatusPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { isRubyMode, setIsRubyMode } = useAgeContext();

  const [session, setSession] = useState<KosenSessionRecord | null>(null);
  const [events, setEvents] = useState<KosenEventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [expireMinutes, setExpireMinutes] = useState<number>(5);
  const [expired, setExpired] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState<number>(300);

  // Mobile tab state: 'thought' | 'code' | 'preview'
  const [mobileTab, setMobileTab] = useState<'thought' | 'code' | 'preview'>('thought');
  const [copied, setCopied] = useState(false);
  const [isPlayingModalOpen, setIsPlayingModalOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Initial load + polling + Supabase Realtime subscription
  useEffect(() => {
    if (!sessionId) return;

    let mounted = true;

    const loadInitial = async () => {
      const [s, evs, cfg] = await Promise.all([
        getKosenSession(sessionId),
        listKosenEvents(sessionId),
        fetchExhibitionSettings(),
      ]);
      if (!mounted) return;
      const expMins = cfg.statusExpireMinutes || 5;
      setExpireMinutes(expMins);
      if (s) {
        setSession(s);
        if (s.age_group === 'under12') {
          setIsRubyMode(true);
        }
        const check = isSessionStatusExpired(s, Date.now(), expMins);
        setExpired(check.expired);
        setRemainingSeconds(check.remainingSeconds);
      }
      setEvents(evs);
      setLoading(false);
    };

    loadInitial();

    // Realtime subscription for kosen_sessions & kosen_events
    const supabase = getSupabaseClient();
    const channel = supabase
      .channel(`kosen-status-${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'kosen_sessions',
          filter: `id=eq.${sessionId}`,
        },
        (payload) => {
          if (payload.new && mounted) {
            setSession(payload.new as KosenSessionRecord);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'kosen_events',
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          if (payload.new && mounted) {
            setEvents((prev) => [...prev, payload.new as KosenEventRecord]);
          }
        }
      )
      .subscribe();

    // Periodic fallback poll every 2.5s (handles local fallback or mobile network hiccups)
    const pollTimer = setInterval(async () => {
      const s = await getKosenSession(sessionId);
      const evs = await listKosenEvents(sessionId);
      if (!mounted) return;
      if (s) setSession(s);
      if (evs.length > 0) setEvents(evs);
    }, 2500);

    return () => {
      mounted = false;
      clearInterval(pollTimer);
      supabase.removeChannel(channel);
    };
  }, [sessionId]);

  // 1-second countdown timer for post-completion auto-disappearance
  useEffect(() => {
    if (!session) return;
    const timer = setInterval(() => {
      const check = isSessionStatusExpired(session, Date.now(), expireMinutes);
      setExpired(check.expired);
      setRemainingSeconds(check.remainingSeconds);
    }, 1000);
    return () => clearInterval(timer);
  }, [session, expireMinutes]);

  const formatCountdown = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const handleCopyCode = async () => {
    if (!session?.current_code) return;
    try {
      await navigator.clipboard.writeText(session.current_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  if (loading) {
    return (
      <div className="min-h-dvh bg-[var(--background)] text-[var(--foreground)] flex flex-col items-center justify-center p-4 sm:p-6">
        <HandDrawnFilter />
        <div className="w-10 h-10 border-4 border-[var(--accent)] border-t-transparent rounded-full animate-spin mb-3" />
        <p className="font-bold text-sm">
          <RubyText text="生成状況データを読み込んでいます..." />
        </p>
      </div>
    );
  }

  // Expired state (5 minutes after task completion) -> Page disappears
  if (expired || !session) {
    return (
      <div className="min-h-dvh bg-[var(--background)] text-[var(--foreground)] flex flex-col items-center justify-center p-4 sm:p-6 text-center">
        <HandDrawnFilter />
        <WobblyCard className="max-w-lg w-full p-6 sm:p-8 space-y-5">
          <div className="text-4xl sm:text-5xl">⏳</div>
          <h1 className="text-xl sm:text-2xl font-extrabold leading-snug">
            <RubyText
              text={
                expired
                  ? 'タスク完了から5分が経過したため、この生成状況ページは消去されました'
                  : '指定された生成セッションが見つかりません'
              }
            />
          </h1>
          <p className="text-xs sm:text-sm opacity-80 leading-relaxed">
            <RubyText text="完成したゲームは「みんなのゲーム公開ギャラリー」からいつでも遊ぶことができます！" />
          </p>
          <div className="flex flex-col sm:flex-row gap-2.5 justify-center pt-2">
            <Link to="/gallery" className="touch-manipulation">
              <WobblyButton variant="primary" size="md" className="w-full">
                <Trophy size={16} />
                <RubyText text="みんなのギャラリーへ移動" />
              </WobblyButton>
            </Link>
            <Link to="/kiosk" className="touch-manipulation">
              <WobblyButton variant="secondary" size="md" className="w-full">
                <ArrowLeft size={16} />
                <RubyText text="体験トップへ" />
              </WobblyButton>
            </Link>
          </div>
        </WobblyCard>
      </div>
    );
  }

  const codeLineCount = session.current_code ? session.current_code.split('\n').length : 0;
  const isCompleted = session.status === 'completed';

  return (
    <div className="min-h-dvh bg-[var(--background)] text-[var(--foreground)] flex flex-col font-sans">
      <HandDrawnFilter />

      {/* Header - Mobile responsive */}
      <header className="px-3 sm:px-6 py-3 bg-[var(--card)] border-b-2 border-[var(--stroke)] sticky top-0 z-20 shadow-sm backdrop-blur-md bg-opacity-95">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="text-xl sm:text-2xl shrink-0">📡</span>
            <div className="min-w-0 flex-1">
              <h1 className="text-sm sm:text-base font-extrabold truncate leading-tight">
                <RubyText text="AIリアルタイム生成状況" />
              </h1>
              <div className="text-[10px] sm:text-[11px] opacity-75 flex items-center gap-1.5 flex-wrap">
                <span>
                  ID: <span className="font-mono">{session.id.slice(0, 8)}</span>
                </span>
                <span>•</span>
                <span className="font-mono truncate max-w-[140px] sm:max-w-none">{session.model_name}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between sm:justify-end gap-1.5 sm:gap-2 flex-wrap">
            <button
              onClick={() => setIsRubyMode(!isRubyMode)}
              className={[
                'px-2.5 py-1 rounded-full text-xs font-bold border-2 border-[var(--stroke)] cursor-pointer touch-manipulation transition-colors',
                isRubyMode ? 'bg-[var(--accent)] text-white' : 'bg-[var(--background)]',
              ].join(' ')}
              aria-label="ふりがな切り替え"
            >
              {isRubyMode ? '🟢 ふりがな' : '⚪ ふりがな'}
            </button>

            {isCompleted && (
              <div className="px-2.5 py-1 rounded-full bg-[#fff3dc] border-2 border-[var(--accent)] text-xs font-extrabold flex items-center gap-1 text-[var(--accent)] whitespace-nowrap">
                <Clock size={13} />
                <RubyText text={`消去まで ${formatCountdown(remainingSeconds)}`} />
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto p-3 sm:p-5 md:p-6 space-y-4 sm:space-y-6">
        {/* Status Banner */}
        <WobblyCard className="p-4 sm:p-5 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start sm:items-center gap-2 min-w-0">
              {isCompleted ? (
                <CheckCircle2 className="text-[var(--warm-success)] shrink-0 mt-0.5 sm:mt-0" size={24} />
              ) : session.status === 'failed' || session.status === 'cancelled' ? (
                <AlertTriangle className="text-[var(--warm-error)] shrink-0 mt-0.5 sm:mt-0" size={24} />
              ) : (
                <Sparkles className="text-[var(--accent)] animate-spin shrink-0 mt-0.5 sm:mt-0" size={24} />
              )}
              <h2 className="text-base sm:text-lg font-extrabold leading-snug break-words">
                <RubyText
                  text={
                    isCompleted
                      ? `🎉 完成！「${session.game_title || 'オリジナルゲーム'}」`
                      : session.status === 'failed'
                      ? '❌ エラーが発生しました'
                      : '⚡ AIがゲームを制作中です...'
                  }
                />
              </h2>
            </div>

            <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
              {isCompleted && session.current_code && (
                <WobblyButton
                  variant="primary"
                  size="sm"
                  className="flex-1 sm:flex-initial touch-manipulation min-h-[36px]"
                  onClick={() => setIsPlayingModalOpen(true)}
                >
                  <Play size={14} fill="currentColor" />
                  <RubyText text="今すぐ遊ぶ！" />
                </WobblyButton>
              )}
              <Link to="/gallery" className="flex-1 sm:flex-initial touch-manipulation">
                <WobblyButton variant="outline" size="sm" className="w-full min-h-[36px]">
                  <Trophy size={14} />
                  <RubyText text="ギャラリーへ" />
                </WobblyButton>
              </Link>
            </div>
          </div>

          <div className="text-xs opacity-85 bg-[var(--background)] p-2.5 sm:p-3 rounded-xl border border-[var(--stroke)]/30 break-words">
            <span className="font-bold text-[var(--accent)]">
              <RubyText text="プロンプト: " />
            </span>
            {session.prompt}
          </div>

          {isCompleted && (
            <p className="text-[11px] sm:text-xs text-[var(--accent)] font-bold">
              <RubyText text="※この生成状況ページは完了の5分後に自動消去されます。完成したゲームは公開ギャラリーからいつでも遊べます！" />
            </p>
          )}
        </WobblyCard>

        {/* Mobile Tab Switcher (Visible on screens < lg) */}
        <div className="flex lg:hidden rounded-2xl bg-[var(--card)] p-1 border-2 border-[var(--stroke)] shadow-sm">
          <button
            type="button"
            onClick={() => setMobileTab('thought')}
            className={[
              'flex-1 py-2 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition-all touch-manipulation',
              mobileTab === 'thought'
                ? 'bg-[var(--accent)] text-white shadow-sm'
                : 'text-[var(--foreground)] opacity-75 hover:opacity-100',
            ].join(' ')}
          >
            <Brain size={14} />
            <RubyText text="思考・ログ" />
          </button>
          <button
            type="button"
            onClick={() => setMobileTab('code')}
            className={[
              'flex-1 py-2 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition-all touch-manipulation',
              mobileTab === 'code'
                ? 'bg-[var(--accent)] text-white shadow-sm'
                : 'text-[var(--foreground)] opacity-75 hover:opacity-100',
            ].join(' ')}
          >
            <Code2 size={14} />
            <RubyText text={`コード (${codeLineCount}行)`} />
          </button>
          {session.current_code && (
            <button
              type="button"
              onClick={() => setMobileTab('preview')}
              className={[
                'flex-1 py-2 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 transition-all touch-manipulation',
                mobileTab === 'preview'
                  ? 'bg-[var(--accent)] text-white shadow-sm'
                  : 'text-[var(--foreground)] opacity-75 hover:opacity-100',
              ].join(' ')}
            >
              <Play size={14} />
              <RubyText text="プレビュー" />
            </button>
          )}
        </div>

        {/* Responsive Grid: Desktop side-by-side (lg:grid), Mobile tab-controlled display */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
          {/* 1. AI Thought & Log Status */}
          <div className={['space-y-4', mobileTab !== 'thought' ? 'hidden lg:block' : 'block'].join(' ')}>
            <WobblyCard className="p-4 sm:p-5 flex flex-col space-y-3.5">
              <div className="flex items-center justify-between border-b border-[var(--stroke)]/20 pb-2">
                <h3 className="font-extrabold text-sm sm:text-base flex items-center gap-2">
                  <Brain size={18} className="text-[var(--accent)]" />
                  <RubyText text="現在のAIの思考状況" />
                </h3>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-[var(--background)] border border-[var(--stroke)]/30">
                  Turn #{session.turn_count || 1}
                </span>
              </div>

              {/* Thought Box */}
              <div className="p-3 sm:p-4 rounded-xl bg-[var(--background)] border-2 border-[var(--stroke)]/40 min-h-[120px] max-h-[220px] overflow-y-auto text-xs sm:text-sm leading-relaxed whitespace-pre-wrap break-words">
                <RubyText
                  text={
                    session.current_thought ||
                    'AIがゲームの設計とプログラム構造を考えています...'
                  }
                />
              </div>

              {/* Event Stream Log */}
              <div className="space-y-2 pt-1">
                <div className="text-xs font-bold opacity-75 flex items-center gap-1.5">
                  <Terminal size={13} />
                  <RubyText text="リアルタイム進行ログ" />
                </div>
                <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1 scrollbar-thin">
                  {events.length === 0 ? (
                    <div className="text-xs opacity-60 py-2">
                      <RubyText text="イベント待機中..." />
                    </div>
                  ) : (
                    events.map((ev) => (
                      <div
                        key={ev.id}
                        className="text-xs p-2 rounded-xl bg-[var(--background)] border border-[var(--stroke)]/25 flex items-start gap-2"
                      >
                        <span className="font-mono text-[10px] opacity-60 shrink-0 pt-0.5">
                          {new Date(ev.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </span>
                        <span className="flex-1 min-w-0 break-words leading-tight text-[11px] sm:text-xs">
                          {ev.payload.message ||
                            ev.payload.summary ||
                            ev.payload.thought ||
                            ev.event_type}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </WobblyCard>
          </div>

          {/* 2. Code Generation Status */}
          <div className={['space-y-4', mobileTab !== 'code' ? 'hidden lg:block' : 'block'].join(' ')}>
            <WobblyCard className="p-4 sm:p-5 flex flex-col space-y-3.5">
              <div className="flex items-center justify-between border-b border-[var(--stroke)]/20 pb-2">
                <h3 className="font-extrabold text-sm sm:text-base flex items-center gap-2 min-w-0">
                  <Code2 size={18} className="text-[var(--warm-success)] shrink-0" />
                  <span className="truncate">
                    <RubyText text="生成コード (index.html)" />
                  </span>
                </h3>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={handleCopyCode}
                    disabled={!session.current_code}
                    className="p-1.5 rounded-lg border border-[var(--stroke)]/40 bg-[var(--background)] hover:bg-[var(--card)] active:scale-95 transition-transform text-xs flex items-center gap-1 disabled:opacity-40"
                    title="コードをクリップボードにコピー"
                    aria-label="コードをコピー"
                  >
                    {copied ? <Check size={12} className="text-green-600" /> : <Copy size={12} />}
                    <span className="text-[10px] font-bold hidden xs:inline">
                      {copied ? '完了' : 'コピー'}
                    </span>
                  </button>
                  <span className="px-2 py-0.5 rounded-full bg-[var(--warm-badge)] text-[10px] sm:text-xs font-mono font-bold">
                    {codeLineCount}行
                  </span>
                </div>
              </div>

              <div className="flex-1 rounded-xl bg-[#1e1916] text-[#f5ece0] p-3 sm:p-4 font-mono text-[11px] sm:text-xs overflow-auto min-h-[260px] max-h-[380px] lg:max-h-[460px] border-2 border-[var(--stroke)]">
                {session.current_code ? (
                  <pre className="whitespace-pre-wrap break-all leading-relaxed">{session.current_code}</pre>
                ) : (
                  <div className="h-full flex items-center justify-center opacity-60 font-sans text-center p-4">
                    <RubyText text="AIがHTML5 Canvasコードを生成するとここにリアルタイム表示されます..." />
                  </div>
                )}
              </div>
            </WobblyCard>
          </div>

          {/* 3. Mobile-only Inline Preview Tab */}
          {session.current_code && (
            <div className={['space-y-4 lg:hidden', mobileTab !== 'preview' ? 'hidden' : 'block'].join(' ')}>
              <WobblyCard className="p-4 flex flex-col space-y-3">
                <div className="flex items-center justify-between border-b border-[var(--stroke)]/20 pb-2">
                  <h3 className="font-extrabold text-sm flex items-center gap-2">
                    <Gamepad2 size={18} className="text-[var(--accent)]" />
                    <RubyText text="ゲームプレビュー" />
                  </h3>
                  <WobblyButton
                    variant="primary"
                    size="sm"
                    onClick={() => setIsPlayingModalOpen(true)}
                  >
                    <Maximize2 size={12} />
                    <RubyText text="大画面で遊ぶ" />
                  </WobblyButton>
                </div>

                <div className="w-full aspect-[4/3] rounded-xl overflow-hidden border-2 border-[var(--stroke)] bg-black relative">
                  <iframe
                    title="Live Preview"
                    srcDoc={session.current_code}
                    sandbox="allow-scripts allow-same-origin"
                    className="w-full h-full border-0 absolute inset-0"
                  />
                </div>
              </WobblyCard>
            </div>
          )}
        </div>
      </main>

      {/* ─── LIVE GAME TEST PLAY MODAL FOR MOBILE & PC ─── */}
      {isPlayingModalOpen && session.current_code && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex flex-col p-0 sm:p-4 md:p-6">
          <div
            className={[
              'w-full mx-auto flex-1 flex flex-col bg-[var(--card)] overflow-hidden shadow-2xl transition-all',
              isFullscreen
                ? 'fixed inset-0 rounded-none z-50 h-dvh'
                : 'max-w-4xl rounded-none sm:rounded-3xl border-0 sm:border-3 border-[var(--stroke)] h-dvh sm:h-[88vh]',
            ].join(' ')}
          >
            {/* Modal Header */}
            <div className="px-3 sm:px-4 py-2.5 bg-[var(--card)] border-b-2 border-[var(--stroke)] flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <Gamepad2 className="text-[var(--accent)] shrink-0" size={18} />
                <span className="font-extrabold text-sm sm:text-base truncate">
                  <RubyText text={session.game_title || '制作したゲーム'} />
                </span>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsFullscreen(!isFullscreen)}
                  className="p-2 rounded-lg hover:bg-black/5 active:bg-black/10 cursor-pointer touch-manipulation opacity-75 hover:opacity-100 transition-opacity"
                  title={isFullscreen ? '元に戻す' : '全画面表示'}
                  aria-label={isFullscreen ? '元に戻す' : '全画面表示'}
                >
                  {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                </button>

                <WobblyButton
                  variant="danger"
                  size="sm"
                  className="touch-manipulation min-h-[36px]"
                  onClick={() => {
                    setIsPlayingModalOpen(false);
                    setIsFullscreen(false);
                  }}
                >
                  <X size={15} />
                  <span className="hidden xs:inline">
                    <RubyText text="閉じる" />
                  </span>
                </WobblyButton>
              </div>
            </div>

            {/* Sandboxed Iframe Game Player */}
            <div className="flex-1 bg-black relative w-full h-full overflow-hidden touch-none">
              <iframe
                title={session.game_title || 'Game Player'}
                srcDoc={session.current_code}
                sandbox="allow-scripts allow-same-origin"
                className="w-full h-full border-0 absolute inset-0"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
