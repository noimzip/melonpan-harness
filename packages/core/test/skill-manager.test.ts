import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  SkillManager,
  DEFAULT_ACTIVE_SKILL_NAMES,
} from '../src/skills/skill-manager.js';

describe('SkillManager', () => {
  const currentFile = fileURLToPath(import.meta.url);
  const skillsDir = path.resolve(path.dirname(currentFile), '../skills');

  it('indexes metadata from skills directory including modular kiosk skills', async () => {
    const manager = new SkillManager({ skillsDir });
    const indexed = await manager.loadAllMetadata();

    expect(indexed.length).toBeGreaterThanOrEqual(6);
    const names = indexed.map((s) => s.name);
    expect(names).toContain('game-generator');
    expect(names).toContain('anti-ai-slop');
    expect(names).toContain('responsive-design');
    expect(names).toContain('physics-engine');
    expect(names).toContain('threejs-3d');
    expect(names).toContain('game-architecture');
  });

  it('resolves skill and performs progressive disclosure (loads body on demand)', async () => {
    const manager = new SkillManager({ skillsDir });
    const loaded = await manager.resolveAndLoad('ブロック崩しゲームを作って');

    expect(loaded).toBeDefined();
    expect(loaded?.name).toBe('game-generator');
    expect(loaded?.instruction).toContain('Instructions for Game Generation');
    expect(loaded?.instruction).toContain('Orbitron');
  });

  it('activates default-on skills (anti-ai-slop, game-architecture, responsive-design) and dynamically adds physics-engine or threejs-3d based on prompt', async () => {
    const manager = new SkillManager({
      skillsDir,
      defaultSkills: [...DEFAULT_ACTIVE_SKILL_NAMES],
    });

    // 1. Standard non-physics, non-3D game prompt -> only the 3 default skills
    const baseSkills = await manager.resolveSkills('お寿司のカードめくり記憶パズル');
    expect(baseSkills.map((s) => s.name)).toEqual([
      'anti-ai-slop',
      'game-architecture',
      'responsive-design',
    ]);

    // 2. Physics-related prompt -> 3 default skills + physics-engine
    const physicsSkills = await manager.resolveSkills('重力と跳ね返りがあるボールのピンボールゲーム');
    expect(physicsSkills.map((s) => s.name)).toEqual([
      'anti-ai-slop',
      'game-architecture',
      'responsive-design',
      'physics-engine',
    ]);

    // 3. 3D-related prompt -> 3 default skills + threejs-3d
    const threeSkills = await manager.resolveSkills('Three.jsを使った立体3D宇宙船探索');
    expect(threeSkills.map((s) => s.name)).toEqual([
      'anti-ai-slop',
      'game-architecture',
      'responsive-design',
      'threejs-3d',
    ]);

    // 4. Combined resolveAndLoad merges active instructions cleanly (e.g., 3D Mario Kart with drift/turbo)
    const combined = await manager.resolveAndLoad(
      '3Dでマリオカート風のゲームを作ってほしい\n長押しドリフトで超加速する3段階ターボ'
    );
    expect(combined).toBeDefined();
    expect(combined?.name).toContain('anti-ai-slop');
    expect(combined?.name).toContain('game-architecture');
    expect(combined?.name).toContain('responsive-design');
    expect(combined?.name).toContain('threejs-3d');
    expect(combined?.name).toContain('physics-engine');
    expect(combined?.instruction).toContain('NO Default Cyber-Neon Palettes');
    expect(combined?.instruction).toContain('Smartphone Touch Controls');
    expect(combined?.instruction).toContain('Strict Velocity Clamping');
    expect(combined?.instruction).toContain('THREE.Group');
    expect(combined?.instruction).toContain('Direct Initial Creation');
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
