import React, { useEffect } from 'react';
import { Box, Text, useInput, useStdin } from 'ink';
import TextInput from 'ink-text-input';

export interface InputBarProps {
  status: 'idle' | 'running' | 'confirming' | 'completed' | 'error';
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onConfirmPlan: (approved: boolean) => void;
  onReset: () => void;
}

export const InputBar: React.FC<InputBarProps> = ({
  status,
  value,
  onChange,
  onSubmit,
  onConfirmPlan,
  onReset,
}) => {
  const { isRawModeSupported } = useStdin();

  // Listen for single-key responses when in raw-mode supported TTY environments
  useInput(
    (input, key) => {
      if (status === 'confirming') {
        if (input.toLowerCase() === 'y') {
          onConfirmPlan(true);
        } else if (input.toLowerCase() === 'n') {
          onConfirmPlan(false);
        }
      } else if (status === 'completed' || status === 'error') {
        if (key.return || input === ' ') {
          onReset();
        }
      }
    },
    { isActive: Boolean(isRawModeSupported) && status !== 'idle' && status !== 'running' }
  );

  // Non-TTY / Piped input fallback
  useEffect(() => {
    if (isRawModeSupported || typeof process === 'undefined' || !process.stdin) {
      return;
    }

    const onData = (chunk: Buffer | string) => {
      const text = chunk.toString().trim().toLowerCase();
      if (status === 'confirming') {
        if (text === 'y' || text.startsWith('y')) {
          onConfirmPlan(true);
        } else if (text === 'n' || text.startsWith('n')) {
          onConfirmPlan(false);
        }
      } else if (status === 'idle') {
        if (text.length > 0) {
          onSubmit(text);
        }
      } else if (status === 'completed' || status === 'error') {
        onReset();
      }
    };

    process.stdin.on('data', onData);
    return () => {
      process.stdin.off('data', onData);
    };
  }, [isRawModeSupported, status, onConfirmPlan, onSubmit, onReset]);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={
        status === 'confirming'
          ? 'yellow'
          : status === 'completed'
          ? 'green'
          : status === 'error'
          ? 'red'
          : 'cyan'
      }
      paddingX={1}
    >
      {status === 'idle' && (
        <Box flexDirection="column">
          <Box>
            <Text color="cyan" bold>
              ❯{' '}
            </Text>
            {isRawModeSupported ? (
              <TextInput
                focus={true}
                value={value}
                onChange={onChange}
                onSubmit={onSubmit}
                placeholder="Enter your prompt (e.g. 'Create a neon arcade game')..."
              />
            ) : (
              <Text color="gray">
                {value || 'Awaiting prompt from stdin...'}
              </Text>
            )}
          </Box>
          <Box marginTop={1}>
            <Text color="gray">[Enter: Submit] [Ctrl+C: Quit]</Text>
          </Box>
        </Box>
      )}

      {status === 'confirming' && (
        <Box flexDirection="column">
          <Box>
            <Text color="yellow" bold>
              ❯ Proceed to implementation? (y/n):{' '}
            </Text>
            <Text color="yellow">_</Text>
          </Box>
          <Box marginTop={1}>
            <Text color="gray">
              [y: Approve plan & run implementation] [n: Cancel / Revise] [Ctrl+C: Quit]
            </Text>
          </Box>
        </Box>
      )}

      {status === 'running' && (
        <Box flexDirection="column">
          <Box>
            <Text color="gray">
              Agent is autonomously executing tasks (ReAct loop)...
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text color="gray">[Running...] [Ctrl+C: Quit]</Text>
          </Box>
        </Box>
      )}

      {status === 'completed' && (
        <Box flexDirection="column">
          <Box>
            <Text color="green" bold>
              ✔ Task completed successfully! Press Enter to start a new prompt.
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text color="gray">[Enter: New Prompt] [Ctrl+C: Quit]</Text>
          </Box>
        </Box>
      )}

      {status === 'error' && (
        <Box flexDirection="column">
          <Box>
            <Text color="red" bold>
              ✖ An error occurred during execution. Press Enter to retry.
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text color="gray">[Enter: Reset] [Ctrl+C: Quit]</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
};
