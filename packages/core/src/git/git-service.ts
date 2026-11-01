import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

const execFileAsync = promisify(execFile);

export interface GitCommitInfo {
  hash: string;
  message: string;
  timestamp: number;
}

/**
 * セッション専用 Git サービス (Session Git Manager)
 * - セッション作業ディレクトリごとに `git init` を実行
 * - 成果物の自動コミットによる差分追跡とバージョン管理
 * - `git diff` による精密な変更検出
 */
export class GitService {
  /**
   * 指定したディレクトリで git init を実行し、初期コミットを作成します
   */
  static async initSessionRepo(cwd: string): Promise<void> {
    await fs.mkdir(cwd, { recursive: true });

    // 既に git リポジトリか確認
    const gitDir = path.join(cwd, '.git');
    let exists = false;
    try {
      await fs.access(gitDir);
      exists = true;
    } catch {
      exists = false;
    }

    if (!exists) {
      await execFileAsync('git', ['init', '-b', 'main'], { cwd });

      // ローカルユーザー設定（グローバル設定がない環境でもコミット可能にする）
      await execFileAsync('git', ['config', 'user.name', 'Melonpan Agent'], { cwd });
      await execFileAsync('git', ['config', 'user.email', 'agent@melonpan.local'], { cwd });

      // .gitignore 作成
      const gitignorePath = path.join(cwd, '.gitignore');
      const gitignoreContent = [
        'node_modules/',
        '.DS_Store',
        '*.tmp',
        '*.log',
        '',
      ].join('\n');
      await fs.writeFile(gitignorePath, gitignoreContent, 'utf-8');

      // 初期コミット作成
      await execFileAsync('git', ['add', '.gitignore'], { cwd });
      await execFileAsync('git', ['commit', '-m', 'chore: session initialized'], { cwd });
    }
  }

  /**
   * ワーキングツリーの変更をステージングしてコミットします。変更がない場合は null を返します。
   */
  static async commitChange(cwd: string, message: string): Promise<string | null> {
    try {
      // 変更があるか確認
      const { stdout: status } = await execFileAsync('git', ['status', '--porcelain'], { cwd });
      if (!status.trim()) {
        return null;
      }

      await execFileAsync('git', ['add', '-A'], { cwd });
      await execFileAsync('git', ['commit', '-m', message], { cwd });

      const { stdout: hash } = await execFileAsync('git', ['rev-parse', '--short', 'HEAD'], { cwd });
      return hash.trim();
    } catch (err: any) {
      // コミット失敗時もエージェントのメインループを落とさないようエラーログのみ
      return null;
    }
  }

  /**
   * 現在のワーキングツリーまたはコミット間の差分（diff）を取得します
   */
  static async getDiff(cwd: string, commitRef: string = 'HEAD'): Promise<string> {
    try {
      const { stdout } = await execFileAsync('git', ['diff', commitRef], { cwd });
      return stdout;
    } catch {
      return '';
    }
  }

  /**
   * コミット履歴を取得します
   */
  static async getCommitHistory(cwd: string, limit: number = 20): Promise<GitCommitInfo[]> {
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['log', `-${limit}`, '--format=%h|%s|%ct'],
        { cwd }
      );
      if (!stdout.trim()) return [];

      return stdout
        .trim()
        .split('\n')
        .map((line) => {
          const [hash, message, tsStr] = line.split('|');
          return {
            hash: hash || '',
            message: message || '',
            timestamp: Number(tsStr || '0') * 1000,
          };
        });
    } catch {
      return [];
    }
  }
}
