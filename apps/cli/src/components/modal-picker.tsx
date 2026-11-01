import React, { useState, useEffect, useMemo } from 'react';
import { Box, Text, useInput, useStdin } from 'ink';

export interface PickerItem {
  id: string;
  label: string;
  description?: string;
  group?: string;
  providerId?: string;
  isFree?: boolean;
}

export interface ModalPickerProps {
  title: string;
  items: PickerItem[];
  selectedId: string;
  onSelect: (id: string, item: PickerItem) => void;
  onCancel: () => void;
  enableSearch?: boolean;
  pageSize?: number;
}

export const ModalPicker: React.FC<ModalPickerProps> = ({
  title,
  items,
  selectedId,
  onSelect,
  onCancel,
  enableSearch = true,
  pageSize = 10,
}) => {
  const { isRawModeSupported } = useStdin();
  const [searchQuery, setSearchQuery] = useState<string>('');

  // 検索クエリに基づきフィルタリング (ID, ラベル, 説明, プロバイダー/グループ, isFree)
  const filteredItems = useMemo(() => {
    if (!enableSearch || !searchQuery.trim()) {
      return items;
    }
    const q = searchQuery.toLowerCase().trim();
    const matched = items.filter(
      (item) =>
        item.id.toLowerCase().includes(q) ||
        item.label.toLowerCase().includes(q) ||
        (item.description && item.description.toLowerCase().includes(q)) ||
        (item.group && item.group.toLowerCase().includes(q)) ||
        (item.providerId && item.providerId.toLowerCase().includes(q)) ||
        (item.isFree && 'free'.includes(q))
    );
    // 検索結果内でも無料モデルを最上位に配置し、残りは既定順序を維持
    const free = matched.filter((m) => Boolean(m.isFree));
    const nonFree = matched.filter((m) => !m.isFree);
    return [...free, ...nonFree];
  }, [items, searchQuery, enableSearch]);

  const initialIndex = Math.max(
    0,
    filteredItems.findIndex((item) => item.id === selectedId)
  );
  const [highlightedIndex, setHighlightedIndex] = useState<number>(
    initialIndex >= 0 ? initialIndex : 0
  );

  // 検索クエリ変更時に選択インデックスをリセット
  useEffect(() => {
    setHighlightedIndex(0);
  }, [searchQuery]);

  // Keyboard navigation for TTY mode
  useInput(
    (input, key) => {
      if (key.escape) {
        onCancel();
        return;
      }

      // 検索非有効時のみ 'q' で終了
      if (!enableSearch && input.toLowerCase() === 'q') {
        onCancel();
        return;
      }

      if (key.pageUp) {
        setHighlightedIndex((prev) => Math.max(0, prev - pageSize));
        return;
      }

      if (key.pageDown) {
        setHighlightedIndex((prev) =>
          filteredItems.length > 0
            ? Math.min(filteredItems.length - 1, prev + pageSize)
            : 0
        );
        return;
      }

      if (key.upArrow) {
        setHighlightedIndex((prev) =>
          filteredItems.length > 0
            ? prev > 0
              ? prev - 1
              : filteredItems.length - 1
            : 0
        );
        return;
      }

      if (key.downArrow) {
        setHighlightedIndex((prev) =>
          filteredItems.length > 0
            ? prev < filteredItems.length - 1
              ? prev + 1
              : 0
            : 0
        );
        return;
      }

      // Enter キーで現在のハイライトを選択
      if (key.return) {
        if (filteredItems[highlightedIndex]) {
          onSelect(
            filteredItems[highlightedIndex]!.id,
            filteredItems[highlightedIndex]!
          );
        }
        return;
      }

      // 検索機能有効時の文字入力・バックスペース処理
      if (enableSearch) {
        if (key.backspace || key.delete) {
          setSearchQuery((prev) => prev.slice(0, -1));
          return;
        }

        if (key.ctrl && input === 'u') {
          setSearchQuery('');
          return;
        }

        // 通常の印字可能文字 (アルファベット、数字、記号、スペース)
        if (input.length === 1 && input >= ' ') {
          setSearchQuery((prev) => prev + input);
          return;
        }
      } else {
        // 検索無効時の vim キーバインド
        if (input === 'k') {
          setHighlightedIndex((prev) =>
            filteredItems.length > 0
              ? prev > 0
                ? prev - 1
                : filteredItems.length - 1
              : 0
          );
          return;
        }
        if (input === 'j') {
          setHighlightedIndex((prev) =>
            filteredItems.length > 0
              ? prev < filteredItems.length - 1
                ? prev + 1
                : 0
              : 0
          );
          return;
        }

        // 検索無効時の数字キー直接選択 (1-indexed)
        const num = parseInt(input, 10);
        if (!isNaN(num) && num >= 1 && num <= filteredItems.length) {
          onSelect(filteredItems[num - 1]!.id, filteredItems[num - 1]!);
        }
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
      if (!isNaN(num) && num >= 1 && num <= filteredItems.length) {
        onSelect(filteredItems[num - 1]!.id, filteredItems[num - 1]!);
        return;
      }
      const matched = filteredItems.find(
        (it) => it.id.toLowerCase() === text || it.label.toLowerCase() === text
      );
      if (matched) {
        onSelect(matched.id, matched);
      }
    };

    process.stdin.on('data', onData);
    return () => {
      process.stdin.off('data', onData);
    };
  }, [isRawModeSupported, filteredItems, onSelect, onCancel]);

  // 大量モデル表示時のターミナル溢れを防止するウィンドウ表示 (スクロール)
  const windowStart = Math.max(
    0,
    Math.min(
      highlightedIndex - Math.floor(pageSize / 2),
      Math.max(0, filteredItems.length - pageSize)
    )
  );
  const visibleItems = filteredItems.slice(windowStart, windowStart + pageSize);

  let currentGroup = '';

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

      {/* 検索入力バー */}
      {enableSearch && (
        <Box marginBottom={1} flexDirection="row">
          <Text color="cyan" bold>
            🔍 Search:{' '}
          </Text>
          <Text color="white">{searchQuery}</Text>
          <Text color="gray">_</Text>
          {searchQuery ? (
            <Text color="gray">
              {' '}
              (matched {filteredItems.length} of {items.length} models)
            </Text>
          ) : (
            <Text color="gray">
              {' '}
              ({items.length} models available - type to search)
            </Text>
          )}
        </Box>
      )}

      {/* アイテムが0件の場合のメッセージ */}
      {items.length === 0 ? (
        <Box marginY={1}>
          <Text color="yellow">
            ⚠️ No models available. Configure an API key with /key (e.g. /key openrouter &lt;key&gt;).
          </Text>
        </Box>
      ) : filteredItems.length === 0 ? (
        <Box marginY={1}>
          <Text color="gray">
            No models found matching "{searchQuery}". (Press Backspace to clear)
          </Text>
        </Box>
      ) : (
        visibleItems.map((item, localIdx) => {
          const actualIdx = windowStart + localIdx;
          const isHighlighted = actualIdx === highlightedIndex;
          const isCurrent = item.id === selectedId;
          const showGroupHeader = Boolean(item.group && item.group !== currentGroup);
          if (item.group) {
            currentGroup = item.group;
          }

          return (
            <Box key={item.id} flexDirection="column">
              {showGroupHeader && (
                <Box marginTop={localIdx > 0 ? 1 : 0} marginBottom={0}>
                  <Text color="yellow" bold>
                    ─── {item.group} ─────────────────────────────
                  </Text>
                </Box>
              )}
              {/* 各モデル行: 左側に番号・ラベル・説明、右端に free バッジ */}
              <Box flexDirection="row" justifyContent="space-between" width="100%">
                <Box flexShrink={1}>
                  <Text>
                    <Text color={isHighlighted ? 'cyan' : 'gray'} bold={isHighlighted}>
                      {isHighlighted ? '❯ ' : '  '}
                      {actualIdx + 1}.{' '}
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

                {/* 要件: 「無料のモデルには右端に free と記述し」 */}
                {item.isFree && (
                  <Box marginLeft={1} flexShrink={0}>
                    <Text color="green" bold>
                      free
                    </Text>
                  </Box>
                )}
              </Box>
            </Box>
          );
        })
      )}

      {/* フッター操作説明 */}
      <Box marginTop={1}>
        <Text color="gray">
          [↑/↓: Navigate] {enableSearch ? '[Type to Search] ' : ''}[Enter: Select] [Esc: Cancel]
          {filteredItems.length > pageSize &&
            ` (Showing ${windowStart + 1}-${Math.min(
              windowStart + pageSize,
              filteredItems.length
            )} of ${filteredItems.length})`}
        </Text>
      </Box>
    </Box>
  );
};
