import {
  IFileSystem,
  ISkillLoader,
  LoadedSkill,
  SkillMetadata,
} from '../types.js';
import { SkillParser } from './skill-parser.js';

/**
 * 1. InMemorySkillLoader: ブラウザ環境やテスト用のメモリ内スキルローダー (#24, #20)
 */
export class InMemorySkillLoader implements ISkillLoader {
  private rawSkills: Map<string, { content: string; dirName: string }> = new Map();
  private metadataCache: Map<string, SkillMetadata> = new Map();

  registerSkill(dirName: string, rawSkillMdContent: string): SkillMetadata {
    this.rawSkills.set(dirName, { content: rawSkillMdContent, dirName });
    const parsed = SkillParser.parse(rawSkillMdContent, dirName);
    const meta: SkillMetadata = {
      name: parsed.frontmatter.name,
      description: parsed.frontmatter.description,
      skillDir: dirName,
      filePath: `${dirName}/SKILL.md`,
      frontmatter: parsed.frontmatter,
    };
    this.metadataCache.set(meta.name, meta);
    return meta;
  }

  hasSkill(dirOrName: string): boolean {
    return this.rawSkills.has(dirOrName) || this.metadataCache.has(dirOrName);
  }

  async loadAllMetadata(): Promise<SkillMetadata[]> {
    return Array.from(this.metadataCache.values());
  }

  async loadSkillBody(meta: SkillMetadata): Promise<string> {
    const entry =
      this.rawSkills.get(meta.skillDir) || this.rawSkills.get(meta.name);
    if (!entry) {
      throw new Error(`In-memory skill "${meta.name}" not found.`);
    }
    const parsed = SkillParser.parse(entry.content, entry.dirName);
    return parsed.body;
  }
}

/**
 * 2. FileSystemSkillLoader: Node.js fs または IFileSystem 経由で `skills/<name>/SKILL.md` を走査するローダー (#24, #20)
 */
export class FileSystemSkillLoader implements ISkillLoader {
  private skillsDir?: string;
  private vfs?: IFileSystem;
  private bodyCache: Map<string, string> = new Map();

  constructor(options: { skillsDir?: string; fs?: IFileSystem } = {}) {
    this.skillsDir = options.skillsDir;
    this.vfs = options.fs;
  }

  private async resolveDefaultSkillsDir(): Promise<string> {
    if (this.skillsDir) return this.skillsDir;
    try {
      const path = await import('node:path');
      const { fileURLToPath } = await import('node:url');
      const currentFile = fileURLToPath(import.meta.url);
      return path.resolve(path.dirname(currentFile), '../../skills');
    } catch {
      return 'skills';
    }
  }

  async loadAllMetadata(customDir?: string): Promise<SkillMetadata[]> {
    const results: SkillMetadata[] = [];

    // 1. IFileSystem が注入されている場合はそちらから探索可能
    if (this.vfs) {
      const dirPrefix = customDir || this.skillsDir || 'skills';
      const files = await this.vfs.listFiles(dirPrefix, { pattern: '**/SKILL.md' });
      for (const filePath of files) {
        const content = await this.vfs.readFile(filePath);
        if (!content) continue;
        const segments = filePath.replace(/\\/g, '/').split('/');
        const dirName = segments.length >= 2 ? segments[segments.length - 2]! : segments[0]!;
        const skillDir = segments.slice(0, -1).join('/');
        try {
          const parsed = SkillParser.parse(content, dirName);
          this.bodyCache.set(parsed.frontmatter.name, parsed.body);
          results.push({
            name: parsed.frontmatter.name,
            description: parsed.frontmatter.description,
            skillDir,
            filePath,
            frontmatter: parsed.frontmatter,
          });
        } catch {
          // 無効なSKILL.mdはスキップ
        }
      }
      if (results.length > 0) {
        return results;
      }
    }

    // 2. Node.js fs/promises の動的インポートによるローカルディレクトリ走査
    try {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      const dirToScan = customDir || (await this.resolveDefaultSkillsDir());
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
              this.bodyCache.set(parsed.frontmatter.name, parsed.body);
              results.push({
                name: parsed.frontmatter.name,
                description: parsed.frontmatter.description,
                skillDir: skillDirPath,
                filePath: skillFilePath,
                frontmatter: parsed.frontmatter,
              });
            }
          } catch {
            // SKILL.md が存在しないサブディレクトリはスキップ
          }
        }
      }
    } catch {
      // ブラウザ環境またはディレクトリ不在時は空配列で安全に継続
    }

    return results;
  }

  async loadSkillBody(meta: SkillMetadata): Promise<string> {
    if (this.bodyCache.has(meta.name)) {
      return this.bodyCache.get(meta.name)!;
    }

    if (this.vfs) {
      const content = await this.vfs.readFile(meta.filePath);
      if (content !== undefined) {
        const dirName = meta.skillDir.split(/[/\\]/).pop();
        const parsed = SkillParser.parse(content, dirName);
        this.bodyCache.set(meta.name, parsed.body);
        return parsed.body;
      }
    }

    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const content = await fs.readFile(meta.filePath, 'utf-8');
    const parsed = SkillParser.parse(content, path.basename(meta.skillDir));
    this.bodyCache.set(meta.name, parsed.body);
    return parsed.body;
  }
}

