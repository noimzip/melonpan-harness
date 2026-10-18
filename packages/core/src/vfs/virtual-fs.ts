/**
 * メモリ内仮想ファイルシステム (Virtual File System)
 * Node.jsのローカルファイルシステムやブラウザ環境を汚さずに安全にコード生成と差分修正を管理します。
 */
export class VirtualFS {
  private files: Map<string, string> = new Map();

  /**
   * パス表記を正規化する (./ やバックスラッシュの統一)
   */
  private normalizePath(filePath: string): string {
    return filePath.replace(/\\/g, '/').replace(/^\.\//, '').trim();
  }

  /**
   * ファイルを新規作成または完全上書きする
   */
  writeFile(filePath: string, content: string): void {
    const key = this.normalizePath(filePath);
    this.files.set(key, content);
  }

  /**
   * ファイル内容を読み出す
   */
  readFile(filePath: string): string | undefined {
    const key = this.normalizePath(filePath);
    return this.files.get(key);
  }

  /**
   * ファイルの一部分を検索・置換して差分更新する
   */
  editFile(
    filePath: string,
    search: string,
    replace: string
  ): { success: boolean; error?: string; diffSummary?: string } {
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

    const updated = existing.replace(search, replace);
    this.files.set(key, updated);

    return {
      success: true,
      diffSummary: `Replaced ${search.length} chars with ${replace.length} chars in "${key}".`,
    };
  }

  /**
   * ファイルが存在するか判定
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
   * 登録ファイル一覧のパス配列を取得
   */
  listPaths(): string[] {
    return Array.from(this.files.keys());
  }

  /**
   * VFSを初期化する
   */
  clear(): void {
    this.files.clear();
  }

  /**
   * 仮想ファイルシステム内の全ファイルを指定のローカルディレクトリに実ファイルとして書き出す
   */
  async flushToDisk(targetDir: string = process.cwd()): Promise<string[]> {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const written: string[] = [];

    for (const [filePath, content] of this.files.entries()) {
      const fullPath = path.resolve(targetDir, filePath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content, 'utf-8');
      written.push(fullPath);
    }

    return written;
  }
}

