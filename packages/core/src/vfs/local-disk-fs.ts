import {
  FileDiffResult,
  IFileSystem,
  ListFilesOptions,
  ReadFileOptions,
} from '../types.js';
import { computeUnifiedDiff, matchGlob, sliceLines } from './diff.js';

export interface LocalDiskFSOptions {
  rootDir?: string;
}

/**
 * Node.js ローカルディスク直結型 IFileSystem アダプター (Issue #20, #3)
 * - すべての操作を `rootDir` 内に制限し、パストラバーサル（`../` や絶対パス脱出）を遮断します。
 * - トップレベルでの `node:fs` 静的インポートを避け、動的インポートによりバンドル互換性を保ちます。
 */
export class LocalDiskFS implements IFileSystem {
  private rootDir: string;
  private snapshotCache: Map<string, string> = new Map();

  constructor(options: LocalDiskFSOptions = {}) {
    const defaultCwd =
      typeof (globalThis as any).process !== 'undefined' &&
      typeof (globalThis as any).process.cwd === 'function'
        ? (globalThis as any).process.cwd()
        : '.';
    this.rootDir = options.rootDir || defaultCwd;
  }

  getRootDir(): string {
    return this.rootDir;
  }

  private async resolveSafePath(filePath: string): Promise<{ fullPath: string; relKey: string }> {
    const path = await import('node:path');
    const resolvedRoot = path.resolve(this.rootDir);

    // 絶対パスとして渡された場合でも rootDir 配下であれば許可し、それ以外は拒否
    let candidate: string;
    if (path.isAbsolute(filePath)) {
      candidate = path.resolve(filePath);
    } else {
      candidate = path.resolve(resolvedRoot, filePath);
    }

    if (
      candidate !== resolvedRoot &&
      !candidate.startsWith(resolvedRoot + path.sep)
    ) {
      throw new Error(
        `Path traversal blocked: "${filePath}" resolves outside workspace root "${resolvedRoot}".`
      );
    }

    const relKey = path.relative(resolvedRoot, candidate).replace(/\\/g, '/');
    return { fullPath: candidate, relKey };
  }

  async readFile(filePath: string, options?: ReadFileOptions): Promise<string | undefined> {
    const fs = await import('node:fs/promises');
    const { fullPath, relKey } = await this.resolveSafePath(filePath);
    try {
      const content = await fs.readFile(fullPath, 'utf-8');
      this.snapshotCache.set(relKey, content);
      return sliceLines(content, options);
    } catch (err: any) {
      if (err?.code === 'ENOENT' || err?.code === 'EISDIR') {
        return undefined;
      }
      throw err;
    }
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const { fullPath, relKey } = await this.resolveSafePath(filePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf-8');
    this.snapshotCache.set(relKey, content);
  }

  async editFile(
    filePath: string,
    search: string,
    replace: string
  ): Promise<FileDiffResult> {
    const existing = await this.readFile(filePath);
    if (existing === undefined) {
      return {
        success: false,
        error: `File "${filePath}" does not exist on disk. Use write_file to create it first.`,
      };
    }

    if (!existing.includes(search)) {
      return {
        success: false,
        error: `Search pattern not found in "${filePath}". Please provide the exact text chunk you wish to replace.`,
      };
    }

    const { relKey } = await this.resolveSafePath(filePath);
    // Issue #2: 特殊 `$` パターンによるデータ破壊防止
    const updated = existing.replace(search, () => replace);
    await this.writeFile(filePath, updated);

    const diffInfo = computeUnifiedDiff(relKey || filePath, existing, updated);
    return {
      success: true,
      diffSummary: `Replaced ${search.length} chars with ${replace.length} chars in "${relKey || filePath}" (+${diffInfo.addedLines}/-${diffInfo.removedLines} lines).`,
      unifiedDiff: diffInfo.unifiedDiff,
      addedLines: diffInfo.addedLines,
      removedLines: diffInfo.removedLines,
    };
  }

  async deleteFile(filePath: string): Promise<boolean> {
    const fs = await import('node:fs/promises');
    const { fullPath, relKey } = await this.resolveSafePath(filePath);
    try {
      await fs.unlink(fullPath);
      this.snapshotCache.delete(relKey);
      return true;
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        return false;
      }
      throw err;
    }
  }

  async exists(filePath: string): Promise<boolean> {
    const fs = await import('node:fs/promises');
    const { fullPath } = await this.resolveSafePath(filePath);
    try {
      await fs.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  async listFiles(dirPath?: string, options?: ListFilesOptions): Promise<string[]> {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const resolvedRoot = path.resolve(this.rootDir);
    const targetDir = dirPath
      ? (await this.resolveSafePath(dirPath)).fullPath
      : resolvedRoot;

    const ignoreList = new Set(options?.ignore ?? ['.git', 'node_modules', 'dist', '.next', 'coverage']);
    const collected: string[] = [];

    const walk = async (currentDir: string) => {
      let entries;
      try {
        entries = await fs.readdir(currentDir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (ignoreList.has(entry.name)) {
          continue;
        }
        const entryFullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          await walk(entryFullPath);
        } else if (entry.isFile()) {
          const relFromRoot = path.relative(resolvedRoot, entryFullPath).replace(/\\/g, '/');
          const relFromTarget = path.relative(targetDir, entryFullPath).replace(/\\/g, '/');
          if (
            options?.pattern &&
            !matchGlob(relFromTarget, options.pattern) &&
            !matchGlob(relFromRoot, options.pattern)
          ) {
            continue;
          }
          collected.push(relFromRoot);
        }
      }
    };

    await walk(targetDir);
    return collected.sort();
  }

  getSnapshot(): Record<string, string> {
    return Object.fromEntries(this.snapshotCache.entries());
  }
}
