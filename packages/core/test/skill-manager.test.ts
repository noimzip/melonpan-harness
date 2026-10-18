import { describe, it, expect } from 'vitest';
import { SkillManager } from '../src/skills/skill-manager.js';
import { SkillDefinition } from '../src/types.js';

describe('SkillManager', () => {
  it('registers presets by default', () => {
    const manager = new SkillManager();
    const skills = manager.list();
    expect(skills.length).toBeGreaterThan(0);
    expect(manager.get('game-generator')).toBeDefined();
  });

  it('can disable presets', () => {
    const manager = new SkillManager({ disablePresets: true });
    expect(manager.list().length).toBe(0);
    expect(manager.get('game-generator')).toBeUndefined();
  });

  it('registers and unregisters custom skills', () => {
    const manager = new SkillManager({ disablePresets: true });
    const customSkill: SkillDefinition = {
      id: 'custom-skill',
      name: 'Custom Skill',
      description: 'A test skill',
      matches: (input) => input.includes('custom'),
      getInstruction: async () => 'Custom instruction',
    };

    manager.register(customSkill);
    expect(manager.get('custom-skill')).toBe(customSkill);

    const unregistered = manager.unregister('custom-skill');
    expect(unregistered).toBe(true);
    expect(manager.get('custom-skill')).toBeUndefined();
  });

  it('resolves matching skill based on input', async () => {
    const manager = new SkillManager();
    const resolved = await manager.resolve('宇宙を舞台にしたジャンプゲームを作って');
    expect(resolved).toBeDefined();
    expect(resolved?.id).toBe('game-generator');
  });

  it('falls back to default skill when input does not match other skills', async () => {
    const manager = new SkillManager();
    const resolved = await manager.resolve('こんにちは世界');
    // デフォルトプリセットにフォールバック
    expect(resolved?.id).toBe('game-generator');
  });
});
