import React, { useState } from 'react';
import { Box, Text, useInput, useStdin } from 'ink';
import Spinner from 'ink-spinner';
import chalk from 'chalk';
import figures from 'figures';
import { AgentEvent } from '@melonpan/core';
import { formatTerminalMarkdown } from '../utils/markdown.js';

export interface EventListProps {
  events: AgentEvent[];
  isRunning: boolean;
  currentActivity?: string;
  maxDisplay?: number;
  streamingThought?: string;
  streamingText?: string;
}

function truncate(str: string, maxLen: number): string {
  if (!str) return '';
  const singleLine = str.replace(/\r?\n/g, ' ').trim();
  if (singleLine.length <= maxLen) return singleLine;
  return singleLine.slice(0, maxLen - 3) + '...';
}

function formatToolArgs(name: string, args: Record<string, any> = {}): string {
  if (name === 'read_file') {
    const start = args.start_line ?? args.startLine ?? 1;
    const end = args.end_line ?? args.endLine ?? 'end';
    return `"${args.path}", lines ${start}-${end}`;
  }
  if (name === 'list_files') {
    return `"${args.path || '.'}", pattern: "${args.pattern || '*'}"`;
  }
  if (name === 'grep_search') {
    return `query: "${args.query}", in: "${args.path || '.'}"`;
  }
  if (name === 'run_command') {
    return `$ ${truncate(args.command || '', 60)}`;
  }
  if (name === 'web_search') {
    return `query: "${args.query}"`;
  }
  if (name === 'fetch_url') {
    return `"${args.url}"`;
  }
  if (name === 'activate_skill') {
    return `skill: "${args.name}"`;
  }
  if (name === 'edit_file') {
    return `"${args.path}"`;
  }
  if (name === 'write_file') {
    const len = typeof args.content === 'string' ? `${args.content.length} bytes` : '';
    return `"${args.path}", ${len}`;
  }
  if (name === 'dispatch_subagent') {
    return `agent: "${args.agent_type}", task: "${truncate(args.task_prompt || '', 35)}"`;
  }
  if (name === 'complete_task') {
    return `"${truncate(args.summary || '', 40)}"`;
  }
  return JSON.stringify(args).slice(0, 45);
}

