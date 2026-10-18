import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { SkillManager } from '../src/skills/skill-manager.js';

describe('SkillManager', () => {
  const currentFile = fileURLToPath(import.meta.url);
  const skillsDir = path.resolve(path.dirname(currentFile), '../skills');

  it('indexes metadata from skills directory', async () => {
    const manager = new SkillManager({ skillsDir });
    const indexed = await manager.loadAllMetadata();

    expect(indexed.length).toBeGreaterThan(0);
    const gameGen = indexed.find((s) => s.name === 'game-generator');
    expect(gameGen).toBeDefined();
    expect(gameGen?.description).toContain('HTML5 Canvas');
  });

  it('resolves skill and performs progressive disclosure (loads body on demand)', async () => {
    const manager = new SkillManager({ skillsDir });
    const loaded = await manager.resolveAndLoad('ブロック崩しゲームを作って');

    expect(loaded).toBeDefined();
    expect(loaded?.name).toBe('game-generator');
    expect(loaded?.instruction).toContain('Instructions for Game Generation');
    expect(loaded?.instruction).toContain('Orbitron');
  });

  it('supports in-memory skill registration for browser/test environments', async () => {
    const manager = new SkillManager();
    const inMemContent = `---
name: custom-assistant
description: Assisting users with tasks
---
# Custom Instructions
Do great work.
`;
    manager.registerInMemorySkill('custom-assistant', inMemContent);

    const indexed = manager.getIndexedSkills();
    expect(indexed.some((s) => s.name === 'custom-assistant')).toBe(true);

    const loaded = await manager.resolveAndLoad('custom-assistant help');
    expect(loaded?.name).toBe('custom-assistant');
    expect(loaded?.instruction).toBe('# Custom Instructions\nDo great work.');
  });
});
