import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Box, Text, useInput, useStdin } from 'ink';
import TextInput from 'ink-text-input';
import { PermissionDecision, PermissionRequestedPayload } from '@melonpan/core';
import { CommandContext } from '../commands/types.js';
import { commandRegistry, extendedCommandRegistry } from '../commands/registry.js';
import { CommandSuggest } from './command-suggest.js';
import { PermissionPrompt } from './permission-prompt.js';

export interface InputBarProps {
  status:
    | 'idle'
    | 'running'
    | 'confirming'
    | 'completed'
    | 'error'
    | 'awaiting_permission';
  value: string;
  isPickerActive?: boolean;
  commandContext?: CommandContext;
  pendingPermission?: PermissionRequestedPayload;
  onPermissionDecision?: (decision: PermissionDecision) => void;
  onCancelTask?: () => void;
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
  pendingPermission,
  onPermissionDecision,
  onCancelTask,
  onChange,
  onSubmit,
  onConfirmPlan,
  onReset,
}) => {
  const { isRawModeSupported } = useStdin();
  const [isDismissed, setIsDismissed] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [hasNavigatedSuggestions, setHasNavigatedSuggestions] = useState(false);

  // Prompt History (#39)
  const historyRef = useRef<string[]>([]);
  const [historyPointer, setHistoryPointer] = useState<number>(-1);

  // Compute autocomplete suggestions when typing slash commands
  const suggestions = useMemo(() => {
    if (isDismissed || !commandContext || !value.startsWith('/')) {
      return [];
    }
    return extendedCommandRegistry.getAutocompleteSuggestions(value, commandContext);
  }, [isDismissed, commandContext, value]);

  // Keep selected index within bounds
  const safeSelectedIndex =
    suggestions.length > 0 ? Math.min(selectedIndex, suggestions.length - 1) : 0;

  // Intercept special keys (Esc, Tab, Up, Down)
  useInput(
    (input, key) => {
      // 0. Permission Prompt handling: delegated to PermissionPrompt component
      if (status === 'awaiting_permission') {
        return;
      }

      // 1. Confirming state (Plan mode)
      if (status === 'confirming') {
        if (input.toLowerCase() === 'y') {
          onConfirmPlan(true);
        } else if (input.toLowerCase() === 'n') {
          onConfirmPlan(false);
        }
        return;
      }

      // 2. Running state: Esc cancellation (#39)
      if (status === 'running') {
        if (key.escape) {
          onCancelTask?.();
        }
        return;
      }

      // 3. Error state: Enter or Space to reset
      if (status === 'error') {
        if (key.return || input === ' ') {
          onReset();
        }
        return;
      }

      // 4. Autocomplete navigation in Idle / Completed state
      if (suggestions.length > 0 && !isDismissed) {
        if (key.escape) {
          setIsDismissed(true);
          setHasNavigatedSuggestions(false);
          return;
        }

        if (key.upArrow) {
          setHasNavigatedSuggestions(true);
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : suggestions.length - 1));
          return;
        }

        if (key.downArrow) {
          setHasNavigatedSuggestions(true);
          setSelectedIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : 0));
          return;
        }

        if (key.tab) {
          const selected = suggestions[safeSelectedIndex];
          if (selected) {
            onChange(selected.text);
            setHasNavigatedSuggestions(false);
            setSelectedIndex(0);
          }
          return;
        }
      }

      // 5. Prompt History Navigation when not autocompleting (#39)
      if ((status === 'idle' || status === 'completed') && suggestions.length === 0) {
        if (key.upArrow && historyRef.current.length > 0) {
          const nextIndex = historyPointer < 0
            ? historyRef.current.length - 1
            : Math.max(0, historyPointer - 1);
          setHistoryPointer(nextIndex);
          const historyItem = historyRef.current[nextIndex];
          if (historyItem) {
            onChange(historyItem);
          }
          return;
        }

        if (key.downArrow && historyPointer >= 0) {
          const nextIndex = historyPointer + 1;
          if (nextIndex >= historyRef.current.length) {
            setHistoryPointer(-1);
            onChange('');
          } else {
            setHistoryPointer(nextIndex);
            const historyItem = historyRef.current[nextIndex];
            if (historyItem) {
              onChange(historyItem);
            }
          }
          return;
        }
      }
    },
    {
      isActive:
        Boolean(isRawModeSupported) &&
        !isPickerActive,
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
      if (status === 'awaiting_permission') {
        if (lower === 'y') onPermissionDecision?.('allow');
        else if (lower === 'a') onPermissionDecision?.('always_allow');
        else if (lower === 'n') onPermissionDecision?.('deny');
      } else if (status === 'confirming') {
        if (lower === 'y' || lower.startsWith('y')) {
          onConfirmPlan(true);
        } else if (lower === 'n' || lower.startsWith('n')) {
          onConfirmPlan(false);
        }
      } else if (status === 'idle' || status === 'completed') {
        if (text.length > 0) {
          onSubmit(text);
        }
      } else if (status === 'error') {
        onReset();
      }
    };

    process.stdin.on('data', onData);
    return () => {
      process.stdin.off('data', onData);
    };
  }, [
    isRawModeSupported,
    isPickerActive,
    status,
    onPermissionDecision,
    onConfirmPlan,
    onSubmit,
    onReset,
  ]);

  // Handle TextInput changes, immediately detecting pasted newlines
  const handleTextChange = (newVal: string) => {
    const sanitized = newVal.replace(/\u001b/g, '');

    if (isDismissed && sanitized !== value) {
      setIsDismissed(false);
    }
    setSelectedIndex(0);
    setHasNavigatedSuggestions(false);

    if (sanitized.includes('\n') || sanitized.includes('\r')) {
      const lines = sanitized.split(/[\r\n]+/);
      const submitted = lines[0]?.trim();
      if (submitted) {
        handleFinalSubmit(submitted);
        return;
      }
    }
    onChange(sanitized);
  };

  const handleFinalSubmit = (submittedText: string) => {
    const trimmed = submittedText.trim();
    if (!trimmed) return;

    // Add to prompt history (#39)
    if (!historyRef.current.includes(trimmed)) {
      historyRef.current.push(trimmed);
    }
    setHistoryPointer(-1);
    setHasNavigatedSuggestions(false);
    onChange('');
    onSubmit(trimmed);
  };

  // Handle Enter submission (#7 & #35)
  const handleInputSubmit = (submittedText: string) => {
    const trimmed = submittedText.trim();
    if (!trimmed) return;

    // If user explicitly navigated the suggestion list with arrows, select it (#7)
    if (hasNavigatedSuggestions && suggestions.length > 0 && !isDismissed) {
      const selected = suggestions[safeSelectedIndex];
      if (selected) {
        if (selected.text.endsWith(' ') && submittedText !== selected.text) {
          onChange(selected.text);
          setHasNavigatedSuggestions(false);
          setSelectedIndex(0);
          return;
        }

        handleFinalSubmit(selected.text);
        return;
      }
    }

    // Otherwise, submit the raw typed command or prompt!
    handleFinalSubmit(submittedText);
  };

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={
        status === 'awaiting_permission'
          ? 'red'
          : status === 'confirming'
          ? 'yellow'
          : status === 'completed'
          ? 'green'
          : status === 'error'
          ? 'red'
          : 'cyan'
      }
      paddingX={1}
    >
      {/* 1. Interactive Permission Prompt (#33) */}
      {status === 'awaiting_permission' && pendingPermission && (
        <PermissionPrompt
          request={pendingPermission}
          onDecision={(decision) => onPermissionDecision?.(decision)}
        />
      )}

      {/* 2. Idle or Continuous Multi-Turn Completed state (#35) */}
      {(status === 'idle' || status === 'completed') && (
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
            <Text color={status === 'completed' ? 'green' : 'cyan'} bold>
              ❯{' '}
            </Text>
            {isRawModeSupported ? (
              <TextInput
                focus={!isPickerActive}
                value={value}
                onChange={handleTextChange}
                onSubmit={handleInputSubmit}
                placeholder={
                  status === 'completed'
                    ? 'Enter next instruction or / (e.g. /compact, /cost, /help)...'
                    : 'Enter prompt or / (e.g. /model, /permissions, /help)...'
                }
              />
            ) : (
              <Text color="gray">
                {value || 'Awaiting prompt from stdin...'}
              </Text>
            )}
          </Box>
          <Box marginTop={1}>
            <Text color="gray">
              [Enter: Submit] [Tab: Complete] [↑/↓: History/Nav] [/help: Commands] [Ctrl+C: Quit]
            </Text>
          </Box>
        </Box>
      )}

      {/* 3. Confirming state (Plan mode approval) */}
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

      {/* 4. Running state with Esc cancellation (#39) */}
      {status === 'running' && (
        <Box flexDirection="column">
          <Box>
            <Text color="gray">
              Agent is autonomously executing tasks (ReAct loop)...
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text color="gray">
              [Running...] <Text bold color="yellow">[Esc: Cancel Task]</Text> [Ctrl+C: Quit]
            </Text>
          </Box>
        </Box>
      )}

      {/* 5. Error state */}
      {status === 'error' && (
        <Box flexDirection="column">
          <Box>
            <Text color="red" bold>
              ✖ An error occurred during execution. Press Enter to retry or reset.
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
