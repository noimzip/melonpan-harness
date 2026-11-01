import { useState } from 'react';
import {
  Download,
  FolderArchive,
  Play,
  Gamepad2,
  FileCode,
  Sparkles,
  Check,
} from 'lucide-react';
import JSZip from 'jszip';
import { WobblyButton } from './WobblyButton';

interface ArtifactGalleryProps {
  files: Record<string, string>;
  onPlayGame: (html: string) => void;
}

export function ArtifactGallery({ files, onPlayGame }: ArtifactGalleryProps) {
  const [downloadingZip, setDownloadingZip] = useState(false);
  const [zipSuccess, setZipSuccess] = useState(false);

  const htmlFiles = Object.entries(files).filter(([name]) => name.endsWith('.html'));

  const handleDownloadSingleHtml = (name: string, content: string) => {
    const blob = new Blob([content], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadZip = async () => {
    try {
      setDownloadingZip(true);
      const zip = new JSZip();

      for (const [name, content] of Object.entries(files)) {
        zip.file(name, content);
      }

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'melonpan-game-project.zip';
      a.click();
      URL.revokeObjectURL(url);

      setZipSuccess(true);
      setTimeout(() => setZipSuccess(false), 2500);
    } catch (err) {
      console.error('Failed to generate ZIP:', err);
    } finally {
      setDownloadingZip(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-5 space-y-6 bg-[var(--card)] select-none text-xs">
      {/* Header */}
      <div className="flex items-center justify-between border-b-2 border-[var(--stroke)] pb-3">
        <div className="flex items-center gap-2">
          <Gamepad2 size={18} className="text-[var(--accent)]" />
          <h3 className="font-bold text-base">展示ギャラリー & 成果物エクスポート</h3>
        </div>

        <WobblyButton size="sm" onClick={handleDownloadZip} disabled={downloadingZip}>
          {zipSuccess ? (
            <>
              <Check size={13} className="text-[var(--warm-success)]" />
              ZIPダウンロード完了！
            </>
          ) : (
            <>
              <FolderArchive size={13} />
              プロジェクトZIPを一括出力
            </>
          )}
        </WobblyButton>
      </div>

      {/* Showcase Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {htmlFiles.map(([name, content]) => (
          <div
            key={name}
            className="p-4 rounded-2xl border-2 border-[var(--stroke)] bg-[var(--background)] rough-shadow-sm flex flex-col justify-between space-y-4"
          >
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="font-bold font-mono text-sm flex items-center gap-1.5">
                  <FileCode size={15} className="text-[var(--accent)]" />
                  {name}
                </span>
                <span className="text-[11px] opacity-60">
                  {Math.round(content.length / 1024)} KB
                </span>
              </div>
              <p className="text-xs opacity-75 leading-relaxed">
                単一ファイルで完結する HTML5 Canvas 2D ゲーム。外部依存ゼロでブラウザ単体で即座に起動可能。
              </p>
            </div>

            <div className="flex items-center gap-2 pt-2 border-t border-[var(--stroke)]/20">
              <button
                onClick={() => onPlayGame(content)}
                className="flex-1 py-1.5 px-3 rounded-xl bg-[var(--accent)] text-white font-medium flex items-center justify-center gap-1 hover:brightness-105 active:scale-95 transition-all"
              >
                <Play size={13} />
                今すぐ試遊する
              </button>
              <button
                onClick={() => handleDownloadSingleHtml(name, content)}
                className="py-1.5 px-3 rounded-xl border border-[var(--stroke)]/40 hover:bg-black/5 flex items-center gap-1 text-[var(--foreground)]"
                title="HTMLを保存"
              >
                <Download size={13} />
                保存
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
