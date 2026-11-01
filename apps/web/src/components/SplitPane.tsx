import React, { useState, useRef, useEffect, ReactNode } from 'react';
import { GripVertical } from 'lucide-react';

interface SplitPaneProps {
  left: ReactNode;
  right: ReactNode;
  initialRatio?: number;
}

export function SplitPane({ left, right, initialRatio = 0.5 }: SplitPaneProps) {
  const [ratio, setRatio] = useState(initialRatio);
  const isDraggingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    document.body.style.cursor = 'col-resize';
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const newRatio = (e.clientX - rect.left) / rect.width;
      // Clamp between 25% and 75%
      setRatio(Math.max(0.25, Math.min(0.75, newRatio)));
    };

    const handleMouseUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        document.body.style.cursor = '';
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  return (
    <div ref={containerRef} className="flex-1 flex h-full overflow-hidden select-none">
      {/* Left Pane (Timeline) */}
      <div
        style={{ width: `${ratio * 100}%` }}
        className="h-full flex flex-col min-w-[320px] overflow-hidden"
      >
        {left}
      </div>

      {/* Draggable Divider Handle */}
      <div
        onMouseDown={handleMouseDown}
        className="w-2 relative bg-[var(--stroke)]/20 hover:bg-[var(--accent)] cursor-col-resize flex items-center justify-center transition-colors group z-20"
        title="ドラッグして画面幅を調整"
      >
        <div className="absolute w-5 h-8 rounded-md bg-[var(--card)] border border-[var(--stroke)] rough-shadow-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
          <GripVertical size={12} className="text-[var(--foreground)]" />
        </div>
      </div>

      {/* Right Pane (Workspace) */}
      <div
        style={{ width: `${(1 - ratio) * 100}%` }}
        className="h-full flex flex-col min-w-[340px] overflow-hidden"
      >
        {right}
      </div>
    </div>
  );
}
