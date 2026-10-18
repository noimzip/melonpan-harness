import React, { useEffect } from 'react';
import { Box, Text, useInput, useStdin } from 'ink';
import TextInput from 'ink-text-input';

export interface InputBarProps {
  status: 'idle' | 'running' | 'confirming' | 'completed' | 'error';
  value: string;
  isPickerActive?: boolean;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onConfirmPlan: (approved: boolean) => void;
  onReset: () => void;
}

export const InputBar: React.FC<InputBarProps> = ({
  status,
  value,
  isPickerActive = false,
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
    {
      isActive:
        Boolean(isRawModeSupported) &&
        !isPickerActive &&
        status !== 'idle' &&
        status !== 'running',
    }
  );

  // Non-TTY / Piped input fallback
  useEffect(() => {
    if (
      isRawModeSupported ||
      isPickerActive ||
      typeof process === 'undefined' ||
      !process.stdin
    ) {
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
  }, [isRawModeSupported, isPickerActive, status, onConfirmPlan, onSubmit, onReset]);

  // Handle TextInput changes, immediately detecting pasted newlines
  const handleTextChange = (newVal: string) => {
    if (newVal.includes('\n') || newVal.includes('\r')) {
      const lines = newVal.split(/[\r\n]+/);
      const submitted = lines[0]?.trim();
      if (submitted) {
        onChange('');
        onSubmit(submitted);
        return;
      }
    }
    onChange(newVal);
  };

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
                focus={!isPickerActive}
                value={value}
                onChange={handleTextChange}
                onSubmit={onSubmit}
                placeholder="Enter prompt or /model, /effort..."
              />
            ) : (
              <Text color="gray">
                {value || 'Awaiting prompt from stdin...'}
              </Text>
            )}
          </Box>
          <Box marginTop={1}>
            <Text color="gray">
              [Enter: Submit] [/model: Select Model] [/effort: Select Effort] [Ctrl+C: Quit]
            </Text>
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
