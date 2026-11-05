import React, { useState, useRef, useEffect } from 'react';
import {
  Send,
  Square,
  Sparkles,
  ChevronDown,
  ChevronUp,
  BrainCircuit,
  Bot,
  User,
  ArrowDown,
  Mic,
  Plus,
  Paperclip,
  Search,
  Check,
  Shield,
  Layers,
} from 'lucide-react';
import { Message, ProviderConfig } from '../types';
import { ToolCard } from './ToolCard';
import { webCommandRegistry } from '../services/command-registry';
import { ALL_SUPPORTED_MODELS, getAvailableModels } from '../services/provider-factory';
import { resolveModelContextWindow, formatTokens } from '@melonpan/core';

interface ChatTimelineProps {
  messages: Message[];
  isAgentRunning: boolean;
  onSendMessage: (text: string) => void;
  onCancelTask: () => void;
  providerConfig: ProviderConfig;
  onSelectModel: (model: string) => void;
  onSelectThinkingEffort: (effort: ProviderConfig['thinkingEffort']) => void;
  sessionMode: 'auto' | 'ask' | 'strict';
  onChangeMode: (mode: 'auto' | 'ask' | 'strict') => void;
  onAttachFiles?: (files: { name: string; content: string }[]) => void;
}

export function ChatTimeline({
  messages,
  isAgentRunning,
  onSendMessage,
  onCancelTask,
  providerConfig,
  onSelectModel,
  onSelectThinkingEffort,
  sessionMode,
  onChangeMode,
  onAttachFiles,
}: ChatTimelineProps) {
  const [inputText, setInputText] = useState('');
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [showEffortMenu, setShowEffortMenu] = useState(false);
  const [showModeMenu, setShowModeMenu] = useState(false);
  const [modelSearchQuery, setModelSearchQuery] = useState('');
  const [expandedThoughts, setExpandedThoughts] = useState<Record<string, boolean>>({});
  const [isListening, setIsListening] = useState(false);
  const [suggestIndex, setSuggestIndex] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Filter models for connected provider only + search query (with dynamic API discovery models prioritized)
  const connectedModels = getAvailableModels(providerConfig.provider);
  const filteredModels = connectedModels.filter((m) => {
    const q = modelSearchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      m.id.toLowerCase().includes(q) ||
      m.label.toLowerCase().includes(q) ||
      m.description.toLowerCase().includes(q) ||
      (m.isFree && 'free'.includes(q))
    );
  });

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const fileList: { name: string; content: string }[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const text = await file.text();
        fileList.push({ name: file.name, content: text });
      } catch (err) {
        console.error('Error reading attached file:', err);
      }
    }

    if (fileList.length > 0) {
      if (onAttachFiles) {
        onAttachFiles(fileList);
      }
      const summary = fileList.map((f) => `📎 添付ファイル: ${f.name} (${f.content.length} 文字)`).join('\n');
      setInputText((prev) => (prev ? `${prev}\n\n${summary}` : summary));
    }

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const suggestions = inputText.startsWith('/')
    ? webCommandRegistry.getAutocompleteSuggestions(inputText)
    : [];

  useEffect(() => {
    setSuggestIndex(0);
  }, [suggestions.length, inputText]);

  const scrollToBottom = (smooth = true) => {
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' });
  };

  useEffect(() => {
    scrollToBottom(false);
  }, [messages.length]);

  const handleToggleVoice = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert('お使いのブラウザはWeb Speech APIに対応していません。テキスト入力をご利用ください。');
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.lang = 'ja-JP';
      recognition.continuous = false;
      recognition.interimResults = false;

      recognition.onstart = () => setIsListening(true);
      recognition.onend = () => setIsListening(false);
      recognition.onerror = () => setIsListening(false);
      recognition.onresult = (event: any) => {
        const transcript = event.results[0]?.[0]?.transcript || '';
        if (transcript) {
          setInputText((prev) => (prev ? `${prev} ${transcript}` : transcript));
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (e) {
      console.error('Speech recognition error:', e);
      setIsListening(false);
    }
  };

  const handleApplySuggestion = (text: string) => {
    setInputText(text);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isAgentRunning) return;
    onSendMessage(inputText.trim());
    setInputText('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSuggestIndex((prev) => (prev + 1) % suggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSuggestIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        const selected = suggestions[suggestIndex];
        if (selected) {
          handleApplySuggestion(selected.text);
        }
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        // If exact command or user has typed beyond, run submit
        if (suggestions.length > 0 && suggestIndex >= 0 && suggestIndex < suggestions.length) {
          const selected = suggestions[suggestIndex];
          if (selected && inputText.trim() !== selected.text.trim()) {
            e.preventDefault();
            handleApplySuggestion(selected.text);
            return;
          }
        }
      }
    }

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
        {messages.map((msg, index) => {
          const isUser = msg.role === 'user';
          const isThoughtExpanded = expandedThoughts[msg.id] ?? msg.isStreaming ?? false;
          const isInitialGreeting = index === 0 && !isUser && msg.content.includes('今日はどんな一日だった');

          return (
            <div
              key={msg.id}
              className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} space-y-1.5`}
            >
              {/* Message Bubble matching hand-drawn reference image */}
              <div
                className={[
                  'max-w-[92%] sm:max-w-[85%] px-5 py-4 line-boil rough-outline rough-shadow text-[15px] leading-relaxed',
                  isUser
                    ? 'bg-[#edd9c5] text-[var(--foreground)] rounded-3xl self-end'
                    : 'bg-[var(--card)] text-[var(--foreground)] rounded-3xl sm:rounded-[32px] self-start',
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

              {/* Gentle hand-drawn subtitle for greeting prompt */}
              {isInitialGreeting && (
                <div className="text-[12px] opacity-60 px-3 tracking-wide">
                  きょうの気持ち、なんでも話してね。
                </div>
              )}

              {/* Timestamp */}
              <div className="text-[11px] opacity-50 px-2">
                {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Scroll to bottom button matching reference image down chevron */}
      <button
        onClick={() => scrollToBottom(true)}
        className="absolute right-6 bottom-28 w-9 h-9 rounded-full bg-[var(--card)] border-2 border-[var(--stroke)] rough-shadow flex items-center justify-center hover:scale-105 active:scale-95 transition-all text-[var(--foreground)]"
        title="一番下へスクロール"
      >
        <ChevronDown size={18} />
      </button>

      {/* Bottom Input Area matching reference image */}
      <div className="p-4 max-w-4xl mx-auto w-full">
        <form onSubmit={handleSubmit} className="relative">
          {/* Autocomplete Suggestions Overlay */}
          {suggestions.length > 0 && (
            <div className="absolute bottom-full left-0 right-0 mb-2 bg-[var(--card)] border-2 border-[var(--stroke)] rounded-2xl rough-shadow p-2 z-40 max-h-56 overflow-y-auto space-y-1">
              <div className="flex items-center justify-between px-2 py-1 text-[11px] font-semibold text-[var(--foreground)]/60 border-b border-[var(--stroke)]/20 mb-1">
                <span>💡 スラッシュコマンド補完 ({suggestions.length})</span>
                <span>[Tab / Enter: 選択] [↑/↓: 移動]</span>
              </div>
              {suggestions.map((item, idx) => {
                const isSelected = idx === suggestIndex;
                return (
                  <button
                    key={`${item.text}-${idx}`}
                    type="button"
                    onClick={() => handleApplySuggestion(item.text)}
                    className={[
                      'w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl text-left text-xs transition-all',
                      isSelected
                        ? 'bg-[#af734a] text-white font-bold shadow-sm'
                        : 'hover:bg-black/5 text-[var(--foreground)]',
                    ].join(' ')}
                  >
                    <span className="font-mono">{item.display}</span>
                    <span className={`text-[11px] opacity-80 ${isSelected ? 'text-white/90' : 'text-[var(--foreground)]/70'}`}>
                      {item.description}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Main Pill Input Box */}
          <div className="bg-[var(--card)] line-boil rough-outline rough-shadow rounded-3xl sm:rounded-[32px] p-3 sm:px-5 sm:py-3.5 flex flex-col gap-2">
            {/* Textarea */}
            <textarea
              rows={2}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="今日のこと、どんな小さな話でも聞かせてね（/ でコマンド補完、ゲーム仕様など）..."
              className="w-full bg-transparent resize-none outline-none text-base placeholder:text-[var(--foreground)]/45 leading-relaxed"
            />

            {/* Controls Row */}
            <div className="flex items-center justify-between pt-1">
              {/* Left controls */}
              <div className="flex items-center gap-1.5 sm:gap-2">
                {/* Hidden File Input for Attachment */}
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileInputChange}
                  multiple
                  className="hidden"
                />

                {/* File Attachment (+) button */}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="p-1.5 rounded-full hover:bg-black/5 text-[var(--foreground)]/80 hover:scale-105 transition-all"
                  title="ファイルを添付 (+)"
                >
                  <Plus size={20} />
                </button>

                {/* Mode Selector (auto / ask / strict) List Dropdown */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      setShowModeMenu(!showModeMenu);
                      setShowModelMenu(false);
                      setShowEffortMenu(false);
                    }}
                    className={[
                      'flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border transition-all font-medium',
                      sessionMode === 'strict'
                        ? 'border-red-300 bg-red-50 text-red-700'
                        : sessionMode === 'ask'
                        ? 'border-amber-300 bg-amber-50 text-amber-800'
                        : 'border-[var(--stroke)]/30 bg-[var(--background)]/60 text-[var(--foreground)] opacity-90',
                    ].join(' ')}
                    title="実行モード切り替え"
                  >
                    <Shield size={12} className={sessionMode === 'strict' ? 'text-red-500' : sessionMode === 'ask' ? 'text-amber-600' : 'text-[var(--accent)]'} />
                    <span className="capitalize">{sessionMode} モード</span>
                    <ChevronDown size={12} />
                  </button>

                  {showModeMenu && (
                    <div className="absolute left-0 bottom-full mb-2 bg-[var(--card)] border-2 border-[var(--stroke)] rounded-2xl rough-shadow p-2 w-52 text-xs z-30 space-y-1">
                      <div className="font-semibold px-2 py-1 border-b border-[var(--stroke)]/20 mb-1 flex items-center gap-1.5">
                        <Layers size={13} className="text-[var(--accent)]" />
                        <span>実行モード選択</span>
                      </div>
                      {[
                        {
                          id: 'ask' as const,
                          label: 'ask (対話承認・推奨)',
                          desc: 'ファイルの変更やコマンド実行前に対話確認モーダルを表示します',
                        },
                        {
                          id: 'auto' as const,
                          label: 'auto (全自動実行)',
                          desc: '安全なツールを自動許可し、素早く自律作業を継続します',
                        },
                        {
                          id: 'strict' as const,
                          label: 'strict (厳格保護)',
                          desc: 'コマンド実行や危険な変更をブロックし安全性を最優先にします',
                        },
                      ].map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            onChangeMode(item.id);
                            setShowModeMenu(false);
                          }}
                          className={[
                            'w-full text-left px-2.5 py-1.5 rounded-xl transition-all flex flex-col gap-0.5',
                            sessionMode === item.id
                              ? 'bg-[var(--accent)] text-white shadow-sm font-semibold'
                              : 'hover:bg-black/5 text-[var(--foreground)]',
                          ].join(' ')}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-medium">{item.label}</span>
                            {sessionMode === item.id && <Check size={12} />}
                          </div>
                          <span
                            className={`text-[10px] leading-tight ${
                              sessionMode === item.id ? 'text-white/85' : 'opacity-70'
                            }`}
                          >
                            {item.desc}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Right controls */}
              <div className="flex items-center gap-1.5 sm:gap-2.5">
                {/* Thinking Effort Selector List Dropdown */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      setShowEffortMenu(!showEffortMenu);
                      setShowModelMenu(false);
                      setShowModeMenu(false);
                    }}
                    className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-[var(--background)]/60 hover:bg-[var(--background)] border border-[var(--stroke)]/30 font-medium opacity-90"
                    title="推論深度 (Thinking Effort)"
                  >
                    <BrainCircuit size={12} className="text-[var(--accent)]" />
                    <span className="capitalize">{providerConfig.thinkingEffort}</span>
                    <ChevronDown size={11} />
                  </button>

                  {showEffortMenu && (
                    <div className="absolute right-0 bottom-full mb-2 bg-[var(--card)] border-2 border-[var(--stroke)] rounded-2xl rough-shadow p-2 w-48 text-xs z-30 space-y-1">
                      <div className="font-semibold px-2 py-1 border-b border-[var(--stroke)]/20 mb-1 flex items-center gap-1">
                        <BrainCircuit size={13} className="text-[var(--accent)]" />
                        <span>推論深度 (Thinking Effort)</span>
                      </div>
                      {(['minimal', 'low', 'medium', 'high'] as const).map((eff) => (
                        <button
                          key={eff}
                          type="button"
                          onClick={() => {
                            onSelectThinkingEffort(eff);
                            setShowEffortMenu(false);
                          }}
                          className={[
                            'w-full text-left px-2.5 py-1.5 rounded-xl transition-all flex items-center justify-between capitalize',
                            providerConfig.thinkingEffort === eff
                              ? 'bg-[var(--accent)] text-white shadow-sm font-semibold'
                              : 'hover:bg-black/5 text-[var(--foreground)]',
                          ].join(' ')}
                        >
                          <span>{eff}</span>
                          {providerConfig.thinkingEffort === eff && <Check size={12} />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Model Selector Badge & Searchable List Dropdown */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      setShowModelMenu(!showModelMenu);
                      setShowEffortMenu(false);
                      setShowModeMenu(false);
                      setModelSearchQuery('');
                    }}
                    className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-[var(--background)]/60 hover:bg-[var(--background)] border border-[var(--stroke)]/30 font-medium opacity-90 max-w-[180px] sm:max-w-[220px]"
                    title="モデル選択"
                  >
                    <Bot size={13} className="text-[var(--accent)] shrink-0" />
                    <span className="truncate">
                      {providerConfig.model} ({formatTokens(resolveModelContextWindow(providerConfig.model))})
                    </span>
                    <ChevronDown size={12} className="shrink-0" />
                  </button>

                  {showModelMenu && (
                    <div className="absolute right-0 bottom-full mb-2 bg-[var(--card)] border-2 border-[var(--stroke)] rounded-2xl rough-shadow p-2.5 w-72 sm:w-80 text-xs z-30 space-y-2">
                      <div className="flex items-center justify-between border-b border-[var(--stroke)]/20 pb-1.5 px-1">
                        <span className="font-semibold text-xs flex items-center gap-1">
                          <Bot size={13} className="text-[var(--accent)]" />
                          <span>モデル選択 ({providerConfig.provider})</span>
                        </span>
                        <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-[var(--background)] border border-[var(--stroke)]/30">
                          {providerConfig.provider}
                        </span>
                      </div>

                      {/* Incremental Search Box */}
                      <div className="relative">
                        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 opacity-50" />
                        <input
                          type="text"
                          value={modelSearchQuery}
                          onChange={(e) => setModelSearchQuery(e.target.value)}
                          placeholder={`${providerConfig.provider} のモデルを検索...`}
                          className="w-full bg-[var(--background)] border border-[var(--stroke)]/40 rounded-xl pl-8 pr-3 py-1.5 outline-none font-sans text-xs"
                          autoFocus
                        />
                      </div>

                      {/* Model List */}
                      <div className="max-h-52 overflow-y-auto space-y-1 pr-1">
                        {filteredModels.length > 0 ? (
                          filteredModels.map((m) => {
                            const isSelected = providerConfig.model === m.id;
                            const ctxTokens = m.contextLength || resolveModelContextWindow(m.id);
                            return (
                              <button
                                key={m.id}
                                type="button"
                                onClick={() => {
                                  onSelectModel(m.id);
                                  setShowModelMenu(false);
                                }}
                                className={[
                                  'w-full text-left px-2.5 py-1.5 rounded-xl transition-all flex flex-col gap-0.5',
                                  isSelected
                                    ? 'bg-[var(--accent)] text-white shadow-sm font-semibold'
                                    : 'hover:bg-black/5 text-[var(--foreground)]',
                                ].join(' ')}
                              >
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-1.5 truncate">
                                    <span className="font-mono text-xs">{m.label}</span>
                                    {m.isFree && (
                                      <span
                                        className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded border ${
                                          isSelected
                                            ? 'bg-white/20 text-white border-white/40'
                                            : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                                        }`}
                                      >
                                        free
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    <span
                                      className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                                        isSelected ? 'bg-white/20 text-white' : 'bg-black/5 opacity-70'
                                      }`}
                                    >
                                      {formatTokens(ctxTokens)}
                                    </span>
                                    {isSelected && <Check size={13} />}
                                  </div>
                                </div>
                                <span
                                  className={`text-[10px] leading-tight ${
                                    isSelected ? 'text-white/85' : 'opacity-70'
                                  }`}
                                >
                                  {m.description}
                                </span>
                              </button>
                            );
                          })
                        ) : (
                          <div className="p-3 text-center text-xs opacity-60">
                            {modelSearchQuery
                              ? `「${modelSearchQuery}」に一致するモデルが見つかりません。`
                              : `${providerConfig.provider} の利用可能モデルがありません。設定 (⚙) または /key でAPIキーを設定してください。`}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Microphone Voice Button matching reference image */}
                <button
                  type="button"
                  onClick={handleToggleVoice}
                  className={[
                    'p-2 rounded-full transition-all flex items-center justify-center',
                    isListening
                      ? 'text-[var(--warm-error)] bg-red-100 animate-pulse border border-[var(--warm-error)]'
                      : 'text-[var(--foreground)]/75 hover:bg-black/5 hover:scale-105',
                  ].join(' ')}
                  title={isListening ? '音声認識中... クリックで停止' : '音声入力 (マイク)'}
                >
                  <Mic size={18} />
                </button>

                {/* Stop or Send Button */}
                {isAgentRunning ? (
                  <button
                    type="button"
                    onClick={onCancelTask}
                    className="px-4 py-2 rounded-2xl bg-[var(--warm-error)] text-white hover:brightness-110 active:scale-95 transition-all shadow-md flex items-center justify-center"
                    title="タスクを中断"
                  >
                    <Square size={16} fill="white" />
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={!inputText.trim()}
                    className="px-4 py-2 rounded-2xl bg-[#af734a] text-white hover:brightness-105 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-md flex items-center justify-center"
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
