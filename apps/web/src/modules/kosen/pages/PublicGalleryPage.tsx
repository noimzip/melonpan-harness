import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Trophy,
  Play,
  Calendar,
  Sparkles,
  X,
  RefreshCw,
  ArrowLeft,
  Gamepad2,
} from 'lucide-react';
import { HandDrawnFilter } from '../../../components/HandDrawnFilter';
import { WobblyCard } from '../../../components/WobblyCard';
import { WobblyButton } from '../../../components/WobblyButton';
import { RubyText, useAgeContext } from '../age-context';
import { KosenGameRecord } from '../types';
import {
  getSupabaseClient,
  incrementGamePlayCount,
  listPublicKosenGames,
} from '../supabase';

export function PublicGalleryPage() {
  const { isRubyMode, setIsRubyMode } = useAgeContext();
  const [games, setGames] = useState<KosenGameRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeGame, setActiveGame] = useState<KosenGameRecord | null>(null);

  const loadGames = async () => {
    setLoading(true);
    try {
      const list = await listPublicKosenGames(false);
      setGames(list);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadGames();

    // Realtime subscription for newly published games
    const supabase = getSupabaseClient();
    const channel = supabase
      .channel('kosen-public-gallery')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'kosen_games',
        },
        () => {
          listPublicKosenGames(false).then(setGames).catch(() => {});
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const handlePlayGame = (game: KosenGameRecord) => {
    setActiveGame(game);
    incrementGamePlayCount(game.id, game.play_count).catch(() => {});
    setGames((prev) =>
      prev.map((g) => (g.id === game.id ? { ...g, play_count: (g.play_count || 0) + 1 } : g))
    );
  };

  const formatPublishedDate = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleString('ja-JP', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)] flex flex-col font-sans">
      <HandDrawnFilter />

      {/* Top Header */}
      <header className="px-4 sm:px-8 py-4 bg-[var(--card)] border-b-2 border-[var(--stroke)] flex flex-wrap items-center justify-between gap-3 sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <Trophy size={28} className="text-[var(--accent)]" />
          <div>
            <h1 className="text-lg sm:text-xl font-extrabold">
              <RubyText text="みんなのゲーム公開ページ" />
            </h1>
            <p className="text-xs opacity-75">
              <RubyText text="高専祭でみんながAIと一緒に作ったオリジナルゲーム！スマホやPCで今すぐ遊べます" />
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsRubyMode(!isRubyMode)}
            className={[
              'px-3 py-1.5 rounded-full text-xs font-bold border-2 border-[var(--stroke)] cursor-pointer',
              isRubyMode ? 'bg-[var(--accent)] text-white' : 'bg-[var(--background)]',
            ].join(' ')}
          >
            {isRubyMode ? '🟢 ふりがな ON' : '⚪ ふりがな OFF'}
          </button>

          <WobblyButton variant="secondary" size="sm" onClick={loadGames}>
            <RefreshCw size={14} />
            <RubyText text="更新" />
          </WobblyButton>

          <Link to="/kiosk">
            <WobblyButton variant="outline" size="sm">
              <ArrowLeft size={14} />
              <RubyText text="ゲームを作る" />
            </WobblyButton>
          </Link>
        </div>
      </header>

      {/* Main Gallery Grid */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-4 sm:p-8">
        {loading ? (
          <div className="py-20 text-center space-y-3">
            <div className="inline-block w-12 h-12 border-4 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
            <p className="font-bold">
              <RubyText text="公開されているゲームを読み込んでいます..." />
            </p>
          </div>
        ) : games.length === 0 ? (
          <WobblyCard className="p-12 text-center space-y-4 max-w-lg mx-auto my-8">
            <div className="text-5xl">🎮</div>
            <h2 className="text-xl font-bold">
              <RubyText text="まだ公開されたゲームがありません" />
            </h2>
            <p className="text-sm opacity-75">
              <RubyText text="体験ブースで「みんなとゲームを共有する」をONにして最初のゲームを作ってみよう！" />
            </p>
          </WobblyCard>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {games.map((game) => (
              <WobblyCard
                key={game.id}
                className="p-6 flex flex-col justify-between space-y-4 hover:scale-[1.01] transition-transform"
              >
                <div className="space-y-3">
                  {/* Published Date & Tier Badge */}
                  <div className="flex items-center justify-between text-xs opacity-75">
                    <span className="flex items-center gap-1 font-mono">
                      <Calendar size={13} className="text-[var(--accent)]" />
                      <RubyText text={`公開日時: ${formatPublishedDate(game.created_at)}`} />
                    </span>
                    <span className="px-2.5 py-0.5 rounded-full bg-[var(--warm-badge)] font-bold">
                      {game.model_tier === 'fast'
                        ? '⚡ 高速'
                        : game.model_tier === 'ultra'
                        ? '🚀 超思考'
                        : '🧠 思考'}
                    </span>
                  </div>

                  {/* Game Title (作品名) */}
                  <h2 className="text-xl font-extrabold leading-snug">
                    <RubyText text={game.title} />
                  </h2>

                  {/* AI-Generated Summary (作品概要) */}
                  <div className="p-3.5 rounded-2xl bg-[var(--background)] border border-[var(--stroke)]/30 space-y-1">
                    <div className="text-[11px] font-bold text-[var(--accent)] flex items-center gap-1">
                      <Sparkles size={12} />
                      <RubyText text="作品概要 (AI生成)" />
                    </div>
                    <p className="text-xs leading-relaxed opacity-90">
                      <RubyText text={game.description} />
                    </p>
                  </div>

                  {/* Toppings Tags */}
                  {Array.isArray(game.toppings) && game.toppings.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {game.toppings.slice(0, 3).map((top, idx) => (
                        <span
                          key={idx}
                          className="px-2 py-0.5 rounded-full bg-[#fff3dc] border border-[var(--accent)]/40 text-[10px] font-bold"
                        >
                          <RubyText text={top} />
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Play Button */}
                <div className="pt-3 border-t border-[var(--stroke)]/20 flex items-center justify-between">
                  <span className="text-xs font-bold opacity-70">
                    🎮 <RubyText text={`${game.play_count || 0} 回プレイ`} />
                  </span>
                  <WobblyButton
                    variant="primary"
                    size="md"
                    onClick={() => handlePlayGame(game)}
                  >
                    <Play size={16} fill="currentColor" />
                    <RubyText text="このゲームで遊ぶ！" />
                  </WobblyButton>
                </div>
              </WobblyCard>
            ))}
          </div>
        )}
      </main>

      {/* ─── PLAYABLE SANDBOX MODAL FOR MOBILE & PC ─── */}
      {activeGame && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex flex-col p-2 sm:p-6">
          <div className="max-w-4xl w-full mx-auto flex-1 flex flex-col bg-[var(--card)] rounded-3xl border-3 border-[var(--stroke)] overflow-hidden shadow-2xl">
            {/* Modal Header */}
            <div className="px-4 py-3 bg-[var(--card)] border-b-2 border-[var(--stroke)] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Gamepad2 className="text-[var(--accent)]" size={20} />
                <span className="font-extrabold text-base">
                  <RubyText text={activeGame.title} />
                </span>
              </div>
              <WobblyButton
                variant="danger"
                size="sm"
                onClick={() => setActiveGame(null)}
              >
                <X size={16} />
                <RubyText text="ゲームを閉じる" />
              </WobblyButton>
            </div>

            {/* Sandboxed Iframe Game Player */}
            <div className="flex-1 bg-black relative">
              <iframe
                title={activeGame.title}
                srcDoc={activeGame.html_content}
                sandbox="allow-scripts allow-same-origin"
                className="w-full h-full border-0"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
