import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LoadedSkill, SkillMetadata } from '../types.js';
import { SkillParser } from './skill-parser.js';

export interface SkillManagerOptions {
  skillsDir?: string;
  defaultSkillName?: string;
}

/**
 * Agent Skills マネージャー
 * Progressive Disclosure（段階的情報開示）を担い、
 * 起動時は全スキルのメタデータのみをインデックス化し、
 * 入力に応じて合致したスキルの Markdown 本文のみをオンデマンドで注入します。
 */
export class SkillManager {
  private skillsDir: string;
  private defaultSkillName: string;
  private metadataIndex: Map<string, SkillMetadata> = new Map();
  // ブラウザ環境やテスト用に直接メモリ登録されたスキル
  private inMemorySkills: Map<string, { content: string; dirName: string }> = new Map();

  constructor(options: SkillManagerOptions = {}) {
    if (options.skillsDir) {
      this.skillsDir = options.skillsDir;
    } else {
      // packages/core/skills を解決
      try {
        const currentFile = fileURLToPath(import.meta.url);
        // src/skills/skill-manager.js -> ../../skills
        this.skillsDir = path.resolve(path.dirname(currentFile), '../../skills');
      } catch {
        this.skillsDir = path.resolve(process.cwd(), 'skills');
      }
    }
    this.defaultSkillName = options.defaultSkillName || 'game-generator';
  }

  /**
   * インメモリでスキルを直接登録（テストやブラウザ環境用）
   */
  registerInMemorySkill(dirName: string, rawSkillMdContent: string): void {
    this.inMemorySkills.set(dirName, { content: rawSkillMdContent, dirName });
    const parsed = SkillParser.parse(rawSkillMdContent, dirName);
    this.metadataIndex.set(parsed.frontmatter.name, {
      name: parsed.frontmatter.name,
      description: parsed.frontmatter.description,
      skillDir: dirName,
      filePath: path.join(dirName, 'SKILL.md'),
      frontmatter: parsed.frontmatter,
    });
  }

  /**
   * 指定したディレクトリ内のすべての SKILL.md からメタデータのみを読み込み、インデックス化する
   */
  async loadAllMetadata(customDir?: string): Promise<SkillMetadata[]> {
    const dirToScan = customDir || this.skillsDir;

    // Node.js fs でディレクトリを探索
    try {
      const entries = await fs.readdir(dirToScan, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillDirPath = path.join(dirToScan, entry.name);
          const skillFilePath = path.join(skillDirPath, 'SKILL.md');

          try {
            const stat = await fs.stat(skillFilePath);
            if (stat.isFile()) {
              const content = await fs.readFile(skillFilePath, 'utf-8');
              const parsed = SkillParser.parse(content, entry.name);

              this.metadataIndex.set(parsed.frontmatter.name, {
                name: parsed.frontmatter.name,
                description: parsed.frontmatter.description,
                skillDir: skillDirPath,
                filePath: skillFilePath,
                frontmatter: parsed.frontmatter,
              });
            }
          } catch (skillErr) {
            // SKILL.mdが存在しないディレクトリはスキップ
          }
        }
      }
    } catch (dirErr: any) {
      // ディレクトリが存在しない場合でも、インメモリ登録があれば継続
      if (this.metadataIndex.size === 0) {
        console.warn(`[SkillManager] Notice: Skills directory "${dirToScan}" not found or empty:`, dirErr?.message);
      }
    }

    return Array.from(this.metadataIndex.values());
  }

  /**
   * 現在インデックス化されているスキルメタデータ一覧を取得
   */
  getIndexedSkills(): SkillMetadata[] {
    return Array.from(this.metadataIndex.values());
  }

  /**
   * ユーザー入力プロンプトを評価し、最適なスキルを決定した上でその指示本文 (Markdown) をオンデマンド取得する
   */
  async resolveAndLoad(userInput: string): Promise<LoadedSkill | undefined> {
    if (this.metadataIndex.size === 0) {
      await this.loadAllMetadata();
    }

    const inputLower = userInput.toLowerCase();
    let matchedMeta: SkillMetadata | undefined;

    // 1. 各スキルの description や name, keywords とのマッチング
    for (const meta of this.metadataIndex.values()) {
      if (meta.name === 'game-generator') {
        const gameKeywords = [
          'ゲーム',
          'game',
          '作る',
          '作って',
          'create',
          'play',
          'action',
          'アクション',
          'シューティング',
          'パズル',
          'ブロック崩し',
          'canvas',
          '遊べる',
          'arcade',
          'jump',
          'ジャンプ',
        ];
        if (gameKeywords.some((kw) => inputLower.includes(kw))) {
          matchedMeta = meta;
          break;
        }
      }

      // 一般的な名前や説明文の部分一致
      if (inputLower.includes(meta.name.toLowerCase())) {
        matchedMeta = meta;
        break;
      }
    }

    // 2. マッチしなかった場合はデフォルトスキルにフォールバック
    if (!matchedMeta && this.metadataIndex.has(this.defaultSkillName)) {
      matchedMeta = this.metadataIndex.get(this.defaultSkillName);
    } else if (!matchedMeta && this.metadataIndex.size > 0) {
      matchedMeta = Array.from(this.metadataIndex.values())[0];
    }

    if (!matchedMeta) {
      return undefined;
    }

    // 3. オンデマンドで Markdown 本文（Instruction）を読み込む
    let instruction = '';
    if (this.inMemorySkills.has(matchedMeta.skillDir)) {
      const raw = this.inMemorySkills.get(matchedMeta.skillDir)!.content;
      const parsed = SkillParser.parse(raw, matchedMeta.skillDir);
      instruction = parsed.body;
    } else {
      const content = await fs.readFile(matchedMeta.filePath, 'utf-8');
      const parsed = SkillParser.parse(content, path.basename(matchedMeta.skillDir));
      instruction = parsed.body;
    }

    return {
      ...matchedMeta,
      instruction,
    };
  }
}
