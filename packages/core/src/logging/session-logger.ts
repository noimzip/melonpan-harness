import { AgentEvent } from '../types.js';
import {
  formatEventAsText,
  formatTranscriptMarkdown,
  formatTranscriptJsonl,
} from './transcript-formatter.js';

export interface FileSessionLoggerOptions {
  sessionId?: string;
  model?: string;
  mode?: string;
  prompt?: string;
  storageDir?: string;
}

/**
 * Node.js 環境においてセッション実行ログをローカルディスクにストリーミング追記・永続化するロガー
 * (.melonpan/logs/session_<timestamp>_<id>.jsonl / .log)
 */
export class FileSessionLogger {
  readonly sessionId: string;
  readonly model: string;
  readonly mode: string;
  private prompt: string;
  private storageDir: string;
  private events: AgentEvent[] = [];
  private logFilePath?: string;
  private jsonlFilePath?: string;
  private isNode: boolean;
  private isInitialized = false;

  constructor(options: FileSessionLoggerOptions = {}) {
    const proc = (globalThis as any).process;
    this.isNode = typeof proc !== 'undefined' && typeof proc.cwd === 'function';
    this.sessionId =
      options.sessionId ||
      `session_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    this.model = options.model || 'unknown';
    this.mode = options.mode || 'auto';
    this.prompt = options.prompt || '';
    const defaultDir = this.isNode ? `${proc.cwd()}/.melonpan/logs` : '.melonpan/logs';
    this.storageDir = options.storageDir || defaultDir;
  }

  getLogFilePath(): string | undefined {
    return this.logFilePath;
  }

  getJsonlFilePath(): string | undefined {
    return this.jsonlFilePath;
  }

  getEvents(): AgentEvent[] {
    return [...this.events];
  }

  setPrompt(prompt: string): void {
    this.prompt = prompt;
  }

  /**
   * ログファイルを作成し初期ヘッダーを書き込む
   */
  async init(): Promise<void> {
    if (!this.isNode || this.isInitialized) return;

    try {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');

      await fs.mkdir(this.storageDir, { recursive: true });

      const safeId = this.sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
      const datePrefix = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const filenameBase = `session_${datePrefix}_${safeId}`;

      this.logFilePath = path.resolve(this.storageDir, `${filenameBase}.log`);
      this.jsonlFilePath = path.resolve(this.storageDir, `${filenameBase}.jsonl`);

      const initialHeader = [
        `# Melonpan Agent Execution Log`,
        `- Session ID: ${this.sessionId}`,
        `- Model: ${this.model}`,
        `- Mode: ${this.mode}`,
        `- Started At: ${new Date().toISOString()}`,
        this.prompt ? `- Prompt: ${this.prompt}` : '',
        `----------------------------------------`,
        ``,
      ]
        .filter(Boolean)
        .join('\n');

      await fs.writeFile(this.logFilePath, initialHeader, 'utf-8');
      await fs.writeFile(this.jsonlFilePath, '', 'utf-8');
      this.isInitialized = true;
    } catch (err) {
      // 権限エラーやブラウザ環境での安全なフォールバック
      console.warn('FileSessionLogger init failed (non-fatal):', err);
    }
  }

  /**
   * イベントをログファイルへリアルタイム追記
   */
  async appendEvent(event: AgentEvent): Promise<void> {
    this.events.push(event);

    if (!this.isNode) return;
    if (!this.isInitialized) {
      await this.init();
    }

    if (!this.logFilePath || !this.jsonlFilePath) return;

    try {
      const fs = await import('node:fs/promises');

      // 1. JSONL に追記
      const jsonlLine = JSON.stringify(event) + '\n';
      await fs.appendFile(this.jsonlFilePath, jsonlLine, 'utf-8');

      // 2. 人間可読テキストに追記（デルタイベント以外）
      const formatted = formatEventAsText(event);
      if (formatted) {
        await fs.appendFile(this.logFilePath, formatted + '\n\n', 'utf-8');
      }
    } catch {
      // ファイル書き込みエラーはエージェント本体の実行を止めない
    }
  }

  /**
   * セッション完了時に最終サマリーを追記し latest.log / latest.jsonl を更新
   */
  async finish(): Promise<{ logFilePath?: string; jsonlFilePath?: string }> {
    if (!this.isNode || !this.isInitialized) {
      return { logFilePath: this.logFilePath, jsonlFilePath: this.jsonlFilePath };
    }

    try {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');

      // 完全なサマリー付き Markdown トランスクリプトを生成して上書きまたは追記
      const fullTranscript = formatTranscriptMarkdown({
        sessionId: this.sessionId,
        model: this.model,
        mode: this.mode,
        prompt: this.prompt,
        events: this.events,
      });

      if (this.logFilePath) {
        await fs.writeFile(this.logFilePath, fullTranscript, 'utf-8');
      }

      // latest.log / latest.jsonl へのリンクまたはコピー
      const latestLog = path.resolve(this.storageDir, 'latest.log');
      const latestJsonl = path.resolve(this.storageDir, 'latest.jsonl');

      await fs.writeFile(latestLog, fullTranscript, 'utf-8');
      await fs.writeFile(latestJsonl, formatTranscriptJsonl(this.events), 'utf-8');
    } catch (err) {
      console.warn('FileSessionLogger finish failed (non-fatal):', err);
    }

    return { logFilePath: this.logFilePath, jsonlFilePath: this.jsonlFilePath };
  }
}
