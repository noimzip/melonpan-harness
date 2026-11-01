import { useState } from 'react';
import {
  FileCode,
  FileText,
  FilePlus,
  GitCompare,
  Code2,
  Copy,
  Check,
} from 'lucide-react';

interface VfsExplorerProps {
  files: Record<string, string>;
  activeFile: string;
  onSelectFile: (path: string) => void;
  diffHistory?: Record<string, { oldContent?: string; newContent?: string; unifiedDiff?: string }>;
}

export function VfsExplorer({
  files,
  activeFile,
  onSelectFile,
  diffHistory = {},
}: VfsExplorerProps) {
  const [viewMode, setViewMode] = useState<'code' | 'diff'>('code');
  const [diffType, setDiffType] = useState<'side-by-side' | 'inline'>('side-by-side');
  const [copied, setCopied] = useState(false);

  const fileNames = Object.keys(files);
  const currentContent = files[activeFile] || '';
  const currentDiff = diffHistory[activeFile];

  const handleCopy = () => {
    navigator.clipboard.writeText(currentContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const lines = currentContent.split('\n');

  return (
    <div className="flex h-full bg-[var(--card)] select-none">
      {/* File Tree Sidebar */}
      <div className="w-52 border-r-2 border-[var(--stroke)] bg-[var(--background)]/50 flex flex-col">
        <div className="p-3 border-b-2 border-[var(--stroke)] font-bold text-xs flex items-center justify-between opacity-80">
          <span>VFS ファイルツリー</span>
          <span className="text-[11px] font-mono">{fileNames.length} files</span>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {fileNames.length === 0 ? (
            <div className="text-center py-6 text-xs text-[var(--foreground)] opacity-50 font-sans">
              (ファイルなし)
            </div>
          ) : (
            fileNames.map((fileName) => {
              const isActive = fileName === activeFile;
              const hasDiff = Boolean(diffHistory[fileName]);

              return (
                <button
                  key={fileName}
                  onClick={() => onSelectFile(fileName)}
                  className={[
                    'w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-mono transition-all text-left',
                    isActive
                      ? 'bg-[var(--accent)] text-white shadow-sm'
                      : 'hover:bg-black/5 text-[var(--foreground)]',
                  ].join(' ')}
                >
                  <div className="flex items-center gap-1.5 truncate">
                    {fileName.endsWith('.html') ? <FileCode size={13} /> : <FileText size={13} />}
                    <span className="truncate">{fileName}</span>
                  </div>
                  {hasDiff && (
                    <span className="w-2 h-2 rounded-full bg-[var(--warm-accent)]" title="最近変更あり" />
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Editor & Viewer Main */}
      <div className="flex-1 flex flex-col bg-[var(--background)]">
        {/* Editor Toolbar */}
        <div className="px-4 py-2 border-b-2 border-[var(--stroke)] bg-[var(--card)]/60 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-semibold">{activeFile}</span>
            <span className="text-[11px] opacity-60">({lines.length} lines)</span>
          </div>

          <div className="flex items-center gap-2">
            {/* Code / Diff Mode Switcher */}
            <div className="flex bg-[var(--background)] p-0.5 rounded-lg border border-[var(--stroke)]/40 text-xs">
              <button
                onClick={() => setViewMode('code')}
                className={[
                  'px-2.5 py-1 rounded font-medium flex items-center gap-1',
                  viewMode === 'code' ? 'bg-[var(--accent)] text-white' : 'hover:bg-black/5 opacity-70',
                ].join(' ')}
              >
                <Code2 size={13} />
                コード
              </button>
              <button
                onClick={() => setViewMode('diff')}
                className={[
                  'px-2.5 py-1 rounded font-medium flex items-center gap-1',
                  viewMode === 'diff' ? 'bg-[var(--accent)] text-white' : 'hover:bg-black/5 opacity-70',
                ].join(' ')}
              >
                <GitCompare size={13} />
                差分 (Diff)
              </button>
            </div>

            {/* Copy button */}
            <button
              onClick={handleCopy}
              className="p-1.5 rounded-lg hover:bg-black/5 text-[var(--foreground)] text-xs flex items-center gap-1"
              title="コードをコピー"
            >
              {copied ? <Check size={14} className="text-[var(--warm-success)]" /> : <Copy size={14} />}
            </button>
          </div>
        </div>

        {/* Content View */}
        <div className="flex-1 overflow-auto p-3 font-mono text-xs bg-[#221a18] text-[#e0d5c5]">
          {fileNames.length === 0 ? (
            <div className="text-center py-16 text-[#8a7566] font-sans">
              <div className="text-2xl mb-2">📁</div>
              <p className="font-semibold text-sm">VFSにファイルが存在しません</p>
              <p className="text-xs opacity-75 mt-1">エージェントがファイル（index.html等）を書き込むと、ここにツリーとコードが表示されます。</p>
            </div>
          ) : viewMode === 'code' ? (
            <div className="space-y-0.5 select-text">
              {lines.map((line, idx) => (
                <div key={idx} className="flex hover:bg-white/5 leading-relaxed">
                  <span className="w-10 text-right pr-4 text-[#8a7566] select-none shrink-0 font-mono text-[11px]">
                    {idx + 1}
                  </span>
                  <span className="whitespace-pre flex-1">{line || ' '}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="select-text">
              {currentDiff?.unifiedDiff ? (
                <pre className="whitespace-pre-wrap leading-relaxed text-[12px] font-mono">
                  {currentDiff.unifiedDiff}
                </pre>
              ) : (
                <div className="text-center py-12 text-[#8a7566] font-sans">
                  直前の変更差分はありません。
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
