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

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)] flex flex-col items-center justify-center p-6">
        <HandDrawnFilter />
        <div className="w-12 h-12 border-4 border-[var(--accent)] border-t-transparent rounded-full animate-spin mb-4" />
        <p className="font-bold">
          <RubyText text="生成状況データを読み込んでいます..." />
        </p>
      </div>
    );
  }

  // Expired state (5 minutes after task completion) -> Page disappears
  if (expired || !session) {
    return (
      <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)] flex flex-col items-center justify-center p-6 text-center">
        <HandDrawnFilter />
        <WobblyCard className="max-w-lg w-full p-8 space-y-6">
          <div className="text-5xl">⏳</div>
          <h1 className="text-2xl font-extrabold">
            <RubyText
              text={
                expired
                  ? 'タスク完了から5分が経過したため、この生成状況ページは消去されました'
                  : '指定された生成セッションが見つかりません'
              }
            />
          </h1>
          <p className="text-sm opacity-80 leading-relaxed">
            <RubyText text="完成したゲームは「みんなのゲーム公開ページ」からいつでも遊ぶことができます！" />
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
            <Link to="/gallery">
              <WobblyButton variant="primary" size="lg" className="w-full">
                <Trophy size={18} />
                <RubyText text="みんなのゲーム公開ページへ移動" />
              </WobblyButton>
            </Link>
            <Link to="/kiosk">
              <WobblyButton variant="secondary" size="lg" className="w-full">
                <ArrowLeft size={18} />
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
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)] flex flex-col font-sans">
      <HandDrawnFilter />

      {/* Header */}
      <header className="px-4 sm:px-8 py-4 bg-[var(--card)] border-b-2 border-[var(--stroke)] flex flex-wrap items-center justify-between gap-3 sticky top-0 z-20">
        <div className="flex items-center gap-2.5">
          <span className="text-2xl">📡</span>
          <div>
            <h1 className="text-base sm:text-lg font-extrabold">
              <RubyText text="AIリアルタイム生成状況ページ" />
            </h1>
            <p className="text-[11px] opacity-75">
              ID: <span className="font-mono">{session.id.slice(0, 8)}</span> | モデル:{' '}
              <span className="font-mono">{session.model_name}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsRubyMode(!isRubyMode)}
            className="px-3 py-1 rounded-full text-xs font-bold border border-[var(--stroke)] bg-[var(--background)]"
          >
            {isRubyMode ? '🟢 ふりがな ON' : '⚪ ふりがな OFF'}
          </button>

          {isCompleted && (
            <div className="px-3 py-1 rounded-full bg-[#fff3dc] border-2 border-[var(--accent)] text-xs font-extrabold flex items-center gap-1.5 text-[var(--accent)]">
              <Clock size={14} />
              <RubyText text={`消去まで残り ${formatCountdown(remainingSeconds)}`} />
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto p-4 sm:p-6 space-y-6">
        {/* Status Banner */}
        <WobblyCard className="p-5 sm:p-6 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {isCompleted ? (
                <CheckCircle2 className="text-[var(--warm-success)]" size={26} />
              ) : session.status === 'failed' || session.status === 'cancelled' ? (
                <AlertTriangle className="text-[var(--warm-error)]" size={26} />
              ) : (
                <Sparkles className="text-[var(--accent)] animate-spin" size={26} />
              )}
              <h2 className="text-lg sm:text-xl font-extrabold">
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

            <Link to="/gallery">
              <WobblyButton variant="primary" size="sm">
                <Trophy size={14} />
                <RubyText text="みんなのゲーム公開ページを見る" />
              </WobblyButton>
            </Link>
          </div>

          <div className="text-xs opacity-80 bg-[var(--background)] p-3 rounded-xl border border-[var(--stroke)]/30">
            <span className="font-bold">
              <RubyText text="プロンプト: " />
            </span>
            {session.prompt}
          </div>

          {isCompleted && (
            <p className="text-xs text-[var(--accent)] font-bold">
              <RubyText text="※この生成状況ページはタスク完了の5分後に自動的に消えます。完成したゲームは「みんなのゲーム公開ページ」で遊べます！" />
            </p>
          )}
        </WobblyCard>

        {/* Two Columns: Current AI Thought Status + Current Code Status */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 1. AI Thought Status */}
          <WobblyCard className="p-5 flex flex-col space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--stroke)]/20 pb-2.5">
              <h3 className="font-extrabold text-base flex items-center gap-2">
                <Brain size={20} className="text-[var(--accent)]" />
                <RubyText text="現在のAIの思考の状況" />
              </h3>
              <span className="text-xs font-mono opacity-70">Turn #{session.turn_count || 1}</span>
            </div>

            <div className="p-4 rounded-2xl bg-[var(--background)] border-2 border-[var(--stroke)]/40 min-h-[140px] max-h-[260px] overflow-y-auto text-sm leading-relaxed whitespace-pre-wrap">
              <RubyText
                text={
                  session.current_thought ||
                  'AIがゲームの設計とプログラム構造を考えています...'
                }
              />
            </div>

            {/* Event Stream Log */}
            <div className="space-y-2 pt-2">
              <div className="text-xs font-bold opacity-75 flex items-center gap-1.5">
                <Terminal size={14} />
                <RubyText text="リアルタイム進行ログ" />
              </div>
              <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
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
                      <span className="font-mono text-[10px] opacity-60 shrink-0">
                        {new Date(ev.created_at).toLocaleTimeString()}
                      </span>
                      <span className="flex-1">
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

          {/* 2. Code Generation Status */}
          <WobblyCard className="p-5 flex flex-col space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--stroke)]/20 pb-2.5">
              <h3 className="font-extrabold text-base flex items-center gap-2">
                <Code2 size={20} className="text-[var(--warm-success)]" />
                <RubyText text="現在のコードの状況 (index.html)" />
              </h3>
              <span className="px-2.5 py-0.5 rounded-full bg-[var(--warm-badge)] text-xs font-mono font-bold">
                {codeLineCount} lines ({session.current_code?.length || 0} chars)
              </span>
            </div>

            <div className="flex-1 rounded-2xl bg-[#1e1916] text-[#f5ece0] p-4 font-mono text-xs overflow-auto min-h-[280px] max-h-[420px] border-2 border-[var(--stroke)]">
              {session.current_code ? (
                <pre className="whitespace-pre-wrap break-all">{session.current_code}</pre>
              ) : (
                <div className="h-full flex items-center justify-center opacity-60 font-sans">
                  <RubyText text="AIがHTML5 Canvasコードを生成するとここにリアルタイム表示されます..." />
                </div>
              )}
            </div>
          </WobblyCard>
        </div>
      </main>
    </div>
  );
}
