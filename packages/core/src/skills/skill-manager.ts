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
      try {
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
      } catch {
        // vfs からの読み取りでパストラバーサルやENOENTが発生した場合はネイティブディスク探索（2）へ安全にフォールバック
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

/**
 * デフォルトで常時オンにする基本スキルセット（AI Slop防止、ゲーム構成、レスポンシブデザイン）
 */
export const DEFAULT_ACTIVE_SKILL_NAMES = [
  'anti-ai-slop',
  'game-architecture',
  'responsive-design',
] as const;

/**
 * プロンプト内容に応じて動的に有効化される拡張スキルセット（物理演算強化、3D Three.js強化）
 */
export const CONDITIONAL_SKILL_NAMES = [
  'physics-engine',
  'threejs-3d',
] as const;

export interface SkillManagerOptions {
  skillsDir?: string;
  defaultSkillName?: string;
  /** 常時有効化するデフォルトスキル名の配列（例: ['anti-ai-slop', 'game-architecture', 'responsive-design']） */
  defaultSkills?: string[];
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
  private defaultSkills: string[];
  private fallbackToDefault: boolean;
  private loader: ISkillLoader;
  private inMemoryLoader: InMemorySkillLoader;
  private metadataIndex: Map<string, SkillMetadata> = new Map();
  private disabledSkills: Set<string> = new Set();

  constructor(options: SkillManagerOptions = {}) {
    this.skillsDir = options.skillsDir;
    this.defaultSkillName = options.defaultSkillName;
    this.defaultSkills = options.defaultSkills ? [...options.defaultSkills] : [];
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
   * 常時有効なデフォルトスキル一覧を取得
   */
  getDefaultSkills(): string[] {
    return [...this.defaultSkills];
  }

  /**
   * 常時有効なデフォルトスキル一覧を設定
   */
  setDefaultSkills(skillNames: string[]): void {
    this.defaultSkills = [...skillNames];
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
   * デフォルト有効スキル群と、プロンプト内容に応じて動的にマッチする拡張スキル群を解決・ロードする
   */
  async resolveSkills(userInput: string): Promise<LoadedSkill[]> {
    if (this.metadataIndex.size === 0) {
      await this.loadAllMetadata();
    }

    const resolved: LoadedSkill[] = [];
    const seenNames = new Set<string>();

    // 1. 常時オンにするデフォルトスキルを決定（options.defaultSkills または metadata.defaultActive === "true"）
    const activeDefaultNames =
      this.defaultSkills.length > 0
        ? this.defaultSkills
        : Array.from(this.metadataIndex.values())
            .filter((m) => m.frontmatter.metadata?.defaultActive === 'true')
            .map((m) => m.name);

    for (const name of activeDefaultNames) {
      if (this.disabledSkills.has(name) || seenNames.has(name)) {
        continue;
      }
      const loaded = await this.activateSkill(name);
      if (loaded) {
        resolved.push(loaded);
        seenNames.add(loaded.name);
      }
    }

    // 2. 入力プロンプトに応じて条件付きスキル（physics-engine, threejs-3d 等）を動的に評価・追加
    const inputLower = userInput.toLowerCase().trim();
    if (inputLower) {
      const scoredConditional: Array<{ name: string; score: number }> = [];
      for (const meta of this.metadataIndex.values()) {
        if (this.disabledSkills.has(meta.name) || seenNames.has(meta.name)) {
          continue;
        }
        // モジュラーデフォルト群が有効な場合、旧式の単一 game-generator はネオン競合を避けるため除外
        if (resolved.length > 0 && meta.name === 'game-generator') {
          continue;
        }
        const score = this.computeSkillMatchScore(inputLower, meta, true);
        if (score > 0) {
          scoredConditional.push({ name: meta.name, score });
        }
      }

      scoredConditional.sort((a, b) => b.score - a.score);
      for (const item of scoredConditional) {
        const loaded = await this.activateSkill(item.name);
        if (loaded) {
          resolved.push(loaded);
          seenNames.add(loaded.name);
        }
      }
    }

    return resolved;
  }

  /**
   * 複数の LoadedSkill を1つの統合 LoadedSkill オブジェクトに合成する
   */
  combineLoadedSkills(skills: LoadedSkill[]): LoadedSkill | undefined {
    if (skills.length === 0) return undefined;
    if (skills.length === 1) return skills[0];

    const primary = skills[0]!;
    return {
      name: skills.map((s) => s.name).join(' + '),
      description: skills.map((s) => s.description).join(' | '),
      skillDir: primary.skillDir,
      filePath: skills.map((s) => s.filePath).join(', '),
      frontmatter: primary.frontmatter,
      instruction: skills
        .map(
          (s) =>
            `### [Skill Module: ${s.name}]\n${s.instruction.trim()}`
        )
        .join('\n\n---\n\n'),
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

    // defaultSkills が明示構成されている場合（Kiosk / Web ランタイム等）はマルチスキル解決を行う
    if (this.defaultSkills.length > 0) {
      const skills = await this.resolveSkills(userInput);
      return this.combineLoadedSkills(skills);
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

      const score = this.computeSkillMatchScore(inputLower, meta, false);
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
  private computeSkillMatchScore(
    inputLower: string,
    meta: SkillMetadata,
    forMultiSkillResolution = false
  ): number {
    let score = 0;
    const nameLower = meta.name.toLowerCase();

    // 1. スキル名の完全一致または部分一致
    if (inputLower.includes(nameLower)) {
      score += 10;
    }

    // 単一スキル解決モード（レガシー互換）において、モジュラースキルが名前指定なしで汎用 game-generator を上書きしないよう制御
    if (
      !forMultiSkillResolution &&
      this.defaultSkills.length === 0 &&
      !inputLower.includes(nameLower) &&
      this.metadataIndex.has('game-generator') &&
      !this.disabledSkills.has('game-generator')
    ) {
      if (meta.frontmatter.metadata?.defaultActive === 'true') {
        return 0;
      }
    }

    // 2. metadata.keywords / metadata.triggers の明示キーワード判定（プロンプト連動スキル用）
    const metaKeywordsRaw =
      meta.frontmatter.metadata?.keywords || meta.frontmatter.metadata?.triggers || '';
    const metaKeywords = metaKeywordsRaw
      ? metaKeywordsRaw
          .toLowerCase()
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

    for (const kw of metaKeywords) {
      if (inputLower.includes(kw)) {
        score += 4;
      }
    }

    // metadata.keywords が定義されている条件付き専門スキル (physics-engine, threejs-3d 等) は、
    // スキル名または専門キーワード (metaKeywords) に1つ以上ヒットした場合のみ有効化する（単なる "game" 等の一般語での誤爆を防止）
    if (metaKeywords.length > 0 && score === 0) {
      return 0;
    }

    // 3. スキル名のハイフン分割トークン (例: "game", "generator") および description 内の主要語彙
    const stopWords = new Set([
      'the', 'and', 'for', 'with', 'use', 'when', 'user', 'asks', 'wants', 'from', 'that', 'this', 'into', 'are', 'high', 'quality', 'single', 'file', 'games', 'game', 'build', 'building', 'create',
    ]);
    const descWords = meta.description
      .toLowerCase()
      .split(/[^a-z0-9\u3040-\u30ff\u4e00-\u9faf]+/)
      .filter((w) => w.length >= 3 && !stopWords.has(w));

    const nameTokens = nameLower.split('-').filter((w) => w.length >= 3);

    // 英語・日本語の汎用概念シノニム辞書 (スキル説明文に該当概念が含まれる場合に多言語マッチを補助)
    const conceptSynonyms: Record<string, string[]> = {
      game: ['ゲーム', 'ブロック崩し', 'シューティング', 'アクション', 'パズル', 'アーケード', 'arcade', 'shooter', 'platformer', 'breakout'],
      canvas: ['キャンバス', '2d', 'html5'],
      play: ['遊べる', 'プレイ'],
    };

    const candidateTokens = new Set<string>([...nameTokens, ...descWords]);
    if (meta.description.toLowerCase().includes('game')) {
      candidateTokens.add('game');
    }
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

    // 単一スキル解決モードで game-generator が有効な場合のタイブレーク優先度
    if (
      !forMultiSkillResolution &&
      this.defaultSkills.length === 0 &&
      meta.name === 'game-generator' &&
      score > 0
    ) {
      score += 15;
    }

    return score;
  }
}
