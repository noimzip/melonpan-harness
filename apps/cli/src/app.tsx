import React, { useState, useEffect, useRef } from 'react';
import { Box, Text } from 'ink';
import {
  MelonpanCore,
  AgentEvent,
  VirtualFS,
  LocalDiskFS,
  IFileSystem,
  SkillManager,
  RuleBasedPermissionPolicy,
  PermissionDecision,
  PermissionRequestedPayload,
  ILLMProvider,
  GeminiProvider,
  OpenAICompatibleProvider,
} from '@melonpan/core';
import { Header } from './components/header.js';
import { EventList } from './components/event-list.js';
import { PlanViewer } from './components/plan-viewer.js';
import { InputBar } from './components/input-bar.js';
import { ModalPicker, PickerItem } from './components/modal-picker.js';
import { CommandContext, SessionUsage } from './commands/types.js';
import { commandRegistry, extendedCommandRegistry } from './commands/registry.js';

function createProviderInstance(
  providerId: string,
  modelName: string,
  apiKey?: string
): ILLMProvider | undefined {
  if (providerId === 'openai' || modelName.startsWith('gpt-') || modelName.startsWith('o3-')) {
    const key = (typeof process !== 'undefined' ? process.env?.OPENAI_API_KEY : '') || apiKey || '';
    return new OpenAICompatibleProvider({
      id: 'openai',
      baseUrl: (typeof process !== 'undefined' ? process.env?.OPENAI_BASE_URL : '') || 'https://api.openai.com/v1',
      apiKey: key,
    });
  }
  if (providerId === 'anthropic' || modelName.startsWith('claude-')) {
    const key = (typeof process !== 'undefined' ? process.env?.ANTHROPIC_API_KEY : '') || apiKey || '';
    return new OpenAICompatibleProvider({
      id: 'anthropic',
      baseUrl: (typeof process !== 'undefined' ? process.env?.ANTHROPIC_BASE_URL : '') || 'https://api.anthropic.com/v1',
      apiKey: key,
    });
  }
  if (providerId === 'gemini' || modelName.startsWith('gemini') || modelName.startsWith('gemma')) {
    const key = apiKey || (typeof process !== 'undefined' ? process.env?.GEMINI_API_KEY : '') || '';
    return new GeminiProvider({
      apiKey: key,
      useStreamingApi: true,
    });
  }
  return undefined;
}

export interface AppProps {
  initialPrompt?: string;
  initialMode?: 'auto' | 'plan' | 'act';
  model?: string;
  provider?: string;
  initialEffort?: string;
  initialApiKey?: string;
  outDir?: string;
  simulate?: boolean;
  maxTurns?: number;
  fsMode?: 'vfs' | 'disk';
}

const MODEL_ITEMS: PickerItem[] = [
  // Google Gemini
  {
    id: 'gemini-3.8-flash',
    label: 'gemini-3.8-flash',
    description: 'Flagship high-speed multimodality & reasoning (default)',
    group: 'Google Gemini',
    providerId: 'gemini',
  },
  {
    id: 'gemini-4-argon',
    label: 'gemini-4-argon',
    description: 'Next-generation frontier reasoning model',
    group: 'Google Gemini',
    providerId: 'gemini',
  },
  {
    id: 'gemini-3.5-flash-lite',
    label: 'gemini-3.5-flash-lite',
    description: 'Ultra-lightweight & fast response model',
    group: 'Google Gemini',
    providerId: 'gemini',
  },
  {
    id: 'gemma-4-31b-it',
    label: 'gemma-4-31b-it',
    description: 'Open weights 31B instruction-tuned model',
    group: 'Google Gemini',
    providerId: 'gemini',
  },
  // OpenAI & Local LLM
  {
    id: 'gpt-4o',
    label: 'gpt-4o',
    description: 'OpenAI flagship multimodal intelligence model',
    group: 'OpenAI & Local LLM',
    providerId: 'openai',
  },
  {
    id: 'gpt-4o-mini',
    label: 'gpt-4o-mini',
    description: 'Fast, cost-efficient small model (OpenAI)',
    group: 'OpenAI & Local LLM',
    providerId: 'openai',
  },
  {
    id: 'o3-mini',
    label: 'o3-mini',
    description: 'High-reasoning math and coding model (OpenAI)',
    group: 'OpenAI & Local LLM',
    providerId: 'openai',
  },
  // Anthropic
  {
    id: 'claude-3-7-sonnet',
    label: 'claude-3-7-sonnet',
    description: 'Hybrid reasoning and coding model (Anthropic)',
    group: 'Anthropic',
    providerId: 'anthropic',
  },
  {
    id: 'claude-3-5-haiku',
    label: 'claude-3-5-haiku',
    description: 'Lightning-fast concise model (Anthropic)',
    group: 'Anthropic',
    providerId: 'anthropic',
  },
];

