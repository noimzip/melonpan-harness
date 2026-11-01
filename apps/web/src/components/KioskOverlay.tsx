import React, { useState, useEffect } from 'react';
import {
  MonitorPlay,
  X,
  Sparkles,
  Timer,
  Play,
  Rocket,
  Flame,
  Gamepad,
  Crown,
} from 'lucide-react';
import { WobblyButton } from './WobblyButton';

interface KioskOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectPrompt: (prompt: string) => void;
  currentThought?: string;
  isStreaming?: boolean;
}

const PRESET_CARDS = [
  {
    icon: <Flame size={24} className="text-[#af734a]" />,
    title: '🍈 ネオンブロック崩し',
    desc: '弾むメロンパン玉とクッキーブロック。爽快な打撃感とスコアアタック！',
    prompt: 'ネオン風の光るブロック崩しゲームを作って！パドルの操作感を軽快にして、コンボ倍率とパーティクルを追加して。',
  },
  {
    icon: <Rocket size={24} className="text-[#3c7d58]" />,
    title: '🚀 宇宙シューティング',
    desc: 'マウスや左右キーで自機を操り、迫り来るエイリアンをレーザーで撃ち抜け！',
    prompt: '宇宙シューティングゲームを作って！左右移動とスペースキーでのビーム発射、敵の撃破時の爆発エフェクトを実装して。',
  },
  {
    icon: <Crown size={24} className="text-[#b5473a]" />,
    title: '👑 巨大ボスバトル',
    desc: '上部に巨大ボスが出現！HPバーを削り、弾幕をかいくぐって勝利を掴め！',
    prompt: '巨大ボス戦を追加して！ボスのHPバー、弾幕攻撃、そして撃破時の勝利ファンファーレ演出を実装して。',
  },
  {
    icon: <Gamepad size={24} className="text-[#5d4037]" />,
    title: '🏃 サイバーパンクランナー',
    desc: '障害物をジャンプで飛び越えろ！ハイスピードな横スクロールランゲーム。',
    prompt: '横スクロールの障害物ジャンプゲームを作って！スペースキーでジャンプ、走るほどスピードが上がるスリルある演出にして。',
  },
];

export function KioskOverlay({
  isOpen,
  onClose,
  onSelectPrompt,
  currentThought,
  isStreaming,
}: KioskOverlayProps) {
  const [countdown, setCountdown] = useState(120);

  // Inactivity countdown
  useEffect(() => {
    if (!isOpen) return;
    const interval = setInterval(() => {
      setCountdown((prev) => (prev > 0 ? prev - 1 : 120));
    }, 1000);
    return () => clearInterval(interval);
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[var(--background)]/95 backdrop-blur-md p-6 sm:p-10 select-none overflow-y-auto animate-in fade-in">
      {/* Top Banner */}
      <div className="flex items-center justify-between border-b-2 border-[var(--stroke)] pb-4 max-w-5xl mx-auto w-full">
        <div className="flex items-center gap-3">
          <span className="text-3xl">🍈</span>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
              Melonpan 高専祭・展示キオスク
            </h1>
            <p className="text-xs sm:text-sm opacity-70">
              ボタンを1回タッチするだけで、AIがリアルタイムにCanvas 2Dゲームを生成・実行します！
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-2xl bg-[var(--card)] border border-[var(--stroke)] font-mono text-xs opacity-80">
            <Timer size={14} className="text-[var(--accent)]" />
            <span>自動復帰: {countdown}s</span>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-2xl border-2 border-[var(--stroke)] bg-[var(--card)] hover:bg-black/5"
            title="キオスク終了"
          >
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="max-w-5xl mx-auto w-full flex-1 flex flex-col justify-center py-8 space-y-8">
        {/* Preset Cards Grid */}
        <div>
          <h2 className="text-base sm:text-lg font-bold mb-4 flex items-center gap-2">
            <Sparkles size={18} className="text-[var(--accent)]" />
            作ってみたいゲームを選んでね！
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {PRESET_CARDS.map((card, idx) => (
              <div
                key={idx}
                onClick={() => {
                  onSelectPrompt(card.prompt);
                  onClose();
                }}
                className="group p-5 rounded-3xl border-2 border-[var(--stroke)] bg-[var(--card)] rough-shadow hover:scale-[1.02] active:scale-[0.99] transition-all cursor-pointer flex flex-col justify-between space-y-4"
              >
                <div className="flex items-start gap-4">
                  <div className="p-3 rounded-2xl bg-[var(--background)] border-2 border-[var(--stroke)]/40 group-hover:rotate-6 transition-transform">
                    {card.icon}
                  </div>
                  <div>
                    <h3 className="font-bold text-lg mb-1">{card.title}</h3>
                    <p className="text-xs opacity-75 leading-relaxed">{card.desc}</p>
                  </div>
                </div>

                <div className="flex items-center justify-end text-xs font-bold text-[var(--accent)] gap-1 pt-2">
                  <span>このゲームを創る</span>
                  <Play size={12} fill="currentColor" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Live Thought Commentary Overlay */}
        {currentThought && (
          <div className="p-5 rounded-3xl border-2 border-[var(--stroke)] bg-[var(--card)] rough-shadow animate-in slide-in-from-bottom-2">
            <div className="flex items-center gap-2 text-xs font-bold text-[var(--accent)] mb-2">
              <span className="w-2.5 h-2.5 rounded-full bg-[var(--accent)] animate-ping" />
              <span>AI思考ライブ実況中 (Live Thought Stream)</span>
            </div>
            <div className="font-mono text-xs opacity-85 whitespace-pre-wrap leading-relaxed max-h-36 overflow-y-auto">
              {currentThought}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
