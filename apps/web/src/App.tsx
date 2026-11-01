import { useState, useEffect } from 'react';
import {
  Gamepad2,
  FolderCode,
  ListTodo,
  Bot,
  Sparkles,
  Gauge,
  Trophy,
  Menu,
} from 'lucide-react';
import {
  Session,
  Message,
  PlanState,
  SubagentTrace,
  PermissionRequest,
  ProviderConfig,
  PermissionPolicyConfig,
} from './types';
import {
  loadSessions,
  saveSessions,
  getActiveSessionId,
  setActiveSessionId,
  createInitialSession,
} from './services/session-storage';
import { agentRuntime } from './services/agent-runtime';
import { HandDrawnFilter } from './components/HandDrawnFilter';
import { Sidebar } from './components/Sidebar';
import { SplitPane } from './components/SplitPane';
import { ChatTimeline } from './components/ChatTimeline';
import { SandboxViewer } from './components/SandboxViewer';
import { VfsExplorer } from './components/VfsExplorer';
import { PlanWorkbench } from './components/PlanWorkbench';
import { SubagentTree } from './components/SubagentTree';
import { SkillInspector } from './components/SkillInspector';
import { ContextGauge } from './components/ContextGauge';
import { ArtifactGallery } from './components/ArtifactGallery';
import { PermissionModal } from './components/PermissionModal';
import { SettingsModal } from './components/SettingsModal';
import { KioskOverlay } from './components/KioskOverlay';

type RightTab = 'sandbox' | 'vfs' | 'plan' | 'subagents' | 'skills' | 'context' | 'gallery';

