import React from 'react';
import { Box, Text } from 'ink';
import chalk from 'chalk';
import figures from 'figures';

export interface PlanViewerProps {
  planContent: string;
  isConfirmed?: boolean;
}

interface ChecklistItem {
  text: string;
  completed: boolean;
}

export const PlanViewer: React.FC<PlanViewerProps> = ({
  planContent,
  isConfirmed,
}) => {
  if (!planContent || planContent.trim() === '') {
    return null;
  }

  // Parse lines to extract title and checklist items
  const lines = planContent.split('\n');
  let title = 'Implementation Plan';
  const checklistItems: ChecklistItem[] = [];
  const otherLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('# ')) {
      title = trimmed.slice(2).trim();
      continue;
    }

    const checkMatch = trimmed.match(/^[-*]\s*\[([ xX])\]\s*(.*)$/);
    if (checkMatch) {
      checklistItems.push({
        completed: checkMatch[1].toLowerCase() === 'x',
        text: checkMatch[2].trim(),
      });
    } else if (trimmed.length > 0 && !trimmed.startsWith('```')) {
      otherLines.push(trimmed);
    }
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="magenta"
      paddingX={1}
      marginBottom={1}
    >
      <Box justifyContent="space-between" marginBottom={1}>
        <Box>
          <Text bold color="magenta">
            📋 {title}
          </Text>
          <Text color="gray"> (plan.md)</Text>
        </Box>
        {isConfirmed !== undefined && (
          <Box>
            {isConfirmed ? (
              <Text>{chalk.bgGreen.black(' APPROVED ')}</Text>
            ) : (
              <Text>{chalk.bgYellow.black(' PENDING APPROVAL ')}</Text>
            )}
          </Box>
        )}
      </Box>

      {checklistItems.length > 0 ? (
        <Box flexDirection="column">
          {checklistItems.map((item, idx) => (
            <Box key={idx} marginY={0}>
              <Box marginRight={1}>
                {item.completed ? (
                  <Text color="green" bold>
                    {figures.tick}
                  </Text>
                ) : (
                  <Text color="gray">{figures.squareSmall}</Text>
                )}
              </Box>
              <Text color={item.completed ? 'green' : 'white'} dimColor={item.completed}>
                {item.text}
              </Text>
            </Box>
          ))}
        </Box>
      ) : (
        <Box flexDirection="column">
          {otherLines.slice(0, 8).map((line, idx) => (
            <Text key={idx} color="white">
              {line}
            </Text>
          ))}
          {otherLines.length > 8 && (
            <Text color="gray">... and {otherLines.length - 8} more lines</Text>
          )}
        </Box>
      )}
    </Box>
  );
};
