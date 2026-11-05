import React from 'react';
import { Box, Text } from 'ink';
import chalk from 'chalk';
import { resolveModelContextWindow, formatTokens } from '@melonpan/core';

export interface HeaderProps {
  status:
    | 'idle'
    | 'running'
    | 'confirming'
    | 'completed'
    | 'error'
    | 'awaiting_permission';
  mode: 'plan' | 'act' | 'auto' | 'goal';
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
  promptTokens?: number;
  cachedPromptTokens?: number;
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
  maxContextTokens,
  promptTokens = 0,
  cachedPromptTokens = 0,
}) => {
  const resolvedMaxContextTokens =
    maxContextTokens ?? resolveModelContextWindow(model);
  const activeKey =
    provider === 'openai'
      ? (typeof process !== 'undefined' ? process.env?.OPENAI_API_KEY : '')
      : provider === 'anthropic'
      ? (typeof process !== 'undefined' ? process.env?.ANTHROPIC_API_KEY : '')
      : provider === 'surplus'
      ? (typeof process !== 'undefined' ? process.env?.SURPLUS_API_KEY : '')
      : provider === 'openrouter'
      ? (typeof process !== 'undefined' ? process.env?.OPENROUTER_API_KEY : '')
      : provider === 'orcarouter'
      ? (typeof process !== 'undefined' ? process.env?.ORCAROUTER_API_KEY : '')
      : provider === 'groq'
      ? (typeof process !== 'undefined' ? process.env?.GROQ_API_KEY : '')
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
        return chalk.bgCyan.black(' MODE: ACT (Act -> Test & Audit) ');
      case 'auto':
        return chalk.bgHex('#00f0ff').black(' MODE: AUTO (Act -> Test & Audit) ');
      case 'goal':
        return chalk.bgHex('#ff007f').white(' MODE: GOAL (Autonomous + Subagents) ');
    }
  };

  // Context window gauge & Prefix Cache Hit Rate calculation (#36, #63)
  const ctxPercent = resolvedMaxContextTokens > 0
    ? Math.min(100, Math.round((contextWindowTokens / resolvedMaxContextTokens) * 100))
    : 0;
  const ctxColor =
    ctxPercent >= 90 ? 'red' : ctxPercent >= 70 ? 'yellow' : 'cyan';
  const cacheHitPercent =
    promptTokens > 0
      ? Math.min(100, Math.round((cachedPromptTokens / promptTokens) * 100))
      : 0;
  const cacheColor = cacheHitPercent >= 50 ? 'green' : cacheHitPercent > 0 ? 'yellow' : 'gray';

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
            {formatTokens(contextWindowTokens)}/{formatTokens(resolvedMaxContextTokens)} ({ctxPercent}%)
          </Text>
          <Text color="gray">  |  Cache: </Text>
          <Text color={cacheColor} bold>
            {cacheHitPercent}%
          </Text>
          <Text color="gray">  |  Turn: {turns}/{maxTurns}</Text>
        </Box>
      </Box>
    </Box>
  );
};
