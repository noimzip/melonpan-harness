import {
  FileDiffResult,
  IFileSystem,
  ListFilesOptions,
  ReadFileOptions,
} from '../types.js';
import { computeUnifiedDiff, matchGlob, sliceLines } from './diff.js';

/**
 * メモリ内仮想ファイルシステム (Virtual File System / InMemoryVFS)
 * Node.jsのローカルファイルシステムやブラウザ環境を汚さずに安全にコード生成と差分修正を管理します。
 * IFileSystem インターフェースに完全準拠しつつ、既存の同期呼び出しとも後方互換性を維持します。
 */
export class VirtualFS implements IFileSystem {
  private files: Map<string, string> = new Map();

  /**
   * パス表記を正規化する (./ やバックスラッシュ、先頭スラッシュ・相対親参照の無害化)
   */
  private normalizePath(filePath: string): string {
    const slashNormalized = filePath.replace(/\\/g, '/').trim();
    const parts = slashNormalized.split('/');
    const cleanParts: string[] = [];
    for (const part of parts) {
      if (!part || part === '.') continue;
      if (part === '..') {
        cleanParts.pop();
        continue;
      }
      cleanParts.push(part);
    }
    return cleanParts.join('/') || slashNormalized.replace(/^[./\\]+/, '');
  }

  /**
   * ファイルを新規作成または完全上書きする
   */
  writeFile(filePath: string, content: string): void {
    const key = this.normalizePath(filePath);
    this.files.set(key, content);
  }

  /**
   * ファイル内容を読み出す（オプションで行範囲指定に対応）
   */
  readFile(filePath: string, options?: ReadFileOptions): string | undefined {
    const key = this.normalizePath(filePath);
    const content = this.files.get(key);
    if (content === undefined) {
      return undefined;
    }
    return sliceLines(content, options);
  }

  /**
   * ファイルの一部分を検索・置換して差分更新する
   * Issue #2: 特殊 `$` パターン (`$1`, `$&`, `$'` 等) によるデータ破壊を防止するため関数置換を使用
   * Issue #20: 構造化 Unified Diff (`unifiedDiff`, `addedLines`, `removedLines`) を返却
   */
  editFile(
    filePath: string,
    search: string,
    replace: string
  ): FileDiffResult {
    const key = this.normalizePath(filePath);
    const existing = this.files.get(key);

    if (existing === undefined) {
      return {
        success: false,
        error: `File "${filePath}" does not exist in the virtual filesystem. Use write_file to create it first.`,
      };
    }

    if (!existing.includes(search)) {
      return {
        success: false,
        error: `Search pattern not found in "${filePath}". Please provide the exact text chunk you wish to replace.`,
      };
    }

    // Issue #2: String.prototype.replace の第2引数に関数を渡し、`$1` 等の特殊パターン展開を防止
    const updated = existing.replace(search, () => replace);
    this.files.set(key, updated);

    const diffInfo = computeUnifiedDiff(key, existing, updated);

    return {
      success: true,
      diffSummary: `Replaced ${search.length} chars with ${replace.length} chars in "${key}" (+${diffInfo.addedLines}/-${diffInfo.removedLines} lines).`,
      unifiedDiff: diffInfo.unifiedDiff,
      addedLines: diffInfo.addedLines,
      removedLines: diffInfo.removedLines,
    };
  }

  /**
   * ファイルを削除する (Issue #10)
   */
  deleteFile(filePath: string): boolean {
    const key = this.normalizePath(filePath);
    return this.files.delete(key);
  }

  /**
   * ファイルが存在するか判定 (IFileSystem 準拠)
   */
  exists(filePath: string): boolean {
    return this.hasFile(filePath);
  }

  /**
   * ファイルが存在するか判定 (後方互換メソッド)
   */
  hasFile(filePath: string): boolean {
    const key = this.normalizePath(filePath);
    return this.files.has(key);
  }

  /**
   * 保持している全ファイルをプレーンなオブジェクトとして取得する
   */
  getFiles(): Record<string, string> {
    return Object.fromEntries(this.files.entries());
  }

  /**
   * IFileSystem スナップショット取得
   */
  getSnapshot(): Record<string, string> {
    return this.getFiles();
  }

  /**
   * 登録ファイル一覧のパス配列を取得 (後方互換)
   */
  listPaths(): string[] {
    return Array.from(this.files.keys());
  }

  /**
   * ディレクトリおよび Glob パターン・除外リストに従ってファイル一覧を取得 (Issue #20, #21)
   */
  listFiles(dirPath?: string, options?: ListFilesOptions): string[] {
    const normDir = dirPath ? this.normalizePath(dirPath) : '';
    const ignoreList = options?.ignore ?? ['.git', 'node_modules', 'dist'];
    const results: string[] = [];

    for (const filePath of this.files.keys()) {
      if (normDir && normDir !== '.') {
        if (filePath !== normDir && !filePath.startsWith(normDir + '/')) {
          continue;
        }
      }

      const segments = filePath.split('/');
      if (segments.some((seg) => ignoreList.includes(seg))) {
        continue;
      }

      const relativeToDir =
        normDir && filePath.startsWith(normDir + '/')
          ? filePath.slice(normDir.length + 1)
          : filePath;

      if (options?.pattern && !matchGlob(relativeToDir, options.pattern) && !matchGlob(filePath, options.pattern)) {
        continue;
      }

      results.push(filePath);
    }

    return results.sort();
  }

  /**
   * VFSを初期化する
   */
  clear(): void {
    this.files.clear();
  }

  /**
   * 仮想ファイルシステム内の全ファイルを指定のローカルディレクトリに実ファイルとして書き出す
   * Issue #3: パストラバーサルおよびルート上書き防止ガードを実装
   */
  async flushToDisk(targetDir?: string): Promise<string[]> {
    const defaultDir =
      typeof (globalThis as any).process !== 'undefined' &&
      typeof (globalThis as any).process.cwd === 'function'
        ? (globalThis as any).process.cwd()
        : '/';
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const written: string[] = [];
    const resolvedTarget = path.resolve(targetDir ?? defaultDir);

    for (const [rawPath, content] of this.files.entries()) {
      // 先頭の `/` や `../` を除去した上でターゲットディレクトリ内に解決されるか検証
      const sanitizedRel = rawPath
        .replace(/\\/g, '/')
        .replace(/^([/\\]+|(\.\.[/\\])+)+/, '');

      const fullPath = path.resolve(resolvedTarget, sanitizedRel);
      const isInsideTarget =
        fullPath.startsWith(resolvedTarget + path.sep) && fullPath !== resolvedTarget;

      if (!isInsideTarget) {
        throw new Error(`Path traversal detected: "${rawPath}" escapes target directory "${resolvedTarget}"`);
      }

      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content, 'utf-8');
      written.push(fullPath);
    }

    return written;
  }
}

/**
 * InMemoryVFS エイリアス (Issue #20)
 */
export { VirtualFS as InMemoryVFS };
