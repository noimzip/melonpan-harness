import React from 'react';
import { Box, Text } from 'ink';
import chalk from 'chalk';

export interface HeaderProps {
  status: 'idle' | 'running' | 'confirming' | 'completed' | 'error';
  mode: 'plan' | 'act' | 'auto';
  model?: string;
  thinkingLevel?: string;
  turns?: number;
  maxTurns?: number;
}

export const Header: React.FC<HeaderProps> = ({
  status,
  mode,
  model = 'gemini-3.8-flash',
  thinkingLevel = 'high',
  turns = 0,
  maxTurns = 12,
}) => {
  const getStatusBadge = () => {
    switch (status) {
      case 'idle':
        return chalk.bgBlue.black(' IDLE ');
      case 'running':
        return chalk.bgCyan.black(' RUNNING ');
      case 'confirming':
        return chalk.bgYellow.black(' CONFIRMING PLAN ');
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
          <Text color="gray"> v0.3.0</Text>
        </Box>
        <Box>
          <Text>{getModeBadge()} </Text>
          <Text>{getStatusBadge()}</Text>
        </Box>
      </Box>

      <Box justifyContent="space-between" marginTop={1}>
        <Box>
          <Text color="gray">Model: </Text>
          <Text color="green" bold>
            {model}
          </Text>
          <Text color="gray">  |  Effort: </Text>
          <Text color="magenta" bold>
            {thinkingLevel}
          </Text>
        </Box>
        <Box>
          <Text color="gray">
            Turn: {turns}/{maxTurns}
          </Text>
        </Box>
      </Box>
    </Box>
  );
};
