import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { AgentEvent } from '@melonpan/core';

export interface EventListProps {
  events: AgentEvent[];
  isRunning: boolean;
  currentActivity?: string;
  maxDisplay?: number;
}

function truncate(str: string, maxLen: number): string {
  if (!str) return '';
  const singleLine = str.replace(/\r?\n/g, ' ').trim();
  if (singleLine.length <= maxLen) return singleLine;
  return singleLine.slice(0, maxLen - 3) + '...';
}

function formatToolArgs(name: string, args: Record<string, any> = {}): string {
  if (name === 'write_file') {
    const len = typeof args.content === 'string' ? `${args.content.length} bytes` : '';
    return `"${args.path}", ${len}`;
  }
  if (name === 'edit_file') {
    return `"${args.path}", replace: "${truncate(args.replace || '', 20)}"`;
  }
  if (name === 'dispatch_subagent') {
    return `agent: "${args.agent_type}", task: "${truncate(args.task_prompt || '', 25)}"`;
  }
  if (name === 'complete_task') {
    return `"${truncate(args.summary || '', 30)}"`;
  }
  return JSON.stringify(args).slice(0, 40);
}

export const EventList: React.FC<EventListProps> = ({
  events,
  isRunning,
  currentActivity = 'Processing...',
  maxDisplay = 9,
}) => {
  // Only show the most recent N events so the terminal doesn't overflow
  const displayEvents = events.slice(-maxDisplay);

  const renderEvent = (event: AgentEvent, index: number) => {
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
            <Text color="gray">🧠 </Text>
            <Text color="cyan" italic>
              {truncate(event.payload.thought, 75)}
            </Text>
          </Text>
        );

      case 'TOOL_CALL':
        return (
          <Text key={index}>
            <Text color="yellow">⚙️  Action: </Text>
            <Text bold color="yellow">
              {event.payload.name}
            </Text>
            <Text color="gray">
              ({formatToolArgs(event.payload.name, event.payload.args)})
            </Text>
          </Text>
        );

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
            <Text color="green">📥 Sub-agent [</Text>
            <Text bold color="green">
              {event.payload.agentType}
            </Text>
            <Text color="green">] reported </Text>
            <Text color="gray">
              ({event.payload.durationMs}ms): {truncate(event.payload.result, 55)}
            </Text>
          </Text>
        );

      case 'FILE_CHANGED':
        return (
          <Text key={index}>
            <Text color="cyan">📝 VFS {event.payload.action}: </Text>
            <Text bold color="white">
              {event.payload.path}
            </Text>
            <Text color="gray">
              {' '}({(event.payload.size || 0).toLocaleString()} bytes)
            </Text>
          </Text>
        );

      case 'TOOL_RESULT':
        return (
          <Text key={index} color="gray">
            {'   '}↳ Result: {truncate(event.payload.result, 65)}
          </Text>
        );

      case 'COMPLETE':
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

      default:
        return null;
    }
  };

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="gray"
      paddingX={1}
      marginBottom={1}
    >
      <Box marginBottom={1}>
        <Text bold color="gray">
          ⚡ Activity Log
        </Text>
        {events.length > maxDisplay && (
          <Text color="gray"> (showing last {maxDisplay} of {events.length})</Text>
        )}
      </Box>

      {displayEvents.length === 0 && !isRunning && (
        <Box marginY={1}>
          <Text color="gray">Waiting for prompt...</Text>
        </Box>
      )}

      {displayEvents.map((evt, idx) => renderEvent(evt, idx))}

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
