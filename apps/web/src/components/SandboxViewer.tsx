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
  files?: Record<string, string>;
  onFixError: (errorDetails: string) => void;
}

/**
 * Normalize relative VFS path and look up matching content in the VFS files map.
 */
function lookupVfsAsset(
  rawUrl: string,
  files?: Record<string, string>
): string | undefined {
  if (!files || !rawUrl) return undefined;
  const trimmed = rawUrl.trim();
  if (
    /^(https?:|data:|blob:|\/\/)/i.test(trimmed)
  ) {
    return undefined;
  }
  const cleanPath = trimmed
    .split(/[?#]/)[0]
    .replace(/^(\.\/|\/)+/, '');
  if (!cleanPath) return undefined;

  if (files[cleanPath] !== undefined) return files[cleanPath];
  if (files[`./${cleanPath}`] !== undefined) return files[`./${cleanPath}`];
  if (files[`/${cleanPath}`] !== undefined) return files[`/${cleanPath}`];
  return undefined;
}

/**
 * Inline external VFS scripts (<script src="...">) and stylesheets (<link rel="stylesheet" href="...">)
 * directly into the HTML string so that iframe srcDoc does not fail with 404 errors on multi-file VFS projects.
 */
export function inlineVfsAssets(
  html: string,
  files?: Record<string, string>
): string {
  if (!html || !files || Object.keys(files).length === 0) {
    return html;
  }

  let result = html;

  // 1. Inline <script ... src="path/to/file.js" ...></script>
  result = result.replace(
    /<script\b([^>]*?)\bsrc=(["'])([^"']+)\2([^>]*?)>\s*<\/script>/gi,
    (fullMatch, beforeSrc, _quote, srcUrl, afterSrc) => {
      const jsContent = lookupVfsAsset(srcUrl, files);
      if (jsContent === undefined) {
        return fullMatch;
      }
      const attrs = `${beforeSrc} ${afterSrc}`.replace(/\s+/g, ' ').trim();
      const attrSuffix = attrs ? ` ${attrs}` : '';
      // Escape any accidental </script> inside JS string literals so HTML parser doesn't break prematurely
      const safeJs = jsContent.replace(/<\/script>/gi, '<\\/script>');
      return `<script${attrSuffix} data-vfs-inlined="${srcUrl}">\n${safeJs}\n</script>`;
    }
  );

  // 2. Inline <link ... rel="stylesheet" ... href="path/to/file.css" ...>
  result = result.replace(
    /<link\b([^>]*?)>/gi,
    (fullMatch, attrsText) => {
      if (!/\brel=(["']?)stylesheet\1/i.test(attrsText)) {
        return fullMatch;
      }
      const hrefMatch = attrsText.match(/\bhref=(["'])([^"']+)\1/i);
      if (!hrefMatch) {
        return fullMatch;
      }
      const hrefUrl = hrefMatch[2];
      const cssContent = lookupVfsAsset(hrefUrl, files);
      if (cssContent === undefined) {
        return fullMatch;
      }
      return `<style data-vfs-inlined="${hrefUrl}">\n${cssContent}\n</style>`;
    }
  );

  return result;
}

export function SandboxViewer({ htmlContent, files, onFixError }: SandboxViewerProps) {
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

  // Resolve and inline VFS external scripts and stylesheets before injecting into srcDoc
  const bundledHtml = inlineVfsAssets(htmlContent, files);

  // Inject error capture script right after <head> or at top
  const injectedHtml = bundledHtml.includes('<head>')
    ? bundledHtml.replace('<head>', `<head>${errorCaptureScript}`)
    : `${errorCaptureScript}${bundledHtml}`;

  const handleRestart = () => {
    setCaughtError(null);
    setKey((prev) => prev + 1);
  };

  const handleOpenPopup = () => {
    const blob = new Blob([bundledHtml], { type: 'text/html' });
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