export interface SkillManagerOptions {
  skillsDir?: string;
  defaultSkillName?: string;
  loader?: ISkillLoader;
  fs?: IFileSystem;
  /** マッチしない入力時に defaultSkillName へ強制フォールバックするか（デフォルト: false で Generalist モードを優先 #15） */
  fallbackToDefault?: boolean;
}

/**
 * Agent Skills マネージャー (#24, #15, #20)
 * - `ISkillLoader` アダプター（`FileSystemSkillLoader` / `InMemorySkillLoader`）による環境非依存のスキル取得
 * - `activateSkill(name)` によるオンデマンド本文ロード（Progressive Disclosure）
 * - ハードコードされた `game-generator` 専用分岐を排除し、各スキルの `name` / `description` / `metadata` トークンに基づいた汎用マッチングを実装 (#15)
 */
export class SkillManager {
  private skillsDir?: string;
  private defaultSkillName?: string;
  private fallbackToDefault: boolean;
  private loader: ISkillLoader;
  private inMemoryLoader: InMemorySkillLoader;
  private metadataIndex: Map<string, SkillMetadata> = new Map();
  private disabledSkills: Set<string> = new Set();

  constructor(options: SkillManagerOptions = {}) {
    this.skillsDir = options.skillsDir;
    this.defaultSkillName = options.defaultSkillName;
    this.fallbackToDefault = options.fallbackToDefault ?? false;
    this.inMemoryLoader = new InMemorySkillLoader();
    this.loader =
      options.loader ??
      new FileSystemSkillLoader({
        skillsDir: options.skillsDir,
        fs: options.fs,
      });
  }

  /**
   * インメモリでスキルを直接登録（テストやブラウザ環境用）
   */
  registerInMemorySkill(dirName: string, rawSkillMdContent: string): void {
    const meta = this.inMemoryLoader.registerSkill(dirName, rawSkillMdContent);
    this.metadataIndex.set(meta.name, meta);
  }

