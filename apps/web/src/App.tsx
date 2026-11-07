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
  ScrollText,
} from 'lucide-react';
import {
  Session,
  Message,
  PlanState,
  SubagentTrace,
  PermissionRequest,
  ProviderConfig,
  PermissionPolicyConfig,
  WebToolCall,
} from './types';
import type { AgentEvent } from '@melonpan/core';
import { resolveModelContextWindow, formatTokens } from '@melonpan/core';
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
import { AuditLogViewer } from './components/AuditLogViewer';
import { PermissionModal } from './components/PermissionModal';
import { SettingsModal } from './components/SettingsModal';
import { KioskOverlay } from './components/KioskOverlay';

import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Analytics } from '@vercel/analytics/react';
import {
  AgeProvider,
  PasskeyAuthGate,
  KioskWizardPage,
  GenerationStatusPage,
  PublicGalleryPage,
  AdminPanelPage,
} from './modules/kosen';
import { webCommandRegistry, WebCommandContext } from './services/command-registry';
import {
  getStoredApiKeys,
  saveStoredApiKey,
  loadWebDiscoveredModels,
  getWebDynamicModels,
  ALL_SUPPORTED_MODELS,
} from './services/provider-factory';

type RightTab = 'sandbox' | 'vfs' | 'plan' | 'subagents' | 'skills' | 'context' | 'gallery' | 'logs';

