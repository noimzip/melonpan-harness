import { SkillDefinition } from '../types.js';
import { gameGeneratorSkill } from './presets/game-generator.js';

export interface SkillManagerOptions {
  disablePresets?: boolean;
  defaultSkill?: SkillDefinition;
}

/**
 * スキルの動的登録・解決エンジン
 * 必要なコンテキストのみを遅延ロードし、トークン消費とAttention希釈を防ぎます。
 */
export class SkillManager {
  private skills: Map<string, SkillDefinition> = new Map();
  private defaultSkill?: SkillDefinition;

  constructor(options: SkillManagerOptions = {}) {
    if (!options.disablePresets) {
      this.register(gameGeneratorSkill);
      this.defaultSkill = gameGeneratorSkill;
    }
    if (options.defaultSkill) {
      this.defaultSkill = options.defaultSkill;
      this.register(options.defaultSkill);
    }
  }

  /**
   * スキルを登録する
   */
  register(skill: SkillDefinition): void {
    this.skills.set(skill.id, skill);
  }

  /**
   * スキルを登録解除する
   */
  unregister(id: string): boolean {
    return this.skills.delete(id);
  }

  /**
   * スキルIDからスキルを取得する
   */
  get(id: string): SkillDefinition | undefined {
    return this.skills.get(id);
  }

  /**
   * 登録済みスキル一覧を取得する
   */
  list(): SkillDefinition[] {
    return Array.from(this.skills.values());
  }

  /**
   * デフォルトスキルを設定する
   */
  setDefaultSkill(skill?: SkillDefinition): void {
    if (skill) {
      this.register(skill);
    }
    this.defaultSkill = skill;
  }

  /**
   * 入力プロンプトに最適なスキルを動的に解決する
   */
  async resolve(input: string): Promise<SkillDefinition | undefined> {
    for (const skill of this.skills.values()) {
      try {
        if (skill.matches(input)) {
          return skill;
        }
      } catch (err) {
        console.warn(`[SkillManager] Error matching skill "${skill.id}":`, err);
      }
    }
    // マッチしなかった場合はデフォルトスキルにフォールバック
    return this.defaultSkill;
  }
}
