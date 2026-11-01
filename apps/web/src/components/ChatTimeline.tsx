import React, { useState, useRef, useEffect } from 'react';
import {
  Send,
  Square,
  Sparkles,
  ChevronDown,
  ChevronUp,
  BrainCircuit,
  Wrench,
  Bot,
  User,
  ArrowDown,
  Mic,
  Plus,
} from 'lucide-react';
import { Message, ProviderConfig } from '../types';
import { ToolCard } from './ToolCard';

interface ChatTimelineProps {
  messages: Message[];
  isAgentRunning: boolean;
  onSendMessage: (text: string) => void;
  onCancelTask: () => void;
  providerConfig: ProviderConfig;
  onSelectProvider: (p: ProviderConfig['provider']) => void;
  onOpenPresetModal: () => void;
}

export function ChatTimeline({
  messages,
  isAgentRunning,
  onSendMessage,
  onCancelTask,
  providerConfig,
  onSelectProvider,
  onOpenPresetModal,
}: ChatTimelineProps) {
  const [inputText, setInputText] = useState('');
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [showToolMenu, setShowToolMenu] = useState(false);
  const [expandedThoughts, setExpandedThoughts] = useState<Record<string, boolean>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = (smooth = true) => {
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' });
  };

  useEffect(() => {
    scrollToBottom(false);
  }, [messages.length]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isAgentRunning) return;
    onSendMessage(inputText.trim());
    setInputText('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const toggleThought = (msgId: string) => {
    setExpandedThoughts((prev) => ({
      ...prev,
      [msgId]: !prev[msgId],
    }));
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[var(--background)] relative">
      {/* Scrollable messages container */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto px-4 py-6 space-y-6 max-w-4xl mx-auto w-full"
      >
        {messages.map((msg) => {
          const isUser = msg.role === 'user';
          const isThoughtExpanded = expandedThoughts[msg.id] ?? msg.isStreaming ?? false;

          return (
            <div
              key={msg.id}
              className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} space-y-1.5`}
            >
              {/* Message Bubble */}
              <div
                className={[
                  'max-w-[88%] sm:max-w-[80%] px-5 py-4 line-boil rough-outline rough-shadow text-[15px] leading-relaxed',
                  isUser
                    ? 'bg-[#edd9c5] text-[var(--foreground)] rounded-3xl rounded-tr-md self-end'
                    : 'bg-[var(--card)] text-[var(--foreground)] rounded-3xl rounded-tl-md self-start',
                ].join(' ')}
              >
                {/* Streaming Thought Box */}
                {msg.thought && (
                  <div className="mb-3 bg-[var(--background)]/70 rounded-2xl border border-[var(--stroke)]/30 overflow-hidden text-xs">
                    <button
                      type="button"
                      onClick={() => toggleThought(msg.id)}
                      className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-black/5 font-medium select-none"
                    >
                      <div className="flex items-center gap-2 text-[var(--accent)]">
                        <BrainCircuit size={15} />
                        <span>AIの思考プロセス</span>
                        {msg.isStreaming && (
                          <span className="w-2 h-2 rounded-full bg-[var(--accent)] animate-ping" />
                        )}
                      </div>
                      {isThoughtExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>

                    {isThoughtExpanded && (
                      <div className="p-3 border-t border-[var(--stroke)]/20 whitespace-pre-wrap font-mono text-[12px] opacity-85 leading-relaxed bg-black/5 max-h-56 overflow-y-auto">
                        {msg.thought}
                      </div>
                    )}
                  </div>
                )}

                {/* Message Content */}
                <div className="whitespace-pre-wrap break-words">{msg.content}</div>

                {/* Tool Invocations */}
                {msg.toolCalls && msg.toolCalls.length > 0 && (
                  <div className="mt-3 space-y-1">
                    {msg.toolCalls.map((tc) => (
                      <ToolCard key={tc.id} toolCall={tc} />
                    ))}
                  </div>
                )}
              </div>

              {/* Timestamp */}
              <div className="text-[11px] opacity-50 px-2">
                {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Scroll to bottom button */}
      <button
        onClick={() => scrollToBottom(true)}
        className="absolute right-6 bottom-28 w-10 h-10 rounded-full bg-[var(--card)] border-2 border-[var(--stroke)] rough-shadow flex items-center justify-center hover:scale-105 active:scale-95 transition-all text-[var(--foreground)]"
        title="一番下へスクロール"
      >
        <ArrowDown size={18} />
      </button>

      {/* Bottom Input Area matching reference image */}
      <div className="p-4 max-w-4xl mx-auto w-full">
        <form onSubmit={handleSubmit} className="relative">
          {/* Main Pill Input Box */}
          <div className="bg-[var(--card)] line-boil rough-outline rough-shadow rounded-3xl sm:rounded-[32px] p-3 sm:px-5 sm:py-3.5 flex flex-col gap-2">
            {/* Textarea */}
            <textarea
              rows={2}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="今日のこと、どんな小さな話でも聞かせてね（ゲームの仕様や追加したい機能など）..."
              className="w-full bg-transparent resize-none outline-none text-base placeholder:text-[var(--foreground)]/45 leading-relaxed"
            />

            {/* Controls Row */}
            <div className="flex items-center justify-between pt-1">
              {/* Left controls */}
              <div className="flex items-center gap-2">
                {/* Presets button */}
                <button
                  type="button"
                  onClick={onOpenPresetModal}
                  className="p-1.5 rounded-full hover:bg-black/5 text-[var(--foreground)]/80 hover:scale-105 transition-all"
                  title="プロンプトプリセット"
                >
                  <Plus size={20} />
                </button>

                {/* Tools dropdown */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowToolMenu(!showToolMenu)}
                    className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full hover:bg-black/5 opacity-80"
                  >
                    <Wrench size={13} />
                    <span>ツール</span>
                    <ChevronDown size={12} />
                  </button>
                  {showToolMenu && (
                    <div className="absolute left-0 bottom-full mb-2 bg-[var(--card)] border-2 border-[var(--stroke)] rounded-xl rough-shadow p-2 w-48 text-xs z-30">
                      <div className="font-semibold px-2 py-1 border-b border-[var(--stroke)]/20 mb-1">
                        利用可能なコアツール
                      </div>
                      <div className="px-2 py-1 opacity-80">• write_file (ファイル生成)</div>
                      <div className="px-2 py-1 opacity-80">• edit_file (差分パッチ修正)</div>
                      <div className="px-2 py-1 opacity-80">• read_file / list_files</div>
                      <div className="px-2 py-1 opacity-80">• run_command (シェル実行)</div>
                      <div className="px-2 py-1 opacity-80">• web_search (Web探索)</div>
                    </div>
                  )}
                </div>
              </div>

              {/* Right controls */}
              <div className="flex items-center gap-2 sm:gap-3">
                {/* Model Selector Badge */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowModelMenu(!showModelMenu)}
                    className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-[var(--background)]/60 hover:bg-[var(--background)] border border-[var(--stroke)]/30 font-medium opacity-90"
                  >
                    <Bot size={13} className="text-[var(--accent)]" />
                    <span>
                      {providerConfig.provider === 'simulation'
                        ? 'Simulation Mode (オフライン)'
                        : `${providerConfig.provider}: ${providerConfig.model}`}
                    </span>
                    <ChevronDown size={12} />
                  </button>

                  {showModelMenu && (
                    <div className="absolute right-0 bottom-full mb-2 bg-[var(--card)] border-2 border-[var(--stroke)] rounded-xl rough-shadow p-2 w-56 text-xs z-30 space-y-1">
                      <div className="font-semibold px-2 py-1 border-b border-[var(--stroke)]/20 mb-1">
                        プロバイダー切り替え
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          onSelectProvider('simulation');
                          setShowModelMenu(false);
                        }}
                        className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-black/5 font-medium"
                      >
                        🍈 Simulation Mode (推奨・無料)
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onSelectProvider('gemini');
                          setShowModelMenu(false);
                        }}
                        className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-black/5 font-medium"
                      >
                        ⚡ Gemini 2.5 / 3 Flash
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onSelectProvider('openai');
                          setShowModelMenu(false);
                        }}
                        className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-black/5 font-medium"
                      >
                        🤖 OpenAI Compatible
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onSelectProvider('bridge');
                          setShowModelMenu(false);
                        }}
                        className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-black/5 font-medium"
                      >
                        🔌 Node.js Bridge (LocalDiskFS)
                      </button>
                    </div>
                  )}
                </div>

                {/* Stop or Send Button */}
                {isAgentRunning ? (
                  <button
                    type="button"
                    onClick={onCancelTask}
                    className="p-2.5 rounded-full bg-[var(--warm-error)] text-white hover:brightness-110 active:scale-95 transition-all shadow-md"
                    title="タスクを中断"
                  >
                    <Square size={16} fill="white" />
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={!inputText.trim()}
                    className="p-2.5 rounded-full bg-[#af734a] text-white hover:brightness-105 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-md"
                    title="メッセージを送信"
                  >
                    <Send size={16} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
