import { ISessionStore, SerializedSessionData } from '../types.js';

/**
 * 1. InMemorySessionStore: メモリ内セッション永続化ストア (デフォルト / ブラウザ・テスト用 #26)
 */
export class InMemorySessionStore implements ISessionStore {
  private sessions: Map<string, SerializedSessionData> = new Map();

  async save(session: SerializedSessionData): Promise<void> {
    const clone: SerializedSessionData = JSON.parse(JSON.stringify(session));
    this.sessions.set(session.sessionId, clone);
  }

  async load(sessionId: string): Promise<SerializedSessionData | undefined> {
    const found = this.sessions.get(sessionId);
    if (!found) return undefined;
    return JSON.parse(JSON.stringify(found));
  }

  async list(): Promise<
    Array<{ sessionId: string; updatedAt: number; mode: string; model: string }>
  > {
    return Array.from(this.sessions.values())
      .map((s) => ({
        sessionId: s.sessionId,
        updatedAt: s.updatedAt,
        mode: s.mode,
        model: s.model,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async delete(sessionId: string): Promise<boolean> {
    return this.sessions.delete(sessionId);
  }
}

export interface JsonFileSessionStoreOptions {
  storageDir?: string;
}

/**
 * 2. JsonFileSessionStore: ローカルディスクの JSON ファイルとしてセッションを永続化するストア (CLI / TUI-M3 #35 向け #26)
 * 動的インポートによりブラウザバンドル時にも安全です。
 */
export class JsonFileSessionStore implements ISessionStore {
  private storageDir: string;

  constructor(options: JsonFileSessionStoreOptions = {}) {
    const proc = (globalThis as any).process;
    const defaultDir = proc?.cwd ? `${proc.cwd()}/.melonpan/sessions` : '.melonpan/sessions';
    this.storageDir = options.storageDir || defaultDir;
  }

  private sanitizeSessionId(sessionId: string): string {
    return sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  private async getFilePath(sessionId: string): Promise<string> {
    const path = await import('node:path');
    const safeId = this.sanitizeSessionId(sessionId);
    return path.resolve(this.storageDir, `${safeId}.json`);
  }

  async save(session: SerializedSessionData): Promise<void> {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const filePath = await this.getFilePath(session.sessionId);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(session, null, 2), 'utf-8');
  }

  async load(sessionId: string): Promise<SerializedSessionData | undefined> {
    const fs = await import('node:fs/promises');
    const filePath = await this.getFilePath(sessionId);
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(raw) as SerializedSessionData;
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        return undefined;
      }
      throw err;
    }
  }

  async list(): Promise<
    Array<{ sessionId: string; updatedAt: number; mode: string; model: string }>
  > {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    try {
      const entries = await fs.readdir(this.storageDir, { withFileTypes: true });
      const items: Array<{ sessionId: string; updatedAt: number; mode: string; model: string }> = [];
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.json')) {
          try {
            const raw = await fs.readFile(path.join(this.storageDir, entry.name), 'utf-8');
            const parsed = JSON.parse(raw) as SerializedSessionData;
            items.push({
              sessionId: parsed.sessionId,
              updatedAt: parsed.updatedAt,
              mode: parsed.mode,
              model: parsed.model,
            });
          } catch {
            // 破損ファイルはスキップ
          }
        }
      }
      return items.sort((a, b) => b.updatedAt - a.updatedAt);
    } catch {
      return [];
    }
  }

  async delete(sessionId: string): Promise<boolean> {
    const fs = await import('node:fs/promises');
    const filePath = await this.getFilePath(sessionId);
    try {
      await fs.unlink(filePath);
      return true;
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        return false;
      }
      throw err;
    }
  }
}
