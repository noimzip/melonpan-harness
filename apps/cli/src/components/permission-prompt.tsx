import React from 'react';
import { Box, Text, useInput } from 'ink';
import chalk from 'chalk';
import { PermissionDecision, PermissionRequestedPayload } from '@melonpan/core';

export interface PermissionPromptProps {
  request: PermissionRequestedPayload;
  onDecision: (decision: PermissionDecision) => void;
}

export const PermissionPrompt: React.FC<PermissionPromptProps> = ({
  request,
  onDecision,
}) => {
  useInput((input, key) => {
    const lower = input.toLowerCase();
    if (lower === 'y') {
      onDecision('allow');
    } else if (lower === 'a') {
      onDecision('always_allow');
    } else if (lower === 'n' || key.escape) {
      onDecision('deny');
    }
  });

  const getRiskBadge = () => {
    switch (request.riskLevel) {
      case 'high':
        return chalk.bgRed.white(' HIGH RISK ');
      case 'medium':
        return chalk.bgYellow.black(' MEDIUM RISK ');
      case 'low':
      default:
        return chalk.bgBlue.black(' LOW RISK ');
    }
  };

  const formatTarget = () => {
    const args = request.args || {};
    if (request.toolName === 'run_command' && args.command) {
      return `$ ${args.command}`;
    }
    if ((request.toolName === 'write_file' || request.toolName === 'edit_file') && args.path) {
      return `File: ${args.path}`;
    }
    if (request.toolName === 'web_search' && args.query) {
      return `Search: "${args.query}"`;
    }
    if (request.toolName === 'fetch_url' && args.url) {
      return `URL: ${args.url}`;
    }
    return JSON.stringify(args).slice(0, 80);
  };

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={request.riskLevel === 'high' ? 'red' : 'yellow'}
      paddingX={1}
      marginY={1}
    >
      <Box justifyContent="space-between" marginBottom={1}>
        <Box>
          <Text bold color={request.riskLevel === 'high' ? 'red' : 'yellow'}>
            ⚠️ Permission Approval Requested
          </Text>
        </Box>
        <Box>
          <Text>{getRiskBadge()}</Text>
        </Box>
      </Box>

      <Box flexDirection="column" marginY={0}>
        <Box>
          <Text color="gray">Tool      : </Text>
          <Text bold color="white">
            {request.toolName}
          </Text>
          <Text color="gray"> ({request.category})</Text>
        </Box>
        <Box>
          <Text color="gray">Operation : </Text>
          <Text bold color="yellow">
            {formatTarget()}
          </Text>
        </Box>
        {request.reason && (
          <Box>
            <Text color="gray">Reason    : </Text>
            <Text italic color="gray">
              {request.reason}
            </Text>
          </Box>
        )}
      </Box>

      <Box marginTop={1} justifyContent="space-between">
        <Text color="cyan" bold>
          [y] Allow Once
        </Text>
        <Text color="magenta" bold>
          [a] Always Allow in Session
        </Text>
        <Text color="red" bold>
          [n / Esc] Deny
        </Text>
      </Box>
    </Box>
  );
};
