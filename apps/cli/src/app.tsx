import React, { useState, useEffect, useRef } from 'react';
import { Box, Text } from 'ink';
import { MelonpanCore, AgentEvent, VirtualFS } from '@melonpan/core';
import { Header } from './components/header.js';
import { EventList } from './components/event-list.js';
import { PlanViewer } from './components/plan-viewer.js';
import { InputBar } from './components/input-bar.js';

export interface AppProps {
  initialPrompt?: string;
  initialMode?: 'auto' | 'plan' | 'act';
  model?: string;
  simulate?: boolean;
  maxTurns?: number;
}

export const App: React.FC<AppProps> = ({
  initialPrompt,
  initialMode = 'auto',
  model = 'gemini-3.8-flash',
  simulate,
  maxTurns = 12,
}) => {
  const [status, setStatus] = useState<
    'idle' | 'running' | 'confirming' | 'completed' | 'error'
  >('idle');
  const [mode, setMode] = useState<'auto' | 'plan' | 'act'>(initialMode);
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

            if (currentRunMode === 'plan') {
              // Plan mode finished -> await user confirmation
              setStatus('confirming');
              setCurrentActivity('Plan created. Waiting for confirmation...');
              isRunningRef.current = false;
              return;
            } else {
              setStatus('completed');
              setCurrentActivity(
                `Completed in ${event.payload.turns} turns (${event.payload.durationMs}ms)`
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

  // Submit prompt from InputBar
  const handleSubmit = (submittedText: string) => {
    const trimmed = submittedText.trim();
    if (!trimmed || isRunningRef.current) return;

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
      // Continue execution with the existing VFS containing plan.md
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
      {/* 1. Header with Mode, Model, Status */}
      <Header
        status={status}
        mode={mode}
        model={model}
        turns={turns}
        maxTurns={maxTurns}
      />

      {/* 2. Plan Viewer (Visible if plan.md exists or created) */}
      {planContent ? (
        <PlanViewer
          planContent={planContent}
          isConfirmed={isPlanConfirmed}
        />
      ) : null}

      {/* 3. Event List & Activity Stream */}
      <EventList
        events={events}
        isRunning={status === 'running'}
        currentActivity={currentActivity}
        maxDisplay={8}
      />

      {/* 4. Input & Control Bar */}
      <InputBar
        status={status}
        value={inputPrompt}
        onChange={setInputPrompt}
        onSubmit={handleSubmit}
        onConfirmPlan={handleConfirmPlan}
        onReset={handleReset}
      />

      {/* 5. Virtual Files Summary (When completed) */}
      {status === 'completed' && Object.keys(virtualFiles).length > 0 && (
        <Box
          marginTop={1}
          borderStyle="single"
          borderColor="green"
          paddingX={1}
          flexDirection="column"
        >
          <Text bold color="green">
            📦 Generated Deliverables ({Object.keys(virtualFiles).length} files):
          </Text>
          {Object.entries(virtualFiles).map(([filePath, content]) => (
            <Box key={filePath} justifyContent="space-between">
              <Text color="cyan">{filePath}</Text>
              <Text color="gray">{content.length.toLocaleString()} bytes</Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
};