const EFFORT_ITEMS: PickerItem[] = [
  {
    id: 'minimal',
    label: 'minimal',
    description: 'Minimal thinking tokens (fastest execution)',
  },
  {
    id: 'low',
    label: 'low',
    description: 'Low reasoning effort (concise thoughts)',
  },
  {
    id: 'medium',
    label: 'medium',
    description: 'Medium reasoning effort (balanced exploration)',
  },
  {
    id: 'high',
    label: 'high',
    description: 'High reasoning effort (deep architectural reasoning, default)',
  },
];

export const App: React.FC<AppProps> = ({
  initialPrompt,
  initialMode = 'auto',
  model: defaultModel = 'gemini-3.8-flash',
  provider: defaultProvider = 'gemini',
  initialEffort = 'high',
  initialApiKey,
  outDir = process.cwd(),
  simulate,
  maxTurns = 100,
  fsMode = 'vfs',
}) => {
  const [status, setStatus] = useState<
    | 'idle'
    | 'running'
    | 'confirming'
    | 'completed'
    | 'error'
    | 'awaiting_permission'
  >('idle');
  const [mode, setMode] = useState<'auto' | 'plan' | 'act'>(initialMode);
  const [model, setModel] = useState<string>(defaultModel);
  const [provider, setProvider] = useState<string>(defaultProvider);
  const [thinkingLevel, setThinkingLevel] = useState<string>(initialEffort);
  const [activePicker, setActivePicker] = useState<'none' | 'model' | 'effort'>(
    'none'
  );

  const initialKey =
    initialApiKey ||
    (typeof process !== 'undefined' ? process.env?.GEMINI_API_KEY || '' : '');
  const [apiKey, setApiKey] = useState<string>(initialKey);
  const [isSimulate, setIsSimulate] = useState<boolean>(
    simulate !== undefined ? simulate : !Boolean(initialKey)
  );

  const [inputPrompt, setInputPrompt] = useState<string>('');
  const [activePrompt, setActivePrompt] = useState<string>('');
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [currentActivity, setCurrentActivity] = useState<string>('Ready');
  const [planContent, setPlanContent] = useState<string>('');
  const [isPlanConfirmed, setIsPlanConfirmed] = useState<boolean | undefined>(
    undefined
  );
  const [turns, setTurns] = useState<number>(0);
  const [virtualFiles, setVirtualFiles] = useState<Record<string, string>>({});

  // Real-time token streaming states (#37)
  const [streamingThought, setStreamingThought] = useState<string>('');
  const [streamingText, setStreamingText] = useState<string>('');

  // Interactive permission prompt state (#33)
  const [pendingPermission, setPendingPermission] = useState<
    PermissionRequestedPayload | undefined
  >(undefined);

  // Cumulative token usage across the session & Context Window (#36)
  const [sessionUsage, setSessionUsage] = useState<SessionUsage>({
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    contextWindowTokens: 0,
    maxContextTokens: 128_000,
    savedTokens: 0,
  });

  // Long-lived Core refs & File System (#32, #33, #35, #39)
  const fsRef = useRef<IFileSystem>(
    fsMode === 'disk' ? new LocalDiskFS({ rootDir: outDir }) : new VirtualFS()
  );
  const skillManagerRef = useRef<SkillManager>(new SkillManager({ fs: fsRef.current }));
  const permissionPolicyRef = useRef<RuleBasedPermissionPolicy>(
    new RuleBasedPermissionPolicy()
  );
  const coreRef = useRef<MelonpanCore | null>(null);
  const isRunningRef = useRef<boolean>(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Initialize or obtain Core instance
  const getOrCreateCore = (currentRunMode: 'auto' | 'plan' | 'act'): MelonpanCore => {
    const currentProvider = isSimulate
      ? undefined
      : createProviderInstance(provider, model, apiKey);

    if (!coreRef.current) {
      coreRef.current = new MelonpanCore({
        apiKey: apiKey || undefined,
        model,
        provider: currentProvider,
        thinkingLevel,
        mode: currentRunMode,
        simulate: isSimulate,
        maxTurns,
        vfs: fsRef.current,
        skillManager: skillManagerRef.current,
        permissionPolicy: permissionPolicyRef.current,
        enableStreaming: true,
      });
    } else {
      coreRef.current.getAgent().setModel(model, thinkingLevel);
      coreRef.current.getAgent().setMode(currentRunMode);
      coreRef.current.getAgent().setProvider(currentProvider);
      coreRef.current.getSession().setMode(currentRunMode);
    }
    return coreRef.current;
  };

  // Pre-load skills index on mount
  useEffect(() => {
    skillManagerRef.current.loadAllMetadata().catch(() => {});
  }, []);

  // Run the core agent loop for a given prompt and mode (#5, #9, #35, #37, #39)
  const executeAgent = async (
    promptToRun: string,
    currentRunMode: 'auto' | 'plan' | 'act'
  ) => {
    if (isRunningRef.current) return;
    isRunningRef.current = true;

    setStatus('running');
    setActivePrompt(promptToRun);
    setCurrentActivity('Initializing Melonpan agent...');
    setStreamingThought('');
    setStreamingText('');

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    let hasError = false; // #5: Prevent stale closure bug

    try {
      const core = getOrCreateCore(currentRunMode);
      let turnCounter = 0;

      for await (const event of core.run(promptToRun, {
        mode: currentRunMode,
        signal: abortController.signal,
      })) {
        setEvents((prev) => [...prev, event]);

        switch (event.type) {
          case 'SKILL_INDEXED':
            setCurrentActivity(`Indexed ${event.payload.count} skills`);
            break;

          case 'SKILL_LOADED':
            setCurrentActivity(`Loaded skill [${event.payload.name}]`);
            break;

          case 'PLAN_STARTED':
            setCurrentActivity(`Planning architecture & specs...`);
            break;

          case 'PLAN_CREATED':
            setPlanContent(event.payload.plan);
            setIsPlanConfirmed(undefined);
            setCurrentActivity(`Plan specification generated`);
            break;

          case 'THOUGHT':
            setStreamingThought('');
            setCurrentActivity(
              `Thinking: ${event.payload.thought.slice(0, 60)}...`
            );
            break;

          case 'THOUGHT_DELTA': // #37: Token streaming
            setStreamingThought((prev) => prev + event.payload.delta);
            break;

          case 'TEXT_DELTA': // #37: Token streaming
            setStreamingText((prev) => prev + event.payload.delta);
            break;

          case 'TOOL_CALL':
            turnCounter++;
            setTurns((prev) => prev + 1);
            setStreamingThought('');
            setCurrentActivity(`Action: ${event.payload.name}`);
            break;

          case 'PERMISSION_REQUESTED': // #33: Interactive permission prompt
            setStatus('awaiting_permission');
            setPendingPermission(event.payload);
            setCurrentActivity(
              `Approval required for [${event.payload.toolName}]`
            );
            break;

          case 'PERMISSION_RESOLVED':
            setPendingPermission(undefined);
            if (status === 'awaiting_permission') {
              setStatus('running');
            }
            break;

          case 'SUBAGENT_DISPATCHED': // #34: Live subagent tree
            setCurrentActivity(
              `Delegating to [${event.payload.agentType}] sub-agent...`
            );
            break;

          case 'SUBAGENT_COMPLETED':
            setCurrentActivity(
              `Sub-agent [${event.payload.agentType}] returned findings`
            );
            break;

          case 'FILE_CHANGED':
            setCurrentActivity(
              `VFS ${event.payload.action}: ${event.payload.path}`
            );
            break;

          case 'CONTEXT_COMPACTED': // #35: Auto-compaction event
            setCurrentActivity(
              `Context compacted (${event.payload.savedTokens} tokens saved)`
            );
            setSessionUsage((prev) => ({
              ...prev,
              savedTokens: (prev.savedTokens || 0) + event.payload.savedTokens,
            }));
            break;

          case 'COMPLETE':
            setVirtualFiles(event.payload.files);
            setStreamingThought('');
            setStreamingText('');

            // If task was aborted, transition cleanly to idle without celebrating or flushing
            if (event.payload.aborted || abortController.signal.aborted) {
              setStatus('idle');
              setCurrentActivity('Task execution cancelled by user.');
              isRunningRef.current = false;
              return;
            }

            // Accumulate token usage if provided (#36)
            if (event.payload.usage) {
              setSessionUsage((prev) => ({
                promptTokens: prev.promptTokens + (event.payload.usage.promptTokens || 0),
                completionTokens:
                  prev.completionTokens + (event.payload.usage.completionTokens || 0),
                totalTokens: prev.totalTokens + (event.payload.usage.totalTokens || 0),
                contextWindowTokens:
                  event.payload.usage.contextWindowTokens ?? prev.contextWindowTokens,
                maxContextTokens:
                  event.payload.usage.maxContextWindowTokens ?? prev.maxContextTokens,
                savedTokens: prev.savedTokens,
              }));
            }

            // #9: Only flush to disk if NOT in plan mode before approval!
            if (currentRunMode !== 'plan') {
              try {
                if (typeof (core.getFileSystem() as any).flushToDisk === 'function') {
                  await (core.getFileSystem() as any).flushToDisk(outDir);
                }
              } catch (diskErr: any) {
                setCurrentActivity(`Deliverables flush note: ${diskErr?.message || diskErr}`);
              }
            }

            if (currentRunMode === 'plan') {
              setStatus('confirming');
              setCurrentActivity('Plan generated. Waiting for confirmation...');
              isRunningRef.current = false;
              return;
            } else {
              setStatus('completed');
              setCurrentActivity(
                `Completed in ${event.payload.turns} turns (${event.payload.durationMs}ms)`
              );
            }
            break;

          case 'ERROR': // #5: Error handling
            hasError = true;
            setStatus('error');
            setCurrentActivity(
              `Error: ${event.payload.error?.message || event.payload.error}`
            );
            break;
        }
      }

      // #5: Only transition to completed if there were no errors
      if (currentRunMode !== 'plan' && !hasError && !abortController.signal.aborted) {
        setStatus('completed');
      }
    } catch (err: any) {
      if (abortController.signal.aborted) {
        setStatus('idle');
        setCurrentActivity('Task execution cancelled by user.');
        return;
      }
      hasError = true;
      setStatus('error');
      setCurrentActivity(`Runtime Error: ${err.message || String(err)}`);
    } finally {
      isRunningRef.current = false;
      abortControllerRef.current = null;
    }
  };

  // Reset conversation and session state (#35)
  const handleClearSession = () => {
    fsRef.current =
      fsMode === 'disk' ? new LocalDiskFS({ rootDir: outDir }) : new VirtualFS();
    coreRef.current = null;
    setEvents([]);
    setPlanContent('');
    setIsPlanConfirmed(undefined);
    setTurns(0);
    setVirtualFiles({});
    setStreamingThought('');
    setStreamingText('');
    setPendingPermission(undefined);
    setSessionUsage({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      contextWindowTokens: 0,
      maxContextTokens: 128_000,
      savedTokens: 0,
    });
    setCurrentActivity('Ready');
    setStatus('idle');
  };

  // Task cancellation via Esc (#39)
  const handleCancelTask = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setCurrentActivity('Cancelling task...');
    }
  };

  // Permission decision resolution (#33)
  const handlePermissionDecision = (decision: PermissionDecision) => {
    if (!pendingPermission || !coreRef.current) return;
    coreRef.current.resolvePermission(pendingPermission.requestId, decision);
    setPendingPermission(undefined);
    setStatus('running');
  };

  // Manual Context Compaction (#35)
  const handleCompactSession = async (_instructions?: string) => {
    const core = getOrCreateCore(mode);
    const session = core.getSession();
    const compacted = await session.compact({ force: true });
    if (compacted) {
      setEvents((prev) => [
        ...prev,
        {
          type: 'CONTEXT_COMPACTED',
          payload: compacted,
          timestamp: Date.now(),
        },
      ]);
      setSessionUsage((prev) => ({
        ...prev,
        contextWindowTokens: compacted.afterTokens,
        savedTokens: (prev.savedTokens || 0) + compacted.savedTokens,
      }));
    }
  };

  // Command execution context shared with slash command handlers
  const commandContext: CommandContext = {
    model,
    setModel: (m) => {
      setModel(m);
      if (coreRef.current) {
        coreRef.current.getAgent().setModel(m, thinkingLevel);
      }
    },
    provider,
    setProvider: (p) => {
      setProvider(p);
      if (coreRef.current) {
        const inst = isSimulate ? undefined : createProviderInstance(p, model, apiKey);
        coreRef.current.getAgent().setProvider(inst);
      }
    },
    effort: thinkingLevel,
    setEffort: (e) => {
      setThinkingLevel(e);
      if (coreRef.current) {
        coreRef.current.getAgent().setModel(model, e);
      }
    },
    mode,
    setMode,
    executePrompt: (promptText, overrideMode) => {
      const runMode = overrideMode || mode;
      // Multi-Turn conversation (#35): append user prompt, do not wipe past events!
      setEvents((prev) => [
        ...prev,
        {
          type: 'USER_PROMPT' as any,
          payload: { prompt: promptText },
          timestamp: Date.now(),
        },
      ]);
      executeAgent(promptText, runMode);
    },
    clearSession: handleClearSession,
    logActivity: (msg) => setCurrentActivity(msg),
    logThought: (msg) => {
      setEvents((prev) => [
        ...prev,
        {
          type: 'THOUGHT',
          payload: { thought: msg },
          timestamp: Date.now(),
        },
      ]);
    },
    openPicker: (type) => setActivePicker(type as any),
    vfs: fsRef.current as any,
    skillManager: skillManagerRef.current,
    core: coreRef.current || undefined,
    fsMode,
    sessionUsage,
    apiKey,
    setApiKey,
    isSimulate,
    setSimulate: setIsSimulate,
    permissionPolicy: permissionPolicyRef.current,
    compactSession: handleCompactSession,
    cancelTask: handleCancelTask,
  };

  // Submit prompt or handle slash commands (#35: continuous multi-turn)
  const handleSubmit = async (submittedText: string) => {
    const trimmed = submittedText.trim();
    if (!trimmed || isRunningRef.current) return;

    // Reset previous rejected plan state on new user prompt submission (#8)
    if (isPlanConfirmed === false) {
      setPlanContent('');
      setIsPlanConfirmed(undefined);
    }

    setInputPrompt('');

    // Check if user submitted a slash command
    if (trimmed.startsWith('/')) {
      const handled = await extendedCommandRegistry.executeCommand(
        trimmed,
        commandContext
      );
      if (handled) {
        return;
      }
    }

    // Append multi-turn user prompt event (#35)
    setEvents((prev) => [
      ...prev,
      {
        type: 'USER_PROMPT' as any,
        payload: { prompt: trimmed },
        timestamp: Date.now(),
      },
    ]);

    executeAgent(trimmed, mode);
  };

  // Handle [y/n] plan confirmation (#8, #9)
  const handleConfirmPlan = async (approved: boolean) => {
    if (approved) {
      setIsPlanConfirmed(true);
      // Flush plan.md to disk now that it is approved (#9)
      try {
        if (typeof (fsRef.current as any).flushToDisk === 'function') {
          await (fsRef.current as any).flushToDisk(outDir);
        }
      } catch {}
      setMode('act');
      executeAgent(
        `Implement project according to plan.md: ${activePrompt}`,
        'act'
      );
    } else {
      try {
        await fsRef.current.deleteFile?.('plan.md');
      } catch {}
      setIsPlanConfirmed(false);
      // Retain planContent so PlanViewer displays the REJECTED badge (#8)
      setStatus('idle');
      setCurrentActivity('Plan rejected. Ready for new prompt.');
    }
  };

  // Reset after error
  const handleReset = () => {
    setStatus('idle');
    setInputPrompt('');
    setCurrentActivity('Ready');
  };

  // Trigger initial prompt if provided
  useEffect(() => {
    if (initialPrompt && initialPrompt.trim().length > 0) {
      handleSubmit(initialPrompt);
    }
  }, []);

  return (
    <Box flexDirection="column" padding={1} width="100%">
      {/* 1. Header with Mode, Model, Provider, Effort, FS, Context Window Gauge (#32, #36, #38) */}
      <Header
        status={status}
        mode={mode}
        model={model}
        provider={provider}
        thinkingLevel={thinkingLevel}
        hasApiKey={Boolean(apiKey)}
        isSimulate={isSimulate}
        turns={turns}
        maxTurns={maxTurns}
        fsMode={fsMode}
        contextWindowTokens={sessionUsage.contextWindowTokens}
        maxContextTokens={sessionUsage.maxContextTokens}
      />

      {/* 2. Modal Picker (Active when /model or /effort is opened without args, #38) */}
      {activePicker === 'model' && (
        <ModalPicker
          title="Select Active Model & Provider (/model)"
          items={MODEL_ITEMS}
          selectedId={model}
          onSelect={(selectedModel, selectedItem) => {
            setModel(selectedModel);
            const targetProv = selectedItem.providerId || provider;
            if (selectedItem.providerId) {
              setProvider(selectedItem.providerId);
            }
            if (coreRef.current) {
              const nextProviderInst = isSimulate
                ? undefined
                : createProviderInstance(targetProv, selectedModel, apiKey);
              coreRef.current.getAgent().setModel(selectedModel, thinkingLevel);
              coreRef.current.getAgent().setProvider(nextProviderInst);
            }
            setActivePicker('none');
            setCurrentActivity(`Model switched to ${selectedModel}`);
            setEvents((prev) => [
              ...prev,
              {
                type: 'THOUGHT',
                payload: {
                  thought: `Switched active model to: ${selectedModel} (${selectedItem.providerId || 'gemini'})`,
                },
                timestamp: Date.now(),
              },
            ]);
          }}
          onCancel={() => setActivePicker('none')}
        />
      )}

      {activePicker === 'effort' && (
        <ModalPicker
          title="Select Thinking Level (/effort)"
          items={EFFORT_ITEMS}
          selectedId={thinkingLevel}
          onSelect={(selectedEffort) => {
            setThinkingLevel(selectedEffort);
            setActivePicker('none');
            setCurrentActivity(
              `Thinking level (effort) switched to ${selectedEffort}`
            );
            setEvents((prev) => [
              ...prev,
              {
                type: 'THOUGHT',
                payload: {
                  thought: `Switched thinking level (effort) to: ${selectedEffort}`,
                },
                timestamp: Date.now(),
              },
            ]);
          }}
          onCancel={() => setActivePicker('none')}
        />
      )}

      {/* 3. Plan Viewer with APPROVED / REJECTED / PENDING badge (#8) */}
      {planContent ? (
        <PlanViewer
          planContent={planContent}
          isConfirmed={isPlanConfirmed}
        />
      ) : null}

      {/* 4. Event List & Activity Stream with Scrollback, Telemetry & Streaming (#32, #34, #35, #37, #39) */}
      <EventList
        events={events}
        isRunning={status === 'running'}
        currentActivity={currentActivity}
        maxDisplay={10}
        streamingThought={streamingThought}
        streamingText={streamingText}
      />

      {/* 5. Input & Control Bar with Autocomplete, History, and Permission Prompt (#7, #33, #35, #39) */}
      <InputBar
        status={status}
        value={inputPrompt}
        isPickerActive={activePicker !== 'none'}
        commandContext={commandContext}
        pendingPermission={pendingPermission}
        onPermissionDecision={handlePermissionDecision}
        onCancelTask={handleCancelTask}
        onChange={setInputPrompt}
        onSubmit={handleSubmit}
        onConfirmPlan={handleConfirmPlan}
        onReset={handleReset}
      />

      {/* 6. Deliverables Saved to Disk (When completed) */}
      {status === 'completed' && Object.keys(virtualFiles).length > 0 && (
        <Box
          marginTop={1}
          borderStyle="single"
          borderColor="green"
          paddingX={1}
          flexDirection="column"
        >
          <Text bold color="green">
            💾 Deliverables ({Object.keys(virtualFiles).length} files):
          </Text>
          {Object.entries(virtualFiles).map(([filePath, content]) => (
            <Box key={filePath} justifyContent="space-between">
              <Text color="cyan">./{filePath}</Text>
              <Text color="gray">{content.length.toLocaleString()} bytes</Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
};
