import { FileDiffResult } from '../types.js';

/**
 * 2つのテキスト間の構造化 Unified Diff および追加・削除行数を生成する（ブラウザ/Node両対応・外部依存ゼロ）
 */
export function computeUnifiedDiff(
  filePath: string,
  oldText: string,
  newText: string,
  contextLines: number = 3
): { unifiedDiff: string; addedLines: number; removedLines: number } {
  if (oldText === newText) {
    return { unifiedDiff: '', addedLines: 0, removedLines: 0 };
  }

  const oldLines = oldText.length === 0 ? [] : oldText.split('\n');
  const newLines = newText.length === 0 ? [] : newText.split('\n');

  // 共通プレフィックスと共通サフィックスを特定して高速に差分範囲を絞る
  let prefixLen = 0;
  const minLen = Math.min(oldLines.length, newLines.length);
  while (prefixLen < minLen && oldLines[prefixLen] === newLines[prefixLen]) {
    prefixLen++;
  }

  let suffixLen = 0;
  while (
    suffixLen < minLen - prefixLen &&
    oldLines[oldLines.length - 1 - suffixLen] === newLines[newLines.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  const oldMid = oldLines.slice(prefixLen, oldLines.length - suffixLen);
  const newMid = newLines.slice(prefixLen, newLines.length - suffixLen);

  // LCS による行単位 diff (中間部分が大きすぎる場合はチャンク比較にフォールバック)
  type DiffOp = { type: 'equal' | 'remove' | 'add'; line: string; oldLineNo?: number; newLineNo?: number };
  const ops: DiffOp[] = [];

  for (let i = 0; i < prefixLen; i++) {
    ops.push({ type: 'equal', line: oldLines[i]!, oldLineNo: i + 1, newLineNo: i + 1 });
  }

  if (oldMid.length * newMid.length <= 250000) {
    const m = oldMid.length;
    const n = newMid.length;
    const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

    for (let i = m - 1; i >= 0; i--) {
      for (let j = n - 1; j >= 0; j--) {
        if (oldMid[i] === newMid[j]) {
          dp[i]![j] = 1 + dp[i + 1]![j + 1]!;
        } else {
          dp[i]![j] = Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
        }
      }
    }

    let i = 0;
    let j = 0;
    while (i < m && j < n) {
      if (oldMid[i] === newMid[j]) {
        ops.push({
          type: 'equal',
          line: oldMid[i]!,
          oldLineNo: prefixLen + i + 1,
          newLineNo: prefixLen + j + 1,
        });
        i++;
        j++;
      } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
        ops.push({
          type: 'remove',
          line: oldMid[i]!,
          oldLineNo: prefixLen + i + 1,
        });
        i++;
      } else {
        ops.push({
          type: 'add',
          line: newMid[j]!,
          newLineNo: prefixLen + j + 1,
        });
        j++;
      }
    }
    while (i < m) {
      ops.push({ type: 'remove', line: oldMid[i]!, oldLineNo: prefixLen + i + 1 });
      i++;
    }
    while (j < n) {
      ops.push({ type: 'add', line: newMid[j]!, newLineNo: prefixLen + j + 1 });
      j++;
    }
  } else {
    for (let i = 0; i < oldMid.length; i++) {
      ops.push({ type: 'remove', line: oldMid[i]!, oldLineNo: prefixLen + i + 1 });
    }
    for (let j = 0; j < newMid.length; j++) {
      ops.push({ type: 'add', line: newMid[j]!, newLineNo: prefixLen + j + 1 });
    }
  }

  for (let k = 0; k < suffixLen; k++) {
    const oldIdx = oldLines.length - suffixLen + k;
    const newIdx = newLines.length - suffixLen + k;
    ops.push({
      type: 'equal',
      line: oldLines[oldIdx]!,
      oldLineNo: oldIdx + 1,
      newLineNo: newIdx + 1,
    });
  }

  let addedLines = 0;
  let removedLines = 0;
  const changedIndices: number[] = [];

  ops.forEach((op, idx) => {
    if (op.type === 'add') {
      addedLines++;
      changedIndices.push(idx);
    } else if (op.type === 'remove') {
      removedLines++;
      changedIndices.push(idx);
    }
  });

  if (changedIndices.length === 0) {
    return { unifiedDiff: '', addedLines: 0, removedLines: 0 };
  }

  // Hunk の構築
  const firstChange = Math.max(0, changedIndices[0]! - contextLines);
  const lastChange = Math.min(ops.length - 1, changedIndices[changedIndices.length - 1]! + contextLines);

  const hunkOps = ops.slice(firstChange, lastChange + 1);
  let oldStart = 1;
  let newStart = 1;
  for (const op of hunkOps) {
    if (op.oldLineNo !== undefined) {
      oldStart = op.oldLineNo;
      break;
    }
  }
  for (const op of hunkOps) {
    if (op.newLineNo !== undefined) {
      newStart = op.newLineNo;
      break;
    }
  }

  const oldCount = hunkOps.filter((o) => o.type === 'equal' || o.type === 'remove').length;
  const newCount = hunkOps.filter((o) => o.type === 'equal' || o.type === 'add').length;

  const diffLines: string[] = [
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
  ];

  for (const op of hunkOps) {
    if (op.type === 'equal') {
      diffLines.push(` ${op.line}`);
    } else if (op.type === 'remove') {
      diffLines.push(`-${op.line}`);
    } else if (op.type === 'add') {
      diffLines.push(`+${op.line}`);
    }
  }

  return {
    unifiedDiff: diffLines.join('\n'),
    addedLines,
    removedLines,
  };
}

/**
 * 簡易 Glob パターンマッチング（ブラウザ/Node両対応）
 * `**`, `*`, `?` をサポート
 */
export function matchGlob(filePath: string, pattern?: string): boolean {
  if (!pattern || pattern === '*' || pattern === '**' || pattern === '**/*') {
    return true;
  }
  const normalizedPath = filePath.replace(/\\/g, '/').replace(/^\.\//, '');
  const normalizedPattern = pattern.replace(/\\/g, '/').replace(/^\.\//, '');

  // 正規表現へ変換
  let regexStr = '^';
  let i = 0;
  while (i < normalizedPattern.length) {
    const c = normalizedPattern[i]!;
    if (c === '*') {
      if (normalizedPattern[i + 1] === '*') {
        if (normalizedPattern[i + 2] === '/') {
          regexStr += '(?:.+/)?';
          i += 3;
          continue;
        } else {
          regexStr += '.*';
          i += 2;
          continue;
        }
      } else {
        regexStr += '[^/]*';
        i++;
        continue;
      }
    } else if (c === '?') {
      regexStr += '[^/]';
    } else if ('.+^${}()|[]\\'.includes(c)) {
      regexStr += '\\' + c;
    } else {
      regexStr += c;
    }
    i++;
  }
  regexStr += '$';

  try {
    const re = new RegExp(regexStr);
    if (re.test(normalizedPath)) return true;
    // パターンにスラッシュが含まれない場合はベースネーム一致も許可 (例: "*.ts")
    if (!normalizedPattern.includes('/')) {
      const baseName = normalizedPath.split('/').pop() || normalizedPath;
      return re.test(baseName);
    }
    return false;
  } catch {
    return normalizedPath.includes(normalizedPattern);
  }
}

/**
 * 行範囲オプション (`startLine`, `endLine`) に従ってテキストを切り出す (1-indexed, inclusive)
 */
export function sliceLines(
  content: string,
  options?: { startLine?: number; endLine?: number }
): string {
  if (!options || (options.startLine === undefined && options.endLine === undefined)) {
    return content;
  }
  const lines = content.split('\n');
  const start = Math.max(1, options.startLine ?? 1);
  const end = Math.min(lines.length, options.endLine ?? lines.length);
  if (start > end || start > lines.length) {
    return '';
  }
  return lines.slice(start - 1, end).join('\n');
}
