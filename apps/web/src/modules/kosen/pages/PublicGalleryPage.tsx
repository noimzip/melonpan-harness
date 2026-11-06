import React, { useState, useEffect, useMemo } from 'react';
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
  Search,
  Filter,
  Maximize2,
  Minimize2,
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
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTier, setSelectedTier] = useState<'all' | 'fast' | 'think' | 'ultra'>('all');
  const [isFullscreen, setIsFullscreen] = useState(false);

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
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  // Filtered games based on search and tier filter
  const filteredGames = useMemo(() => {
    return games.filter((game) => {
      if (selectedTier !== 'all' && game.model_tier !== selectedTier) {
        return false;
      }
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      const matchTitle = game.title?.toLowerCase().includes(q);
      const matchDesc = game.description?.toLowerCase().includes(q);
      const matchToppings = Array.isArray(game.toppings) && game.toppings.some((t) => t.toLowerCase().includes(q));
      return matchTitle || matchDesc || matchToppings;
    });
  }, [games, searchQuery, selectedTier]);

  return (
    <div className="min-h-dvh bg-[var(--background)] text-[var(--foreground)] flex flex-col font-sans">
      <HandDrawnFilter />

      {/* Top Header - Mobile friendly sticky navigation */}
      <header className="px-3 sm:px-6 py-3 bg-[var(--card)] border-b-2 border-[var(--stroke)] sticky top-0 z-20 shadow-sm backdrop-blur-md bg-opacity-95">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <Trophy size={26} className="text-[var(--accent)] shrink-0" />
            <div className="min-w-0 flex-1">
              <h1 className="text-base sm:text-xl font-extrabold truncate leading-tight">
                <RubyText text="みんなのゲーム公開ギャラリー" />
              </h1>
              <p className="text-[11px] sm:text-xs opacity-75 truncate">
                <RubyText text="高専祭でみんながAIと作ったオリジナルゲーム！スマホですぐ遊べます" />
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between sm:justify-end gap-1.5 sm:gap-2 flex-wrap">
            <button
              onClick={() => setIsRubyMode(!isRubyMode)}
              className={[
                'px-2.5 py-1.5 rounded-full text-xs font-bold border-2 border-[var(--stroke)] cursor-pointer touch-manipulation transition-colors shrink-0',
                isRubyMode ? 'bg-[var(--accent)] text-white' : 'bg-[var(--background)]',
              ].join(' ')}
              aria-label="ふりがな切り替え"
            >
              {isRubyMode ? '🟢 ふりがな' : '⚪ ふりがな'}
            </button>

            <WobblyButton
              variant="secondary"
              size="sm"
              onClick={loadGames}
              className="touch-manipulation"
              aria-label="更新"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
              <RubyText text="更新" />
            </WobblyButton>

            <Link to="/kiosk" className="touch-manipulation">
              <WobblyButton variant="primary" size="sm" className="whitespace-nowrap">
                <ArrowLeft size={13} />
                <RubyText text="ゲームを作る" />
              </WobblyButton>
            </Link>
          </div>
        </div>
      </header>

      {/* Search & Filter Toolbar - Mobile optimized */}
      <div className="bg-[var(--background)] border-b border-[var(--stroke)]/20 px-3 sm:px-6 py-2.5">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
          {/* Search Box */}
          <div className="relative flex-1 max-w-md">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 opacity-50 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="タイトルやキーワードで検索..."
              className="w-full pl-9 pr-3 py-1.5 text-xs sm:text-sm rounded-full bg-[var(--card)] border-2 border-[var(--stroke)] focus:outline-none focus:border-[var(--accent)] transition-colors placeholder:text-[var(--foreground)]/50"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 opacity-60 hover:opacity-100 text-xs p-1"
                aria-label="検索クリア"
              >
                ✕
              </button>
            )}
          </div>

          {/* Model Filter Pills & Count */}
          <div className="flex items-center justify-between sm:justify-end gap-1.5 overflow-x-auto pb-0.5 sm:pb-0 scrollbar-none">
            <span className="text-[11px] font-bold opacity-70 shrink-0 hidden sm:inline flex items-center gap-1">
              <Filter size={12} />
              <RubyText text="絞り込み:" />
            </span>

            <div className="flex items-center gap-1 shrink-0">
              {(
                [
                  { id: 'all', label: 'すべて' },
                  { id: 'fast', label: '⚡ 高速' },
                  { id: 'think', label: '🧠 思考' },
                  { id: 'ultra', label: '🚀 超思考' },
                ] as const
              ).map((tier) => (
                <button
                  key={tier.id}
                  onClick={() => setSelectedTier(tier.id)}
                  className={[
                    'px-2.5 py-1 rounded-full text-[11px] font-bold border transition-all cursor-pointer touch-manipulation',
                    selectedTier === tier.id
                      ? 'bg-[var(--accent)] text-white border-[var(--accent)] shadow-sm'
                      : 'bg-[var(--card)] border-[var(--stroke)]/50 opacity-80 hover:opacity-100',
                  ].join(' ')}
                >
                  <RubyText text={tier.label} />
                </button>
              ))}
            </div>

            <span className="text-[11px] font-bold opacity-60 ml-2 shrink-0">
              {filteredGames.length}件
            </span>
          </div>
        </div>
      </div>

      {/* Main Gallery Grid */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-3 sm:p-6 md:p-8">
        {loading ? (
          <div className="py-20 text-center space-y-3">
            <div className="inline-block w-10 h-10 border-4 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
            <p className="font-bold text-sm">
              <RubyText text="公開されているゲームを読み込んでいます..." />
            </p>
          </div>
        ) : filteredGames.length === 0 ? (
          <WobblyCard className="p-8 sm:p-12 text-center space-y-4 max-w-lg mx-auto my-8">
            <div className="text-4xl sm:text-5xl">🎮</div>
            <h2 className="text-lg sm:text-xl font-bold">
              <RubyText
                text={
                  searchQuery || selectedTier !== 'all'
                    ? '条件に一致するゲームが見つかりませんでした'
                    : 'まだ公開されたゲームがありません'
                }
              />
            </h2>
            <p className="text-xs sm:text-sm opacity-75">
              <RubyText
                text={
                  searchQuery || selectedTier !== 'all'
                    ? '検索ワードや絞り込み条件を変更してみてください。'
                    : '体験ブースで「みんなとゲームを共有する」をONにして最初のゲームを作ってみよう！'
                }
              />
            </p>
            {(searchQuery || selectedTier !== 'all') && (
              <WobblyButton
                variant="outline"
                size="sm"
                onClick={() => {
                  setSearchQuery('');
                  setSelectedTier('all');
                }}
              >
                <RubyText text="フィルターを解除" />
              </WobblyButton>
            )}
          </WobblyCard>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {filteredGames.map((game) => (
              <WobblyCard
                key={game.id}
                className="p-4 sm:p-5 flex flex-col justify-between space-y-3.5 hover:scale-[1.01] transition-transform"
              >
                <div className="space-y-2.5">
                  {/* Published Date & Tier Badge */}
                  <div className="flex items-center justify-between text-xs opacity-75">
                    <span className="flex items-center gap-1 font-mono text-[11px]">
                      <Calendar size={12} className="text-[var(--accent)]" />
                      <RubyText text={formatPublishedDate(game.created_at)} />
                    </span>
                    <span className="px-2 py-0.5 rounded-full bg-[var(--warm-badge)] font-bold text-[10px]">
                      {game.model_tier === 'fast'
                        ? '⚡ 高速'
                        : game.model_tier === 'ultra'
                        ? '🚀 超思考'
                        : '🧠 思考'}
                    </span>
                  </div>

                  {/* Game Title (作品名) */}
                  <h2 className="text-base sm:text-lg font-extrabold leading-snug line-clamp-2 break-words">
                    <RubyText text={game.title} />
                  </h2>

                  {/* AI-Generated Summary (作品概要) */}
                  <div className="p-3 rounded-xl bg-[var(--background)] border border-[var(--stroke)]/30 space-y-1">
                    <div className="text-[10px] font-bold text-[var(--accent)] flex items-center gap-1">
                      <Sparkles size={11} />
                      <RubyText text="作品概要" />
                    </div>
                    <p className="text-xs leading-relaxed opacity-90 line-clamp-3">
                      <RubyText text={game.description} />
                    </p>
                  </div>

                  {/* Toppings Tags */}
                  {Array.isArray(game.toppings) && game.toppings.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      {game.toppings.slice(0, 3).map((top, idx) => (
                        <span
                          key={idx}
                          className="px-2 py-0.5 rounded-full bg-[#fff3dc] border border-[var(--accent)]/40 text-[10px] font-bold truncate max-w-[120px]"
                        >
                          <RubyText text={top} />
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Play Button & Count */}
                <div className="pt-2.5 border-t border-[var(--stroke)]/20 flex items-center justify-between gap-2">
                  <span className="text-[11px] sm:text-xs font-bold opacity-70 whitespace-nowrap">
                    🎮 <RubyText text={`${game.play_count || 0} 回`} />
                  </span>
                  <WobblyButton
                    variant="primary"
                    size="sm"
                    className="flex-1 max-w-[180px] touch-manipulation min-h-[38px]"
                    onClick={() => handlePlayGame(game)}
                  >
                    <Play size={14} fill="currentColor" />
                    <RubyText text="今すぐ遊ぶ！" />
                  </WobblyButton>
                </div>
              </WobblyCard>
            ))}
          </div>
        )}
      </main>

      {/* ─── PLAYABLE SANDBOX MODAL FOR MOBILE & PC ─── */}
      {activeGame && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex flex-col p-0 sm:p-4 md:p-6">
          <div
            className={[
              'w-full mx-auto flex-1 flex flex-col bg-[var(--card)] overflow-hidden shadow-2xl transition-all',
              isFullscreen
                ? 'fixed inset-0 rounded-none z-50 h-dvh'
                : 'max-w-4xl rounded-none sm:rounded-3xl border-0 sm:border-3 border-[var(--stroke)] h-dvh sm:h-[88vh]',
            ].join(' ')}
          >
            {/* Modal Header - Touch friendly */}
            <div className="px-3 sm:px-4 py-2.5 bg-[var(--card)] border-b-2 border-[var(--stroke)] flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <Gamepad2 className="text-[var(--accent)] shrink-0" size={18} />
                <span className="font-extrabold text-sm sm:text-base truncate">
                  <RubyText text={activeGame.title} />
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
                    setActiveGame(null);
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

            {/* Sandboxed Iframe Game Player - Mobile responsive touch container */}
            <div className="flex-1 bg-black relative w-full h-full overflow-hidden touch-none">
              <iframe
                title={activeGame.title}
                srcDoc={activeGame.html_content}
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