export const EventList: React.FC<EventListProps> = ({
  events,
  isRunning,
  currentActivity = 'Processing...',
  maxDisplay = 10,
  streamingThought = '',
  streamingText = '',
}) => {
  const { isRawModeSupported } = useStdin();
  // Scrollback state (#39)
  const [scrollOffset, setScrollOffset] = useState<number>(0);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  useInput(
    (input, key) => {
      // Scrollback navigation: PageUp to scroll back, PageDown to scroll forward
      if (key.pageUp) {
        setScrollOffset((prev) => Math.min(prev + 5, Math.max(0, events.length - maxDisplay)));
      } else if (key.pageDown) {
        setScrollOffset((prev) => Math.max(0, prev - 5));
      } else if (key.end || (key.escape && scrollOffset > 0)) {
        setScrollOffset(0);
        setExpandedIndex(null);
      } else if (isRunning && (input === '[' || input === ']')) {
        // Bracket keys only allowed when running (TextInput is not focused)
        if (input === '[') {
          setScrollOffset((prev) => Math.min(prev + 5, Math.max(0, events.length - maxDisplay)));
        } else {
          setScrollOffset((prev) => Math.max(0, prev - 5));
        }
      }
    },
    { isActive: Boolean(isRawModeSupported) }
  );

  // Calculate slice range based on scroll offset
  const endIndex = events.length - scrollOffset;
  const startIndex = Math.max(0, endIndex - maxDisplay);
  const displayEvents = events.slice(startIndex, endIndex);

  const renderEvent = (event: AgentEvent, index: number) => {
    const isSubagent = Boolean(event.subagentId);
    const treePrefix = isSubagent ? '  ├─ ' : '';
    const actualEventIndex = startIndex + index;
    const isExpanded = expandedIndex === actualEventIndex;

    switch (event.type) {
      case 'SKILL_INDEXED':
        return (
          <Text key={index} color="gray">
            🔍 Indexed {event.payload.count} skills
          </Text>
        );

      case 'SKILL_LOADED':
        return (
          <Text key={index}>
            <Text color="blue">📦 Loaded skill: </Text>
            <Text bold color="white">{event.payload.name} </Text>
            <Text color="gray">(Progressive Disclosure)</Text>
          </Text>
        );

      case 'PLAN_STARTED':
        return (
          <Text key={index}>
            <Text color="magenta">📋 Plan Phase Started </Text>
            <Text color="gray">({event.payload.mode} mode)</Text>
          </Text>
        );

      case 'PLAN_CREATED':
        return (
          <Text key={index}>
            <Text color="magenta">✓ Generated plan.md </Text>
            <Text color="gray">({event.payload.plan?.length || 0} bytes)</Text>
          </Text>
        );

      case 'THOUGHT':
        return (
          <Text key={index}>
            <Text color="gray">{treePrefix}🧠 </Text>
            <Text color="cyan" italic>
              {truncate(event.payload.thought, 75)}
            </Text>
          </Text>
        );

      case 'TOOL_CALL': {
        const isSkillActivation = event.payload.name === 'activate_skill';
        return (
          <Text key={index}>
            <Text color={isSkillActivation ? 'magenta' : 'yellow'}>
              {treePrefix}{isSkillActivation ? '⚡ Activate Skill: ' : '⚙️  Action: '}
            </Text>
            <Text bold color={isSkillActivation ? 'magenta' : 'yellow'}>
              {event.payload.name}
            </Text>
            <Text color="gray">
              {' '}({formatToolArgs(event.payload.name, event.payload.args)})
            </Text>
          </Text>
        );
      }

      case 'SUBAGENT_DISPATCHED':
        return (
          <Text key={index}>
            <Text color="yellow">🚀 Sub-agent [</Text>
            <Text bold color="yellow">
              {event.payload.agentType}
            </Text>
            <Text color="yellow">] dispatched: </Text>
            <Text color="gray">
              {truncate(event.payload.taskPrompt, 50)}
            </Text>
          </Text>
        );

      case 'SUBAGENT_COMPLETED':
        return (
          <Text key={index}>
            <Text color="green">  └─ 📥 Sub-agent [</Text>
            <Text bold color="green">
              {event.payload.agentType}
            </Text>
            <Text color="green">] reported </Text>
            <Text color="gray">
              ({event.payload.durationMs}ms): {truncate(event.payload.result, 55)}
            </Text>
          </Text>
        );

      case 'FILE_CHANGED': {
        const fsBadge = event.payload.fsType === 'disk' ? '[Disk]' : '[VFS]';
        const diffText =
          event.payload.addedLines !== undefined && event.payload.removedLines !== undefined
            ? ` (+${event.payload.addedLines} / -${event.payload.removedLines} lines)`
            : event.payload.diffSummary
            ? ` (${event.payload.diffSummary})`
            : '';

        return (
          <Text key={index}>
            <Text color="cyan">{treePrefix}📝 {fsBadge} {event.payload.action}: </Text>
            <Text bold color="white">
              {event.payload.path}
            </Text>
            <Text color="gray">
              {' '}({(event.payload.size || 0).toLocaleString()} bytes){diffText}
            </Text>
          </Text>
        );
      }

      case 'TOOL_RESULT': {
        const meta = event.payload.metadata || {};
        const metaParts: string[] = [];
        if (meta.exitCode !== undefined) metaParts.push(`exit: ${meta.exitCode}`);
        if (meta.matches !== undefined) metaParts.push(`${meta.matches} matches`);
        if (meta.durationMs !== undefined) metaParts.push(`${meta.durationMs}ms`);
        if (meta.qualityGate) {
          const qg = meta.qualityGate;
          metaParts.push(
            `QG: ${qg.passed ? 'PASS' : 'FAIL'} (${qg.score}/100)`
          );
        }
        const metaStr = metaParts.length > 0 ? ` (${metaParts.join(', ')})` : '';

        return (
          <Box key={index} flexDirection="column">
            <Text color={event.payload.isError ? 'red' : 'gray'}>
              {treePrefix}{'   '}↳ {event.payload.isError ? 'Error' : 'Result'}{metaStr}:{' '}
              {truncate(event.payload.result, isExpanded ? 500 : 65)}
            </Text>
            {isExpanded && (
              <Box marginY={1} paddingLeft={4} flexDirection="column">
                <Text color="yellow">--- Full Output ---</Text>
                <Text color="white">{event.payload.result}</Text>
              </Box>
            )}
          </Box>
        );
      }

      case 'CONTEXT_COMPACTED': {
        const ratio = Math.round((event.payload.reductionRatio || 0) * 100);
        return (
          <Text key={index}>
            <Text color="magenta">🗜️ Context Compacted: </Text>
            <Text color="white">
              {event.payload.beforeTokens?.toLocaleString()} → {event.payload.afterTokens?.toLocaleString()} tokens{' '}
            </Text>
            <Text color="green" bold>
              ({ratio}% reduction, {event.payload.savedTokens?.toLocaleString()} freed)
            </Text>
          </Text>
        );
      }

      case 'COMPLETE':
        if (event.payload.aborted) {
          return (
            <Box key={index} flexDirection="column" marginY={1}>
              <Text bold color="yellow">
                ⚠️ Task Cancelled by User ({event.payload.turns} turns, {event.payload.durationMs}ms)
              </Text>
              <Text color="gray">   {event.payload.summary}</Text>
            </Box>
          );
        }

        return (
          <Box key={index} flexDirection="column" marginY={1}>
            <Text bold color="green">
              🎉 Task Complete! ({event.payload.turns} turns, {event.payload.durationMs}ms)
            </Text>
            <Text color="white">   {event.payload.summary}</Text>
          </Box>
        );

      case 'ERROR':
        return (
          <Text key={index}>
            <Text bold color="red">
              ❌ Error ({event.payload.phase}):{' '}
            </Text>
            <Text color="red">
              {String(event.payload.error?.message || event.payload.error)}
            </Text>
          </Text>
        );

      // Multi-Turn User Prompt Header (#35)
      case 'USER_PROMPT' as any:
        return (
          <Box key={index} marginY={1} flexDirection="column">
            <Text color="cyan" bold>
              ─────────────────────────────────────────────────────────────────
            </Text>
            <Text bold color="white">
              💬 User Prompt: {event.payload?.prompt}
            </Text>
            <Text color="cyan" bold>
              ─────────────────────────────────────────────────────────────────
            </Text>
          </Box>
        );

      default:
        return null;
    }
  };

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={scrollOffset > 0 ? 'yellow' : 'gray'}
      paddingX={1}
      marginBottom={1}
    >
      <Box justifyContent="space-between" marginBottom={1}>
        <Box>
          <Text bold color={scrollOffset > 0 ? 'yellow' : 'gray'}>
            ⚡ Activity Log
          </Text>
          {events.length > maxDisplay && (
            <Text color="gray">
              {' '}(showing {startIndex + 1} - {endIndex} of {events.length})
            </Text>
          )}
        </Box>
        {scrollOffset > 0 && (
          <Box>
            <Text color="yellow" bold>
              📜 Scrollback (-{scrollOffset}) [PageUp/Down or [/] to scroll, End to reset]
            </Text>
          </Box>
        )}
      </Box>

      {displayEvents.length === 0 && !isRunning && (
        <Box marginY={1}>
          <Text color="gray">Waiting for prompt...</Text>
        </Box>
      )}

      {displayEvents.map((evt, idx) => renderEvent(evt, idx))}

      {/* Real-time Streaming Thought Process (#37) */}
      {streamingThought ? (
        <Box marginTop={1} flexDirection="column">
          <Text color="cyan" bold italic>
            🧠 Thinking Stream:
          </Text>
          <Text color="cyan" italic>
            {streamingThought.slice(-300)}
          </Text>
        </Box>
      ) : null}

      {/* Real-time Streaming Answer with Markdown (#37) */}
      {streamingText ? (
        <Box marginTop={1} flexDirection="column">
          <Text color="green" bold>
            💬 Streaming Response:
          </Text>
          {formatTerminalMarkdown(streamingText.slice(-600)).map((line, idx) => (
            <Text key={idx}>{line}</Text>
          ))}
        </Box>
      ) : null}

      {isRunning && (
        <Box marginTop={1}>
          <Box marginRight={1}>
            <Text color="cyan">
              <Spinner type="dots" />
            </Text>
          </Box>
          <Text color="cyan" italic>
            {currentActivity}
          </Text>
        </Box>
      )}
    </Box>
  );
};