export function WebIdeWorkspace() {
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

  const [providerConfig, setProviderConfig] = useState<ProviderConfig>(() => {
    const stored = getStoredApiKeys();
    return {
      provider: 'gemini',
      model: 'gemini-3.8-flash',
      apiKey: stored.gemini || '',
      baseUrl: '',
      thinkingEffort: 'medium',
      bridgeUrl: 'http://localhost:3001/api/agent',
    };
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

  // 動的モデルディスカバリー: 初期マウント時に保存済みAPIキーからモデルおよびコンテキスト長をAPI経由で取得
  useEffect(() => {
    loadWebDiscoveredModels().catch(() => {});
  }, []);

  const activeSession = sessions.find((s) => s.id === activeSessionId) || sessions[0];

  const updateActiveSession = (updater: (prev: Session) => Session) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === activeSession.id ? updater(s) : s))
    );
  };

  const handleSelectSession = (id: string) => {
    setActiveSessionIdState(id);
    setActiveSessionId(id);
    const targetSession = sessions.find((s) => s.id === id);
    if (targetSession?.metrics?.activeModel) {
      setProviderConfig((prev) => ({
        ...prev,
        model: targetSession.metrics.activeModel!,
      }));
    }
  };

  const handleNewSession = () => {
    const newSession = createInitialSession(
      `新しいゲーム開発 #${sessions.length + 1}`,
      providerConfig.model
    );
    setSessions((prev) => [newSession, ...prev]);
    setActiveSessionIdState(newSession.id);
    setActiveSessionId(newSession.id);
  };

  const handleDeleteSession = (id: string) => {
    const remaining = sessions.filter((s) => s.id !== id);
    if (remaining.length === 0) {
      const fresh = createInitialSession('はじめてのメロンパンゲーム', providerConfig.model);
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

  const handleChangeMode = (mode: 'auto' | 'plan' | 'act' | 'goal') => {
    updateActiveSession((prev) => ({ ...prev, mode }));
    if (mode === 'plan') {
      setActiveRightTab('plan');
    }
  };

  const handleSendMessage = async (text: string, overrideMode?: 'plan' | 'act' | 'auto' | 'goal') => {
    if (!text.trim() || isAgentRunning) return;

    const trimmed = text.trim();

    // Slash command interception
    if (trimmed.startsWith('/') && !overrideMode) {
      // Append user command message to chat
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

      const commandCtx: WebCommandContext = {
        session: activeSession,
        providerConfig,
        permissionPolicy,
        setProviderConfig,
        setPermissionPolicy,
        updateActiveSession,
        executePrompt: (prompt, mode) => {
          handleSendMessage(prompt, mode);
        },
        refreshModels: async () => {
          await loadWebDiscoveredModels();
        },
        logMessage: (content, thought) => {
          updateActiveSession((prev) => ({
            ...prev,
            messages: [
              ...prev.messages,
              {
                id: `cmd_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
                role: 'assistant',
                content,
                thought,
                timestamp: Date.now(),
              },
            ],
            updatedAt: Date.now(),
          }));
        },
      };

      const isHandled = await webCommandRegistry.executeCommand(trimmed, commandCtx);
      if (isHandled) {
        return;
      }
    }

    const userMsg: Message = {
      id: `usr_${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };

    const targetSession = {
      ...activeSession,
      mode: overrideMode || activeSession.mode,
      messages: [...activeSession.messages, userMsg],
      updatedAt: Date.now(),
    };

    updateActiveSession((prev) => ({
      ...prev,
      mode: overrideMode || prev.mode,
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
            nextSubs[idx] = {
              ...nextSubs[idx],
              ...subagent,
              taskPrompt: subagent.taskPrompt || nextSubs[idx].taskPrompt,
              thoughts:
                subagent.thoughts && subagent.thoughts.length > 0
                  ? subagent.thoughts
                  : nextSubs[idx].thoughts,
            };
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
      onEvent: (event: AgentEvent) => {
        updateActiveSession((prev) => ({
          ...prev,
          events: [...(prev.events || []), event],
        }));
      },
    };

    try {
      await agentRuntime.executeTurn(text, targetSession, providerConfig, callbacks);
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
    const commandCtx: WebCommandContext = {
      session: activeSession,
      providerConfig,
      permissionPolicy,
      setProviderConfig,
      setPermissionPolicy,
      updateActiveSession,
      executePrompt: (prompt, mode) => {
        handleSendMessage(prompt, mode);
      },
      refreshModels: async () => {
        await loadWebDiscoveredModels();
      },
      logMessage: (content, thought) => {
        updateActiveSession((prev) => ({
          ...prev,
          messages: [
            ...prev.messages,
            {
              id: `cmd_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
              role: 'assistant',
              content,
              thought,
              timestamp: Date.now(),
            },
          ],
          updatedAt: Date.now(),
        }));
      },
    };
    webCommandRegistry.executeCommand('/compact', commandCtx);
  };

  const currentHtml = activeSession.files['index.html'] || '';
  const lastThought = activeSession.messages[activeSession.messages.length - 1]?.thought;

  const resolvedMaxContext =
    activeSession.metrics?.contextWindowLimit && activeSession.metrics.contextWindowLimit > 0
      ? activeSession.metrics.contextWindowLimit
      : resolveModelContextWindow(providerConfig.model);
  const currentCtx = activeSession.metrics?.currentContextTokens || 0;
  const ctxPercent =
    resolvedMaxContext > 0
      ? Math.min(100, Math.round((currentCtx / resolvedMaxContext) * 100))
      : 0;

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
          theme={theme}
          onToggleTheme={() => setTheme(theme === 'light' ? 'dark' : 'light')}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onOpenKiosk={() => setIsKioskOpen(true)}
          onCloseSidebar={() => setIsSidebarOpen(false)}
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
            <span
              className="hidden lg:inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[var(--background)] border border-[var(--stroke)]/40 text-[11px] font-mono opacity-80"
              title={`Context Window: ${currentCtx.toLocaleString()} / ${resolvedMaxContext.toLocaleString()} tokens (${ctxPercent}%)`}
            >
              <Gauge size={12} className="text-[var(--accent)]" />
              <span>
                Ctx: {formatTokens(currentCtx)}/{formatTokens(resolvedMaxContext)} ({ctxPercent}%)
              </span>
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
              { id: 'logs', label: '実行ログ', icon: <ScrollText size={13} /> },
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
              onSelectModel={(model) => {
                const dynamic = getWebDynamicModels().find((m) => m.id === model);
                const staticModel = ALL_SUPPORTED_MODELS.find((m) => m.id === model);
                const targetProvider = dynamic?.provider || staticModel?.provider || providerConfig.provider;
                setProviderConfig((prev) => ({
                  ...prev,
                  model,
                  provider: targetProvider,
                }));
                const newLimit = dynamic?.contextLength || resolveModelContextWindow(model);
                updateActiveSession((prev) => ({
                  ...prev,
                  metrics: {
                    ...prev.metrics,
                    activeModel: model,
                    contextWindowLimit: newLimit,
                  },
                }));
              }}
              onSelectThinkingEffort={(effort) =>
                setProviderConfig((prev) => ({ ...prev, thinkingEffort: effort }))
              }
              sessionMode={
                permissionPolicy.command === 'deny'
                  ? 'strict'
                  : permissionPolicy.write === 'allow' && permissionPolicy.command === 'allow'
                  ? 'auto'
                  : 'ask'
              }
              onChangeMode={(mode) => {
                if (mode === 'auto') {
                  setPermissionPolicy({
                    read: 'allow',
                    write: 'allow',
                    command: 'allow',
                    web: 'allow',
                  });
                } else if (mode === 'strict') {
                  setPermissionPolicy({
                    read: 'allow',
                    write: 'ask',
                    command: 'deny',
                    web: 'allow',
                  });
                } else {
                  setPermissionPolicy({
                    read: 'allow',
                    write: 'ask',
                    command: 'ask',
                    web: 'allow',
                  });
                }
              }}
              onAttachFiles={(files) => {
                // Load attached files directly into session VFS
                updateActiveSession((prev) => {
                  const newFiles = { ...prev.files };
                  for (const f of files) {
                    newFiles[f.name] = f.content;
                  }
                  return {
                    ...prev,
                    files: newFiles,
                    activeFile: files[0]?.name || prev.activeFile,
                  };
                });
              }}
            />
          }
          right={
            <div className="h-full flex-1 flex flex-col overflow-hidden bg-[var(--card)]">
              {activeRightTab === 'sandbox' && (
                <SandboxViewer
                  htmlContent={currentHtml}
                  files={activeSession.files}
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
                  onUpdateTasks={(tasks) =>
                    updateActiveSession((prev) => ({
                      ...prev,
                      plan: prev.plan ? { ...prev.plan, tasks } : undefined,
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
              {activeRightTab === 'logs' && (
                <AuditLogViewer session={activeSession} />
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
        onSaveConfig={(newConfig) => {
          setProviderConfig(newConfig);
          if (newConfig.apiKey) {
            saveStoredApiKey(newConfig.provider, newConfig.apiKey);
          }
          loadWebDiscoveredModels().catch(() => {});
          const dynamic = getWebDynamicModels().find((m) => m.id === newConfig.model);
          const newLimit = dynamic?.contextLength || resolveModelContextWindow(newConfig.model);
          updateActiveSession((prev) => ({
            ...prev,
            metrics: {
              ...prev.metrics,
              activeModel: newConfig.model,
              contextWindowLimit: newLimit,
            },
          }));
        }}
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

export function App() {
  return (
    <AgeProvider>
      <BrowserRouter>
        <Routes>
          {/* Protected Routes: Passkey (WebAuthn) Required */}
          <Route
            path="/"
            element={
              <PasskeyAuthGate pageTitle="体験ブース（キオスク）" hideSessionIndicator>
                <KioskWizardPage />
              </PasskeyAuthGate>
            }
          />
          <Route
            path="/kiosk"
            element={
              <PasskeyAuthGate pageTitle="体験ブース（キオスク）" hideSessionIndicator>
                <KioskWizardPage />
              </PasskeyAuthGate>
            }
          />
          <Route
            path="/admin"
            element={
              <PasskeyAuthGate pageTitle="高専祭 管理者用パネル">
                <AdminPanelPage />
              </PasskeyAuthGate>
            }
          />
          <Route
            path="/ide"
            element={
              <PasskeyAuthGate pageTitle="Melonpan Web IDE">
                <WebIdeWorkspace />
              </PasskeyAuthGate>
            }
          />

          {/* Public Routes: Visitors on smartphones / No Auth Required */}
          <Route path="/status/:sessionId" element={<GenerationStatusPage />} />
          <Route path="/gallery" element={<PublicGalleryPage />} />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Analytics />
    </AgeProvider>
  );
}

