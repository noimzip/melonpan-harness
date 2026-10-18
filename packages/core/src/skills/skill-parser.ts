import { load as yamlLoad } from 'js-yaml';
import { SkillFrontmatter } from '../types.js';

export interface ParsedSkill {
  frontmatter: SkillFrontmatter;
  body: string;
}

/**
 * Agent Skills標準仕様 (agentskills.io) 準拠の SKILL.md パーサー
 */
export class SkillParser {
  /**
   * SKILL.md の文字列コンテンツから Frontmatter と Markdown Body を分離・検証してパースする
   *
   * @param content SKILL.md の生テキスト
   * @param expectedDirName スキルディレクトリ名 (name との一致検証用)
   */
  static parse(content: string, expectedDirName?: string): ParsedSkill {
    const trimmed = content.trimStart();
    if (!trimmed.startsWith('---')) {
      throw new Error('Invalid SKILL.md: File must start with YAML frontmatter delimiter "---"');
    }

    const firstDelimiterEnd = trimmed.indexOf('\n');
    if (firstDelimiterEnd === -1) {
      throw new Error('Invalid SKILL.md: Missing content after opening "---"');
    }

    const closingDelimiterIndex = trimmed.indexOf('\n---', firstDelimiterEnd);
    if (closingDelimiterIndex === -1) {
      throw new Error('Invalid SKILL.md: Missing closing YAML frontmatter delimiter "---"');
    }

    const rawYaml = trimmed.slice(firstDelimiterEnd + 1, closingDelimiterIndex).trim();
    // 閉じデリミタの後ろ（改行含む）がMarkdown本文
    const afterClosing = trimmed.indexOf('\n', closingDelimiterIndex + 4);
    const body = afterClosing !== -1 ? trimmed.slice(afterClosing + 1).trim() : '';

    let parsed: any;
    try {
      parsed = yamlLoad(rawYaml);
    } catch (err: any) {
      throw new Error(`Invalid YAML frontmatter in SKILL.md: ${err?.message || err}`);
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Invalid SKILL.md: Frontmatter must be a valid YAML object');
    }

    // --- Agent Skills 仕様 制約バリデーション ---

    // 1. name: 必須, 1〜64文字, 小文字英数字とハイフンのみ (連続ハイフン不可、先頭末尾ハイフン不可)
    if (!parsed.name || typeof parsed.name !== 'string') {
      throw new Error('Invalid SKILL.md: "name" field is required and must be a string');
    }
    const name = parsed.name.trim();
    if (name.length > 64) {
      throw new Error(`Invalid SKILL.md: "name" exceeds maximum length of 64 characters (got ${name.length})`);
    }
    const nameRegex = /^[a-z0-9]+(-[a-z0-9]+)*$/;
    if (!nameRegex.test(name)) {
      throw new Error(
        `Invalid SKILL.md: "name" must consist only of lowercase alphanumeric characters and single hyphens, without leading/trailing hyphens (got "${name}")`
      );
    }

    // ディレクトリ名との一致確認
    if (expectedDirName && name !== expectedDirName) {
      throw new Error(
        `Invalid SKILL.md: Skill "name" ("${name}") must match parent directory name ("${expectedDirName}")`
      );
    }

    // 2. description: 必須, 1〜1024文字, 非空
    if (!parsed.description || typeof parsed.description !== 'string') {
      throw new Error('Invalid SKILL.md: "description" field is required and must be a non-empty string');
    }
    const description = parsed.description.trim();
    if (description.length === 0) {
      throw new Error('Invalid SKILL.md: "description" cannot be empty');
    }
    if (description.length > 1024) {
      throw new Error(
        `Invalid SKILL.md: "description" exceeds maximum length of 1024 characters (got ${description.length})`
      );
    }

    // 3. license, compatibility, metadata の任意フィールド
    const frontmatter: SkillFrontmatter = {
      name,
      description,
      license: typeof parsed.license === 'string' ? parsed.license.slice(0, 500) : undefined,
      compatibility: typeof parsed.compatibility === 'string' ? parsed.compatibility.slice(0, 500) : undefined,
      metadata: typeof parsed.metadata === 'object' && parsed.metadata !== null ? parsed.metadata : undefined,
      'allowed-tools': typeof parsed['allowed-tools'] === 'string' ? parsed['allowed-tools'] : undefined,
    };

    return {
      frontmatter,
      body,
    };
  }
}
