import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, useStdin } from 'ink';

export interface PickerItem {
  id: string;
  label: string;
  description?: string;
}

export interface ModalPickerProps {
  title: string;
  items: PickerItem[];
  selectedId: string;
  onSelect: (id: string) => void;
  onCancel: () => void;
}

export const ModalPicker: React.FC<ModalPickerProps> = ({
  title,
  items,
  selectedId,
  onSelect,
  onCancel,
}) => {
  const { isRawModeSupported } = useStdin();
  const initialIndex = Math.max(
    0,
    items.findIndex((item) => item.id === selectedId)
  );
  const [highlightedIndex, setHighlightedIndex] = useState<number>(initialIndex);

  // Keyboard navigation for TTY mode
  useInput(
    (input, key) => {
      if (key.escape || input.toLowerCase() === 'q') {
        onCancel();
        return;
      }

      if (key.upArrow || input === 'k') {
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : items.length - 1));
        return;
      }

      if (key.downArrow || input === 'j') {
        setHighlightedIndex((prev) => (prev < items.length - 1 ? prev + 1 : 0));
        return;
      }

      if (key.return) {
        if (items[highlightedIndex]) {
          onSelect(items[highlightedIndex].id);
        }
        return;
      }

      // Number key direct selection (1-indexed)
      const num = parseInt(input, 10);
      if (!isNaN(num) && num >= 1 && num <= items.length) {
        onSelect(items[num - 1].id);
      }
    },
    { isActive: Boolean(isRawModeSupported) }
  );

  // Non-TTY fallback
  useEffect(() => {
    if (isRawModeSupported || typeof process === 'undefined' || !process.stdin) {
      return;
    }

    const onData = (chunk: Buffer | string) => {
      const text = chunk.toString().trim().toLowerCase();
      if (text === 'q' || text === 'escape') {
        onCancel();
        return;
      }
      const num = parseInt(text, 10);
      if (!isNaN(num) && num >= 1 && num <= items.length) {
        onSelect(items[num - 1].id);
        return;
      }
      const matched = items.find(
        (it) => it.id.toLowerCase() === text || it.label.toLowerCase() === text
      );
      if (matched) {
        onSelect(matched.id);
      }
    };

    process.stdin.on('data', onData);
    return () => {
      process.stdin.off('data', onData);
    };
  }, [isRawModeSupported, items, onSelect, onCancel]);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="magenta"
      paddingX={1}
      marginBottom={1}
    >
      <Box marginBottom={1}>
        <Text bold color="magenta">
          ⚙️  {title}
        </Text>
      </Box>

      {items.map((item, idx) => {
        const isHighlighted = idx === highlightedIndex;
        const isCurrent = item.id === selectedId;

        return (
          <Box key={item.id}>
            <Text>
              <Text color={isHighlighted ? 'cyan' : 'gray'} bold={isHighlighted}>
                {isHighlighted ? '❯ ' : '  '}
                {idx + 1}.{' '}
              </Text>
              <Text
                bold={isHighlighted || isCurrent}
                color={isHighlighted ? 'cyan' : isCurrent ? 'green' : 'white'}
              >
                {item.label}
              </Text>
              {isCurrent && <Text color="green"> (current)</Text>}
              {item.description && (
                <Text color="gray"> - {item.description}</Text>
              )}
            </Text>
          </Box>
        );
      })}

      <Box marginTop={1}>
        <Text color="gray">
          [↑/↓ or 1-{items.length}: Select] [Enter: Confirm] [Esc: Cancel]
        </Text>
      </Box>
    </Box>
  );
};
