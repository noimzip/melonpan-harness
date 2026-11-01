import React from 'react';
import { Box, Text } from 'ink';
import chalk from 'chalk';

export interface HeaderProps {
  status:
    | 'idle'
    | 'running'
    | 'confirming'
    | 'completed'
    | 'error'
    | 'awaiting_permission';
  mode: 'plan' | 'act' | 'auto';
  model?: string;
  provider?: string;
  thinkingLevel?: string;
  hasApiKey?: boolean;
  isSimulate?: boolean;
  turns?: number;
  maxTurns?: number;
  fsMode?: 'vfs' | 'disk';
  contextWindowTokens?: number;
  maxContextTokens?: number;
}

function formatTokens(num: number): string {
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1)}M`;
  }
  if (num >= 1_000) {
    return `${(num / 1_000).toFixed(1)}k`;
  }
  return num.toString();
}

export const Header: React.FC<HeaderProps> = ({
  status,
  mode,
  model = 'gemini-3.8-flash',
  provider = 'gemini',
  thinkingLevel = 'high',
  hasApiKey = false,
  isSimulate = true,
  turns = 0,
  maxTurns = 300,
  fsMode = 'vfs',
  contextWindowTokens = 0,
  maxContextTokens = 128_000,
}) => {
  const activeKey =
    provider === 'openai'
      ? (typeof process !== 'undefined' ? process.env?.OPENAI_API_KEY : '')
      : provider === 'anthropic'
      ? (typeof process !== 'undefined' ? process.env?.ANTHROPIC_API_KEY : '')
      : hasApiKey;

  const isLive = Boolean(activeKey) && !isSimulate;

  const getStatusBadge = () => {
    switch (status) {
      case 'idle':
        return chalk.bgBlue.black(' IDLE ');
      case 'running':
        return chalk.bgCyan.black(' RUNNING ');
      case 'confirming':
        return chalk.bgYellow.black(' CONFIRMING PLAN ');
      case 'awaiting_permission':
        return chalk.bgRed.black(' AWAITING PERMISSION ');
      case 'completed':
        return chalk.bgGreen.black(' COMPLETED ');
      case 'error':
        return chalk.bgRed.white(' ERROR ');
    }
  };

  const getModeBadge = () => {
    switch (mode) {
      case 'plan':
        return chalk.bgMagenta.black(' MODE: PLAN ');
      case 'act':
        return chalk.bgCyan.black(' MODE: ACT ');
      case 'auto':
        return chalk.bgHex('#00f0ff').black(' MODE: AUTO (Plan -> Act -> Audit) ');
    }
  };

  // Context window gauge calculation (#36)
  const ctxPercent = maxContextTokens > 0
    ? Math.min(100, Math.round((contextWindowTokens / maxContextTokens) * 100))
    : 0;
  const ctxColor =
    ctxPercent >= 90 ? 'red' : ctxPercent >= 70 ? 'yellow' : 'cyan';

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
      marginBottom={1}
    >
      <Box justifyContent="space-between">
        <Box>
          <Text bold color="cyan">
            🍈 Melonpan Core CLI
          </Text>
          <Text color="gray"> v0.4.0</Text>
        </Box>
        <Box>
          <Text>{getModeBadge()} </Text>
          <Text>{getStatusBadge()}</Text>
        </Box>
      </Box>

      <Box justifyContent="space-between" marginTop={1}>
        <Box>
          <Text color="gray">Provider: </Text>
          <Text color="blue" bold>
            [{provider}]
          </Text>
          <Text color="gray">  Model: </Text>
          <Text color="green" bold>
            {model}
          </Text>
          <Text color="gray">  |  Effort: </Text>
          <Text color="magenta" bold>
            {thinkingLevel}
          </Text>
          <Text color="gray">  |  FS: </Text>
          <Text color={fsMode === 'disk' ? 'yellow' : 'cyan'} bold>
            {fsMode === 'disk' ? 'Disk' : 'VFS'}
          </Text>
          <Text color="gray">  |  API: </Text>
          {isLive ? (
            <Text color="green" bold>
              🟢 Live
            </Text>
          ) : (
            <Text color="yellow" bold>
              🟡 Sim
            </Text>
          )}
        </Box>

        <Box>
          <Text color="gray">Ctx: </Text>
          <Text color={ctxColor} bold>
            {formatTokens(contextWindowTokens)}/{formatTokens(maxContextTokens)} ({ctxPercent}%)
          </Text>
          <Text color="gray">  |  Turn: {turns}/{maxTurns}</Text>
        </Box>
      </Box>
    </Box>
  );
};
