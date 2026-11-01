import { ToolMiddleware, ToolExecutionResult } from '../types.js';

export interface RepetitiveCallGuardOptions {
  /**
   * 同一ファイル・同一クエリに対する許容連続実行回数（デフォルト: 3）
   */
  maxConsecutiveCalls?: number;
}

/**
 * 反復ツール呼び出しガード (Repetitive Tool Call Guard / Ping-Pong Loop Detector)
 *
 * エージェントが同一ファイルや同一クエリに対して `read_file` や `grep_search` を連続実行し、
 * 無限ループ（トークン爆発）に陥るのを防ぐ安全ミドルウェアです。
 */
export function createRepetitiveCallGuardMiddleware(
  options: RepetitiveCallGuardOptions = {}
): ToolMiddleware {
  const maxConsecutive = options.maxConsecutiveCalls ?? 3;
  let lastKey = '';
  let consecutiveCount = 0;
  const recentWindow: string[] = [];
  const maxWindowSize = 10;

  return async (ctx, next): Promise<ToolExecutionResult> => {
    const toolName = ctx.tool.name;

    // リサーチ・探索系ツールの連続呼び出しを監視
    if (toolName === 'read_file' || toolName === 'grep_search') {
      const currentKey =
        toolName === 'read_file'
          ? `read_file:${ctx.args.path ?? ''}`
          : `grep_search:${ctx.args.query ?? ''}:${ctx.args.path ?? ''}`;

      recentWindow.push(currentKey);
      if (recentWindow.length > maxWindowSize) {
        recentWindow.shift();
      }

      if (currentKey === lastKey) {
        consecutiveCount++;
      } else {
        lastKey = currentKey;
        consecutiveCount = 1;
      }

      // ウィンドウ内の同一キー出現回数（ピンポン往復検出）
      const windowCount = recentWindow.filter((k) => k === currentKey).length;

      if (consecutiveCount > maxConsecutive || windowCount > maxConsecutive + 1) {
        const targetDesc =
          toolName === 'read_file'
            ? `read_file("${ctx.args.path ?? ''}")`
            : `grep_search("${ctx.args.query ?? ''}")`;

        const totalAttempts = Math.max(consecutiveCount, windowCount);
        return {
          output: `[LOOP_GUARD_WARNING] You have called ${targetDesc} ${totalAttempts} times in succession. The file/search contents are already fully available in your recent context history. Do NOT re-read or repeat this query. Proceed immediately to edit_file(path, search, replace) or complete_task(summary).`,
          isError: false,
          metadata: {
            loopGuardTriggered: true,
            toolName,
            consecutiveCount: totalAttempts,
          },
        };
      }
    } else {
      // 変更操作（write_file, edit_file等）や他のツールが呼ばれたら、同一リードの連続カウントをリセット
      lastKey = '';
      consecutiveCount = 0;
    }

    return next();
  };
}