export function App() {
  const [sessions, setSessions] = useState<Session[]>(() => loadSessions());
  const [activeSessionId, setActiveSessionIdState] = useState<string | null>(() => {
    const saved = getActiveSessionId();
    return saved || (sessions.length > 0 ? sessions[0].id : null);
  });
  const [activeRightTab, setActiveRightTab] = useState<RightTab>('sandbox');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isPermissionSettingsOpen, setIsPermissionSettingsOpen] = useState(false);
  const [isKioskOpen, setIsKioskOpen] = useState(false);
  const [pendingPermission, setPendingPermission] = useState<PermissionRequest | null>(null);
  const [isAgentRunning, setIsAgentRunning] = useState(false);

  const [providerConfig, setProviderConfig] = useState<ProviderConfig>({
    provider: 'simulation',
    model: 'gemini-2.5-flash',
    apiKey: '',
    baseUrl: '',
    thinkingEffort: 'medium',
    bridgeUrl: 'http://localhost:3001/api/agent',
  });

  const [permissionPolicy, setPermissionPolicy] = useState<PermissionPolicyConfig>({
    read: 'allow',
    write: 'ask',
    command: 'ask',
    web: 'allow',
  });

  // Keep theme attribute on <html>
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Save sessions to localStorage on changes
  useEffect(() => {
    if (sessions.length > 0) {
      saveSessions(sessions);
    }
  }, [sessions]);

  const activeSession = sessions.find((s) => s.id === activeSessionId) || sessions[0];

  const updateActiveSession = (updater: (prev: Session) => Session) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === activeSession.id ? updater(s) : s))
    );
  };

  const handleSelectSession = (id: string) => {
    setActiveSessionIdState(id);
    setActiveSessionId(id);
  };

  const handleNewSession = () => {
    const newSession = createInitialSession(`新しいゲーム開発 #${sessions.length + 1}`);
    setSessions((prev) => [newSession, ...prev]);
    setActiveSessionIdState(newSession.id);
    setActiveSessionId(newSession.id);
  };

  const handleDeleteSession = (id: string) => {
    const remaining = sessions.filter((s) => s.id !== id);
    if (remaining.length === 0) {
      const fresh = createInitialSession('はじめてのメロンパンゲーム');
      setSessions([fresh]);
      setActiveSessionIdState(fresh.id);
      setActiveSessionId(fresh.id);
    } else {
      setSessions(remaining);
      if (activeSessionId === id) {
        setActiveSessionIdState(remaining[0].id);
        setActiveSessionId(remaining[0].id);
      }
    }
  };

  const handleRenameSession = (id: string, newName: string) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, name: newName, updatedAt: Date.now() } : s))
    );
  };

  const handleChangeMode = (mode: 'auto' | 'plan' | 'act') => {
    updateActiveSession((prev) => ({ ...prev, mode }));
    if (mode === 'plan') {
      setActiveRightTab('plan');
    }
  };

  const handleSendMessage = async (text: string) => {
    if (!text.trim() || isAgentRunning) return;

    // Check if user entered /compact command
    if (text.trim() === '/compact') {
      handleManualCompact();
      return;
    }

    const userMsg: Message = {
      id: `usr_${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };

    updateActiveSession((prev) => ({
      ...prev,
      messages: [...prev.messages, userMsg],
      updatedAt: Date.now(),
    }));

    setIsAgentRunning(true);
    agentRuntime.setPermissionPolicy(permissionPolicy);

    const callbacks = {
      onMessageUpdate: (updatedMsg: Message) => {
        updateActiveSession((prev) => {
          const idx = prev.messages.findIndex((m) => m.id === updatedMsg.id);
          if (idx >= 0) {
            const nextMsgs = [...prev.messages];
            nextMsgs[idx] = updatedMsg;
            return { ...prev, messages: nextMsgs };
          } else {
            return { ...prev, messages: [...prev.messages, updatedMsg] };
          }
        });
      },
      onToolCallUpdate: () => {},
      onFileChange: (path: string, content: string) => {
        updateActiveSession((prev) => ({
          ...prev,
          files: { ...prev.files, [path]: content },
          activeFile: path,
        }));
      },
      onPlanUpdate: (plan: PlanState) => {
        updateActiveSession((prev) => ({ ...prev, plan }));
        setActiveRightTab('plan');
      },
      onSubagentUpdate: (subagent: SubagentTrace) => {
        updateActiveSession((prev) => {
          const idx = prev.subagents.findIndex((s) => s.id === subagent.id);
          if (idx >= 0) {
            const nextSubs = [...prev.subagents];
            nextSubs[idx] = subagent;
            return { ...prev, subagents: nextSubs };
          } else {
            return { ...prev, subagents: [...prev.subagents, subagent] };
          }
        });
      },
      onPermissionRequest: (req: PermissionRequest) => {
        setPendingPermission(req);
      },
      onMetricsUpdate: (updater: any) => {
        updateActiveSession((prev) => ({
          ...prev,
          metrics: updater(prev.metrics),
        }));
      },
    };

    try {
      await agentRuntime.executeTurn(text, activeSession, providerConfig, callbacks);
    } finally {
      setIsAgentRunning(false);
    }
  };

  const handleCancelTask = () => {
    agentRuntime.cancelCurrentTask();
    setIsAgentRunning(false);
  };

  const handleFixError = (errorDetails: string) => {
    handleSendMessage(`【実行時エラー自己修復リクエスト】\n${errorDetails}\n\n原因を分析し、index.html のエラー箇所を修正してください。`);
  };

  const handleApprovePlan = () => {
    if (!activeSession.plan) return;
    updateActiveSession((prev) => ({
      ...prev,
      plan: prev.plan ? { ...prev.plan, status: 'approved' } : undefined,
    }));
    setActiveRightTab('sandbox');
    handleSendMessage('計画書を承認しました。この計画に沿って実装を進めてください！');
  };

  const handleRejectPlan = () => {
    updateActiveSession((prev) => ({
      ...prev,
      plan: prev.plan ? { ...prev.plan, status: 'rejected' } : undefined,
    }));
    handleSendMessage('この計画書は却下します。別の設計方針を提案してください。');
  };

  const handleRequestRevision = (feedback: string) => {
    handleSendMessage(`計画書の修正指示:\n${feedback}`);
  };

  const handleManualCompact = () => {
    updateActiveSession((prev) => ({
      ...prev,
      metrics: {
        ...prev.metrics,
        currentContextTokens: Math.max(1200, Math.round(prev.metrics.currentContextTokens * 0.45)),
        prunedChars: prev.metrics.prunedChars + 8400,
        compactionCount: prev.metrics.compactionCount + 1,
        compactionLogs: [
          `[${new Date().toLocaleTimeString()}] 手動 /compact 実行: コンテキスト要約により 8,400 文字を削減`,
          ...prev.metrics.compactionLogs,
        ],
      },
      messages: [
        ...prev.messages,
        {
          id: `compact_${Date.now()}`,
          role: 'system',
          content: '✨ コンテキストを要約・圧縮しました。過去の重要なゲーム設計メモを保持しつつ、Context Windowをリフレッシュしました。',
          timestamp: Date.now(),
        },
      ],
    }));
  };

  const currentHtml = activeSession.files['index.html'] || '';
  const lastThought = activeSession.messages[activeSession.messages.length - 1]?.thought;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--background)] text-[var(--foreground)] font-sans antialiased">
      {/* SVG Hand-Drawn Filter */}
      <HandDrawnFilter />

      {/* Left Sidebar */}
      {isSidebarOpen && (
        <Sidebar
          sessions={sessions}
          activeSessionId={activeSession.id}
          onSelectSession={handleSelectSession}
          onNewSession={handleNewSession}
          onDeleteSession={handleDeleteSession}
          onRenameSession={handleRenameSession}
          sessionMode={activeSession.mode}
          onChangeMode={handleChangeMode}
          theme={theme}
          onToggleTheme={() => setTheme(theme === 'light' ? 'dark' : 'light')}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onOpenKiosk={() => setIsKioskOpen(true)}
        />
      )}

      {/* Main Workspace */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Top Header Navigation */}
        <header className="h-14 px-4 bg-[var(--card)] border-b-2 border-[var(--stroke)] flex items-center justify-between select-none shrink-0 z-10">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="p-1.5 rounded-xl border border-[var(--stroke)]/40 hover:bg-black/5"
              title="サイドバー切り替え"
            >
              <Menu size={16} />
            </button>
            <span className="font-bold text-sm tracking-wide flex items-center gap-1.5">
              <span>🍈</span>
              <span>Melonpan Web IDE</span>
            </span>
            <span className="hidden sm:inline-block px-2 py-0.5 rounded-full bg-[var(--background)] border border-[var(--stroke)]/40 text-[11px] font-mono opacity-80">
              {activeSession.name}
            </span>
          </div>

          {/* Right Tabs Switcher */}
          <div className="flex items-center gap-1 overflow-x-auto py-1">
            {[
              { id: 'sandbox', label: 'プレビュー', icon: <Gamepad2 size={13} /> },
              { id: 'vfs', label: 'VFS/差分', icon: <FolderCode size={13} /> },
              { id: 'plan', label: '計画モード', icon: <ListTodo size={13} /> },
              { id: 'subagents', label: 'サブエージェント', icon: <Bot size={13} /> },
              { id: 'skills', label: 'スキル', icon: <Sparkles size={13} /> },
              { id: 'context', label: '燃費/ゲージ', icon: <Gauge size={13} /> },
              { id: 'gallery', label: 'ギャラリー', icon: <Trophy size={13} /> },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveRightTab(tab.id as RightTab)}
                className={[
                  'px-2.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1 transition-all',
                  activeRightTab === tab.id
                    ? 'bg-[var(--accent)] text-white shadow-sm'
                    : 'hover:bg-black/5 text-[var(--foreground)] opacity-70',
                ].join(' ')}
              >
                {tab.icon}
                <span className="hidden md:inline">{tab.label}</span>
              </button>
            ))}
          </div>
        </header>

        {/* Split-Pane: Left Chat / Right Workspace */}
        <SplitPane
          initialRatio={0.46}
          left={
            <ChatTimeline
              messages={activeSession.messages}
              isAgentRunning={isAgentRunning}
              onSendMessage={handleSendMessage}
              onCancelTask={handleCancelTask}
              providerConfig={providerConfig}
              onSelectProvider={(p) =>
                setProviderConfig((prev) => ({ ...prev, provider: p }))
              }
              onOpenPresetModal={() => setIsKioskOpen(true)}
            />
          }
          right={
            <div className="h-full flex-1 flex flex-col overflow-hidden bg-[var(--card)]">
              {activeRightTab === 'sandbox' && (
                <SandboxViewer
                  htmlContent={currentHtml}
                  onFixError={handleFixError}
                />
              )}
              {activeRightTab === 'vfs' && (
                <VfsExplorer
                  files={activeSession.files}
                  activeFile={activeSession.activeFile}
                  onSelectFile={(path) =>
                    updateActiveSession((prev) => ({ ...prev, activeFile: path }))
                  }
                />
              )}
              {activeRightTab === 'plan' && (
                <PlanWorkbench
                  plan={activeSession.plan}
                  onApprove={handleApprovePlan}
                  onReject={handleRejectPlan}
                  onRequestRevision={handleRequestRevision}
                  onUpdatePlanMarkdown={(md) =>
                    updateActiveSession((prev) => ({
                      ...prev,
                      plan: prev.plan ? { ...prev.plan, rawMarkdown: md } : undefined,
                    }))
                  }
                />
              )}
              {activeRightTab === 'subagents' && (
                <SubagentTree subagents={activeSession.subagents} />
              )}
              {activeRightTab === 'skills' && <SkillInspector />}
              {activeRightTab === 'context' && (
                <ContextGauge
                  metrics={activeSession.metrics}
                  onManualCompact={handleManualCompact}
                />
              )}
              {activeRightTab === 'gallery' && (
                <ArtifactGallery
                  files={activeSession.files}
                  onPlayGame={(html) => {
                    updateActiveSession((prev) => ({
                      ...prev,
                      files: { ...prev.files, 'index.html': html },
                    }));
                    setActiveRightTab('sandbox');
                  }}
                />
              )}
            </div>
          }
        />
      </div>

      {/* Permission Approval Modal & Settings */}
      <PermissionModal
        request={pendingPermission}
        policy={permissionPolicy}
        onUpdatePolicy={(p) => {
          setPermissionPolicy(p);
          agentRuntime.setPermissionPolicy(p);
        }}
        isOpenSettings={isPermissionSettingsOpen}
        onCloseSettings={() => setIsPermissionSettingsOpen(false)}
      />

      {/* Provider & LLM Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        config={providerConfig}
        onSaveConfig={setProviderConfig}
      />

      {/* Kiosk Mode & Presets Overlay */}
      <KioskOverlay
        isOpen={isKioskOpen}
        onClose={() => setIsKioskOpen(false)}
        onSelectPrompt={handleSendMessage}
        currentThought={lastThought}
        isStreaming={isAgentRunning}
      />
    </div>
  );
}
