import { useState, useEffect, useRef } from 'react';
import {
  RotateCcw,
  ExternalLink,
  Maximize2,
  AlertTriangle,
  Wrench,
  X,
  Play,
  Pause,
} from 'lucide-react';
import { WobblyButton } from './WobblyButton';

interface SandboxViewerProps {
  htmlContent: string;
  onFixError: (errorDetails: string) => void;
}

export function SandboxViewer({ htmlContent, onFixError }: SandboxViewerProps) {
  const [key, setKey] = useState(0);
  const [caughtError, setCaughtError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Error listener from iframe postMessage
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === 'SANDBOX_RUNTIME_ERROR') {
        const errorText = event.data.message || 'Unknown runtime error';
        const stack = event.data.stack ? `\nStack: ${event.data.stack}` : '';
        setCaughtError(`${errorText}${stack}`);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Prepare iframe HTML with error capture script injected
  const errorCaptureScript = `
    <script>
      (function() {
        window.onerror = function(msg, url, lineNo, columnNo, error) {
          window.parent.postMessage({
            type: 'SANDBOX_RUNTIME_ERROR',
            message: msg + ' (Line ' + lineNo + ':' + columnNo + ')',
            stack: error ? error.stack : ''
          }, '*');
          return false;
        };
        window.addEventListener('unhandledrejection', function(event) {
          window.parent.postMessage({
            type: 'SANDBOX_RUNTIME_ERROR',
            message: 'Unhandled Promise Rejection: ' + (event.reason ? event.reason.message || event.reason : 'unknown'),
            stack: event.reason && event.reason.stack ? event.reason.stack : ''
          }, '*');
        });
      })();
    </script>
  `;

  // Inject error capture script right after <head> or at top
  const injectedHtml = htmlContent.includes('<head>')
    ? htmlContent.replace('<head>', `<head>${errorCaptureScript}`)
    : `${errorCaptureScript}${htmlContent}`;

  const handleRestart = () => {
    setCaughtError(null);
    setKey((prev) => prev + 1);
  };

  const handleOpenPopup = () => {
    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  };

  return (
    <div className="flex flex-col h-full bg-[var(--card)] relative overflow-hidden select-none">
      {/* Sandbox Header Toolbar */}
      <div className="px-4 py-2.5 bg-[var(--background)]/60 border-b-2 border-[var(--stroke)] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-[var(--warm-success)] animate-pulse" />
          <span className="font-bold text-sm">Live HTML5 Canvas 2D プレビュー</span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={handleRestart}
            className="p-1.5 rounded-lg hover:bg-black/5 text-[var(--foreground)] transition-transform active:scale-90"
            title="再起動"
          >
            <RotateCcw size={15} />
          </button>
          <button
            onClick={handleOpenPopup}
            className="p-1.5 rounded-lg hover:bg-black/5 text-[var(--foreground)] transition-transform active:scale-90"
            title="別タブで開く"
          >
            <ExternalLink size={15} />
          </button>
        </div>
      </div>

      {/* Runtime Error Banner with Self-Repair Loop */}
      {caughtError && (
        <div className="bg-[var(--error-bg)] border-b-2 border-[var(--warm-error)] px-4 py-2.5 text-xs text-[var(--warm-error)] flex items-center justify-between z-20 animate-in slide-in-from-top duration-200">
          <div className="flex items-center gap-2 overflow-hidden mr-2">
            <AlertTriangle size={16} className="shrink-0" />
            <span className="font-mono truncate">{caughtError}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <WobblyButton
              size="sm"
              variant="danger"
              onClick={() => {
                onFixError(`実行時エラーが発生しました:\n${caughtError}`);
                setCaughtError(null);
              }}
              className="!py-1 !px-2.5"
            >
              <Wrench size={12} />
              AIに自己修復を依頼
            </WobblyButton>
            <button
              onClick={() => setCaughtError(null)}
              className="p-1 hover:bg-black/10 rounded"
              title="閉じる"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Sandboxed iframe container or Empty State */}
      <div className="flex-1 w-full h-full p-3 flex items-center justify-center bg-[var(--background)]/40 overflow-hidden">
        {htmlContent.trim() ? (
          <div className="w-full h-full rounded-2xl overflow-hidden rough-outline shadow-inner bg-[#fffdf9] relative">
            <iframe
              key={key}
              ref={iframeRef}
              srcDoc={injectedHtml}
              sandbox="allow-scripts allow-modals allow-same-origin"
              className="w-full h-full border-none block"
              title="Canvas 2D Sandbox"
            />
          </div>
        ) : (
          <div className="text-center py-12 px-6 flex flex-col items-center gap-3 opacity-60">
            <div className="w-16 h-16 rounded-full bg-[var(--card)] border-2 border-[var(--stroke)] flex items-center justify-center text-2xl rough-shadow-sm">
              🍈
            </div>
            <p className="font-bold text-sm">プレビューするHTML5ゲームがまだありません</p>
            <p className="text-xs max-w-sm">
              チャットでエージェントにゲームのアイデアや要件を伝えると、ここに生成されたCanvasゲームがリアルタイムで描画されます。
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
