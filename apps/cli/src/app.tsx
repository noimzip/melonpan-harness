import React, { useState, useEffect, useRef } from 'react';
import { Box, Text } from 'ink';
import {
  MelonpanCore,
  AgentEvent,
  VirtualFS,
  AVAILABLE_MODELS,
  THINKING_LEVELS,
} from '@melonpan/core';
import { Header } from './components/header.js';
import { EventList } from './components/event-list.js';
import { PlanViewer } from './components/plan-viewer.js';
import { InputBar } from './components/input-bar.js';
import { ModalPicker, PickerItem } from './components/modal-picker.js';

export interface AppProps {
  initialPrompt?: string;
  initialMode?: 'auto' | 'plan' | 'act';
  model?: string;
  initialEffort?: string;
  outDir?: string;
  simulate?: boolean;
  maxTurns?: number;
}

const MODEL_ITEMS: PickerItem[] = [
  {
    id: 'gemma-4-31b-it',
    label: 'gemma-4-31b-it',
    description: 'Open weights 31B instruction-tuned model',
  },
  {
    id: 'gemini-4-argon',
    label: 'gemini-4-argon',
    description: 'Next-generation frontier reasoning model',
  },
  {
    id: 'gemini-3.8-flash',
    label: 'gemini-3.8-flash',
    description: 'Flagship high-speed multimodality & reasoning (default)',
  },
  {
    id: 'gemini-3.5-flash-lite',
    label: 'gemini-3.5-flash-lite',
    description: 'Ultra-lightweight & fast response model',
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
  initialEffort = 'high',
  outDir = process.cwd(),
  simulate,
  maxTurns = 12,
}) => {
  const [status, setStatus] = useState<
    'idle' | 'running' | 'confirming' | 'completed' | 'error'
  >('idle');
  const [mode, setMode] = useState<'auto' | 'plan' | 'act'>(initialMode);
  const [model, setModel] = useState<string>(defaultModel);
  const [thinkingLevel, setThinkingLevel] = useState<string>(initialEffort);
  const [activePicker, setActivePicker] = useState<'none' | 'model' | 'effort'>(
    'none'
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

  const savedVfsRef = useRef<VirtualFS | null>(null);
  const isRunningRef = useRef<boolean>(false);

  // Run the core agent loop for a given prompt and mode
  const executeAgent = async (
    promptToRun: string,
    currentRunMode: 'auto' | 'plan' | 'act',
    existingVfs?: VirtualFS | null
  ) => {
    if (isRunningRef.current) return;
    isRunningRef.current = true;

    setStatus('running');
    setActivePrompt(promptToRun);
    setCurrentActivity('Initializing Melonpan agent...');

    try {
      const core = new MelonpanCore({
        model,
        thinkingLevel,
        mode: currentRunMode,
        simulate,
        maxTurns,
        vfs: existingVfs ?? undefined,
      });

      let turnCounter = 0;

      for await (const event of core.run(promptToRun)) {
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
            setCurrentActivity(`Plan specification generated`);
            break;

          case 'THOUGHT':
            setCurrentActivity(
              `Thinking: ${event.payload.thought.slice(0, 60)}...`
            );
            break;

          case 'TOOL_CALL':
            turnCounter++;
            setTurns(turnCounter);
            setCurrentActivity(`Action: ${event.payload.name}`);
            break;

          case 'SUBAGENT_DISPATCHED':
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

          case 'COMPLETE':
            setVirtualFiles(event.payload.files);
            savedVfsRef.current = core.getVFS();

            // 実ディスク（カレントディレクトリ）へ成果物を自動書き出し
            try {
              await core.getVFS().flushToDisk(outDir);
            } catch (diskErr: any) {
              console.error('Failed to flush deliverables to disk:', diskErr);
            }

            if (currentRunMode === 'plan') {
              // Plan mode finished -> await user confirmation
              setStatus('confirming');
              setCurrentActivity('Plan created and saved to disk. Waiting for confirmation...');
              isRunningRef.current = false;
              return;
            } else {
              setStatus('completed');
              setCurrentActivity(
                `Completed in ${event.payload.turns} turns (${event.payload.durationMs}ms) - saved to disk`
              );
            }
            break;

          case 'ERROR':
            setStatus('error');
            setCurrentActivity(`Error: ${event.payload.error}`);
            break;
        }
      }

      if (currentRunMode !== 'plan' && status !== 'error') {
        setStatus('completed');
      }
    } catch (err: any) {
      setStatus('error');
      setCurrentActivity(`Runtime Error: ${err.message || String(err)}`);
    } finally {
      isRunningRef.current = false;
    }
  };

  // Submit prompt or handle slash commands (/model, /effort)
  const handleSubmit = (submittedText: string) => {
    const trimmed = submittedText.trim();
    if (!trimmed || isRunningRef.current) return;

    // Handle /model command
    if (trimmed === '/model' || trimmed.startsWith('/model ')) {
      setInputPrompt('');
      const arg = trimmed.slice('/model'.length).trim();
      if (!arg) {
        setActivePicker('model');
        return;
      }

      const matched = AVAILABLE_MODELS.find(
        (m) => m.toLowerCase() === arg.toLowerCase()
      );
      if (matched) {
        setModel(matched);
        setCurrentActivity(`Model switched to ${matched}`);
        setEvents((prev) => [
          ...prev,
          {
            type: 'THOUGHT',
            payload: { thought: `Switched active model to: ${matched}` },
            timestamp: Date.now(),
          },
        ]);
      } else {
        setActivePicker('model');
      }
      return;
    }

    // Handle /effort command
    if (trimmed === '/effort' || trimmed.startsWith('/effort ')) {
      setInputPrompt('');
      const arg = trimmed.slice('/effort'.length).trim();
      if (!arg) {
        setActivePicker('effort');
        return;
      }

      const matched = THINKING_LEVELS.find(
        (l) => l.toLowerCase() === arg.toLowerCase()
      );
      if (matched) {
        setThinkingLevel(matched);
        setCurrentActivity(`Thinking level (effort) switched to ${matched}`);
        setEvents((prev) => [
          ...prev,
          {
            type: 'THOUGHT',
            payload: {
              thought: `Switched thinking level (effort) to: ${matched}`,
            },
            timestamp: Date.now(),
          },
        ]);
      } else {
        setActivePicker('effort');
      }
      return;
    }

    // Standard task prompt execution
    setInputPrompt('');
    setEvents([]);
    setPlanContent('');
    setIsPlanConfirmed(undefined);
    setTurns(0);
    setVirtualFiles({});

    executeAgent(trimmed, mode);
  };

  // Handle [y/n] plan confirmation
  const handleConfirmPlan = (approved: boolean) => {
    if (approved) {
      setIsPlanConfirmed(true);
      setMode('act');
      executeAgent(
        `Implement game according to plan.md: ${activePrompt}`,
        'act',
        savedVfsRef.current
      );
    } else {
      setIsPlanConfirmed(false);
      setStatus('idle');
      setCurrentActivity('Plan discarded. Ready for new prompt.');
    }
  };

  // Reset after completion or error
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
      {/* 1. Header with Mode, Model, Thinking Level (Effort), Status */}
      <Header
        status={status}
        mode={mode}
        model={model}
        thinkingLevel={thinkingLevel}
        turns={turns}
        maxTurns={maxTurns}
      />

      {/* 2. Modal Picker (Active when /model or /effort is opened) */}
      {activePicker === 'model' && (
        <ModalPicker
          title="Select Active Model (/model)"
          items={MODEL_ITEMS}
          selectedId={model}
          onSelect={(selectedModel) => {
            setModel(selectedModel);
            setActivePicker('none');
            setCurrentActivity(`Model switched to ${selectedModel}`);
            setEvents((prev) => [
              ...prev,
              {
                type: 'THOUGHT',
                payload: { thought: `Switched active model to: ${selectedModel}` },
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

      {/* 3. Plan Viewer (Visible if plan.md exists or created) */}
      {planContent ? (
        <PlanViewer
          planContent={planContent}
          isConfirmed={isPlanConfirmed}
        />
      ) : null}

      {/* 4. Event List & Activity Stream */}
      <EventList
        events={events}
        isRunning={status === 'running'}
        currentActivity={currentActivity}
        maxDisplay={8}
      />

      {/* 5. Input & Control Bar */}
      <InputBar
        status={status}
        value={inputPrompt}
        isPickerActive={activePicker !== 'none'}
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
            💾 Deliverables Saved to Current Directory ({Object.keys(virtualFiles).length} files):
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
