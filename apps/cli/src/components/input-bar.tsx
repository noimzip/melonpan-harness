import React, { useState, useEffect, useMemo } from 'react';
import { Box, Text, useInput, useStdin } from 'ink';
import TextInput from 'ink-text-input';
import { CommandContext } from '../commands/types.js';
import { commandRegistry } from '../commands/registry.js';
import { CommandSuggest } from './command-suggest.js';

export interface InputBarProps {
  status: 'idle' | 'running' | 'confirming' | 'completed' | 'error';
  value: string;
  isPickerActive?: boolean;
  commandContext?: CommandContext;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onConfirmPlan: (approved: boolean) => void;
  onReset: () => void;
}

export const InputBar: React.FC<InputBarProps> = ({
  status,
  value,
  isPickerActive = false,
  commandContext,
  onChange,
  onSubmit,
  onConfirmPlan,
  onReset,
}) => {
  const { isRawModeSupported } = useStdin();
  const [isDismissed, setIsDismissed] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Compute autocomplete suggestions when typing slash commands
  const suggestions = useMemo(() => {
    if (isDismissed || !commandContext || !value.startsWith('/')) {
      return [];
    }
    return commandRegistry.getAutocompleteSuggestions(value, commandContext);
  }, [isDismissed, commandContext, value]);

  // Keep selected index within bounds
  const safeSelectedIndex = suggestions.length > 0
    ? Math.min(selectedIndex, suggestions.length - 1)
    : 0;

  // Intercept special keys (Esc, Tab, Up, Down) for Autocomplete and Confirmation
  useInput(
    (input, key) => {
      // 1. Confirming state
      if (status === 'confirming') {
        if (input.toLowerCase() === 'y') {
          onConfirmPlan(true);
        } else if (input.toLowerCase() === 'n') {
          onConfirmPlan(false);
        }
        return;
      }

      // 2. Completed / Error state
      if (status === 'completed' || status === 'error') {
        if (key.return || input === ' ') {
          onReset();
        }
        return;
      }

      // 3. Autocomplete navigation in Idle state
      if (status === 'idle' && suggestions.length > 0) {
        if (key.escape) {
          setIsDismissed(true);
          return;
        }

        if (key.upArrow) {
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : suggestions.length - 1));
          return;
        }

        if (key.downArrow) {
          setSelectedIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : 0));
          return;
        }

        if (key.tab) {
          const selected = suggestions[safeSelectedIndex];
          if (selected) {
            onChange(selected.text);
            setSelectedIndex(0);
          }
          return;
        }
      }
    },
    {
      isActive:
        Boolean(isRawModeSupported) &&
        !isPickerActive &&
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
      const text = chunk.toString().trim();
      const lower = text.toLowerCase();
      if (status === 'confirming') {
        if (lower === 'y' || lower.startsWith('y')) {
          onConfirmPlan(true);
        } else if (lower === 'n' || lower.startsWith('n')) {
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
    // Strip accidental escape characters
    const sanitized = newVal.replace(/\u001b/g, '');

    if (isDismissed && sanitized !== value) {
      setIsDismissed(false);
    }
    setSelectedIndex(0);

    if (sanitized.includes('\n') || sanitized.includes('\r')) {
      const lines = sanitized.split(/[\r\n]+/);
      const submitted = lines[0]?.trim();
      if (submitted) {
        onChange('');
        onSubmit(submitted);
        return;
      }
    }
    onChange(sanitized);
  };

  // Handle Enter submission
  const handleInputSubmit = (submittedText: string) => {
    const trimmed = submittedText.trim();
    if (!trimmed) return;

    // If autocomplete suggestions are active, apply or execute the highlighted suggestion
    if (suggestions.length > 0 && !isDismissed) {
      const selected = suggestions[safeSelectedIndex];
      if (selected) {
        // If suggestion ends with a space (e.g. "/model ", "/effort ", "/skills enable "),
        // transition to argument completion without submitting
        if (selected.text.endsWith(' ') && submittedText !== selected.text) {
          onChange(selected.text);
          setSelectedIndex(0);
          return;
        }

        // Final leaf command (e.g. "/clear", "/cost", "/model gemini-4-argon"): execute!
        onChange('');
        onSubmit(selected.text);
        return;
      }
    }

    // Normal submit
    onChange('');
    onSubmit(submittedText);
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
          {/* Autocomplete Suggestion Popup directly above prompt */}
          {suggestions.length > 0 && !isDismissed && (
            <Box marginBottom={1}>
              <CommandSuggest
                suggestions={suggestions}
                selectedIndex={safeSelectedIndex}
              />
            </Box>
          )}

          <Box>
            <Text color="cyan" bold>
              ❯{' '}
            </Text>
            {isRawModeSupported ? (
              <TextInput
                focus={!isPickerActive}
                value={value}
                onChange={handleTextChange}
                onSubmit={handleInputSubmit}
                placeholder="Enter prompt or / (e.g. /model, /effort, /skills, /help)..."
              />
            ) : (
              <Text color="gray">
                {value || 'Awaiting prompt from stdin...'}
              </Text>
            )}
          </Box>
          <Box marginTop={1}>
            <Text color="gray">
              [Enter: Submit] [/: Commands & Autocomplete] [/help: Help] [Ctrl+C: Quit]
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