  /**
   * 指定したディレクトリまたはローダー内のすべての SKILL.md からメタデータのみを読み込み、インデックス化する
   */
  async loadAllMetadata(customDir?: string): Promise<SkillMetadata[]> {
    const loadedFromAdapter = await this.loader.loadAllMetadata(customDir || this.skillsDir);
    for (const meta of loadedFromAdapter) {
      this.metadataIndex.set(meta.name, meta);
    }

    const loadedInMem = await this.inMemoryLoader.loadAllMetadata();
    for (const meta of loadedInMem) {
      this.metadataIndex.set(meta.name, meta);
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
   * 有効なスキルメタデータ一覧のみを取得（PromptComposer カタログ注入用 #51, #24）
   */
  getEnabledSkills(): SkillMetadata[] {
    return Array.from(this.metadataIndex.values()).filter(
      (meta) => !this.disabledSkills.has(meta.name)
    );
  }

  /**
   * 指定したスキルを有効化する
   */
  enableSkill(name: string): boolean {
    if (!this.metadataIndex.has(name)) {
      return false;
    }
    this.disabledSkills.delete(name);
    return true;
  }

  /**
   * 指定したスキルを無効化する
   */
  disableSkill(name: string): boolean {
    if (!this.metadataIndex.has(name)) {
      return false;
    }
    this.disabledSkills.add(name);
    return true;
  }

  /**
   * 指定したスキルが有効か判定
   */
  isSkillEnabled(name: string): boolean {
    return !this.disabledSkills.has(name);
  }

  /**
   * 全スキルのステータス（有効/無効）を取得
   */
  getSkillsStatus(): Array<SkillMetadata & { enabled: boolean }> {
    return Array.from(this.metadataIndex.values()).map((meta) => ({
      ...meta,
      enabled: !this.disabledSkills.has(meta.name),
    }));
  }

  /**
   * スキル名を明示指定してオンデマンドで本文 (Markdown) をロードする (`activate_skill` ツール用 #24)
   */
  async activateSkill(name: string): Promise<LoadedSkill | undefined> {
    if (this.metadataIndex.size === 0) {
      await this.loadAllMetadata();
    }

    const meta = this.metadataIndex.get(name);
    if (!meta || this.disabledSkills.has(name)) {
      return undefined;
    }

    const instruction = this.inMemoryLoader.hasSkill(meta.skillDir) || this.inMemoryLoader.hasSkill(meta.name)
      ? await this.inMemoryLoader.loadSkillBody(meta)
      : await this.loader.loadSkillBody(meta);

    return {
      ...meta,
      instruction,
    };
  }

  /**
   * ユーザー入力プロンプトを評価し、合致するスキルがあればその指示本文 (Markdown) をオンデマンド取得する (#15)
   * 合致しない場合は無条件に特定スキルへ強制フォールバックせず、`undefined`（General Autonomous Agent モード）を返す。
   */
  async resolveAndLoad(userInput: string): Promise<LoadedSkill | undefined> {
    if (this.metadataIndex.size === 0) {
      await this.loadAllMetadata();
    }

    const inputLower = userInput.toLowerCase().trim();
    if (!inputLower) {
      return undefined;
    }

    let bestMatch: { meta: SkillMetadata; score: number } | undefined;

    for (const meta of this.metadataIndex.values()) {
      if (this.disabledSkills.has(meta.name)) {
        continue;
      }

      const score = this.computeSkillMatchScore(inputLower, meta);
      if (score > 0 && (!bestMatch || score > bestMatch.score)) {
        bestMatch = { meta, score };
      }
    }

    let matchedMeta = bestMatch?.meta;

    // 明示的に fallbackToDefault が設定されている場合のみデフォルトスキルへフォールバック
    if (
      !matchedMeta &&
      this.fallbackToDefault &&
      this.defaultSkillName &&
      this.metadataIndex.has(this.defaultSkillName) &&
      !this.disabledSkills.has(this.defaultSkillName)
    ) {
      matchedMeta = this.metadataIndex.get(this.defaultSkillName);
    }

    if (!matchedMeta) {
      return undefined;
    }

    return this.activateSkill(matchedMeta.name);
  }

  /**
   * スキルの name, description, metadata に基づいて入力プロンプトとの関連度スコアを汎用算出する (#15)
   */
  private computeSkillMatchScore(inputLower: string, meta: SkillMetadata): number {
    let score = 0;
    const nameLower = meta.name.toLowerCase();

    // 1. スキル名の完全一致または部分一致
    if (inputLower.includes(nameLower)) {
      score += 10;
    }

    // 2. スキル名のハイフン分割トークン (例: "game", "generator") および description 内の主要語彙
    const stopWords = new Set([
      'the', 'and', 'for', 'with', 'use', 'when', 'user', 'asks', 'wants', 'from', 'that', 'this', 'into', 'are', 'high', 'quality', 'single', 'file',
    ]);
    const descWords = meta.description
      .toLowerCase()
      .split(/[^a-z0-9\u3040-\u30ff\u4e00-\u9faf]+/)
      .filter((w) => w.length >= 3 && !stopWords.has(w));

    const nameTokens = nameLower.split('-').filter((w) => w.length >= 3);
    const metaTriggers = meta.frontmatter.metadata?.triggers
      ? meta.frontmatter.metadata.triggers.toLowerCase().split(',').map((s) => s.trim())
      : [];

    // 英語・日本語の汎用概念シノニム辞書 (スキル説明文に該当概念が含まれる場合に多言語マッチを補助)
    const conceptSynonyms: Record<string, string[]> = {
      game: ['ゲーム', 'ブロック崩し', 'シューティング', 'アクション', 'パズル', 'アーケード', 'arcade', 'shooter', 'platformer', 'breakout'],
      canvas: ['キャンバス', '2d', 'html5'],
      play: ['遊べる', 'プレイ'],
    };

    const candidateTokens = new Set<string>([...nameTokens, ...descWords, ...metaTriggers]);
    for (const token of Array.from(candidateTokens)) {
      if (conceptSynonyms[token]) {
        for (const syn of conceptSynonyms[token]!) {
          candidateTokens.add(syn);
        }
      }
    }

    for (const token of candidateTokens) {
      if (token && inputLower.includes(token)) {
        score += 2;
      }
    }

    return score;
  }
}
