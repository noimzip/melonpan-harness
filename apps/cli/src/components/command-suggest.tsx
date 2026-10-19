import React from 'react';
import { Box, Text } from 'ink';
import { CommandSuggestion } from '../commands/types.js';

export interface CommandSuggestProps {
  suggestions: CommandSuggestion[];
  selectedIndex: number;
}

export const CommandSuggest: React.FC<CommandSuggestProps> = ({
  suggestions,
  selectedIndex,
}) => {
  if (suggestions.length === 0) {
    return null;
  }

  const maxVisible = 6;
  // Windowing so the highlighted index is always visible
  const start = Math.max(
    0,
    Math.min(
      selectedIndex - Math.floor(maxVisible / 2),
      Math.max(0, suggestions.length - maxVisible)
    )
  );
  const visibleItems = suggestions.slice(start, start + maxVisible);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
      marginBottom={0}
    >
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold color="cyan">
          💡 Suggestions ({suggestions.length})
        </Text>
        <Text color="gray">
          [Tab / Enter: Complete] [↑/↓: Navigate] [Esc: Close]
        </Text>
      </Box>

      {visibleItems.map((item, index) => {
        const actualIndex = start + index;
        const isSelected = actualIndex === selectedIndex;

        return (
          <Box key={`${item.text}-${actualIndex}`} flexDirection="row">
            <Box width={3}>
              <Text bold color={isSelected ? 'cyan' : 'gray'}>
                {isSelected ? '❯ ' : '  '}
              </Text>
            </Box>
            <Box width={26}>
              <Text bold={isSelected} color={isSelected ? 'cyan' : 'white'}>
                {item.display}
              </Text>
            </Box>
            <Box flexShrink={1}>
              <Text color="gray" dimColor={!isSelected}>
                {item.description}
              </Text>
            </Box>
          </Box>
        );
      })}

      {suggestions.length > maxVisible && (
        <Box marginTop={1}>
          <Text color="gray" dimColor>
            Showing {start + 1}-{Math.min(start + maxVisible, suggestions.length)} of {suggestions.length} (use ↑/↓ to scroll)
          </Text>
        </Box>
      )}
    </Box>
  );
};
