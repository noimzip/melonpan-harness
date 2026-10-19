import { describe, it, expect } from 'vitest';
import { MelonpanCore, SkillManager } from '../src/index.js';

describe('SkillManager enable/disable and Usage tracking', () => {
  it('manages enabled and disabled skill status correctly', async () => {
    const sm = new SkillManager();
    await sm.loadAllMetadata();

    const initialStatus = sm.getSkillsStatus();
    expect(initialStatus.length).toBeGreaterThan(0);
    expect(initialStatus.every((s) => s.enabled)).toBe(true);

    // Disable game-generator
    const disabled = sm.disableSkill('game-generator');
    expect(disabled).toBe(true);
    expect(sm.isSkillEnabled('game-generator')).toBe(false);

    // Re-enable
    const enabled = sm.enableSkill('game-generator');
    expect(enabled).toBe(true);
    expect(sm.isSkillEnabled('game-generator')).toBe(true);
  });

  it('skips disabled skill during resolveAndLoad', async () => {
    const sm = new SkillManager();
    await sm.loadAllMetadata();

    sm.disableSkill('game-generator');
    const resolved = await sm.resolveAndLoad('Create a neon game');
    // Since game-generator is disabled, it should either be undefined or another skill
    if (resolved) {
      expect(resolved.name).not.toBe('game-generator');
    } else {
      expect(resolved).toBeUndefined();
    }
  });

  it('emits usage in COMPLETE event payload during agent execution', async () => {
    const core = new MelonpanCore({
      simulate: true,
      mode: 'plan',
    });

    let completeEvent: any = null;
    for await (const event of core.run('Test neon arcade')) {
      if (event.type === 'COMPLETE') {
        completeEvent = event;
      }
    }

    expect(completeEvent).toBeDefined();
    expect(completeEvent.payload.usage).toBeDefined();
    expect(completeEvent.payload.usage.promptTokens).toBeGreaterThan(0);
    expect(completeEvent.payload.usage.completionTokens).toBeGreaterThan(0);
    expect(completeEvent.payload.usage.totalTokens).toBe(
      completeEvent.payload.usage.promptTokens + completeEvent.payload.usage.completionTokens
    );
  });

  it('runs successfully in General Autonomous Agent mode without error when all skills are disabled', async () => {
    const sm = new SkillManager();
    await sm.loadAllMetadata();

    // Disable all skills
    for (const skill of sm.getIndexedSkills()) {
      sm.disableSkill(skill.name);
    }
    expect(sm.getSkillsStatus().every((s) => !s.enabled)).toBe(true);

    const core = new MelonpanCore({
      simulate: true,
      mode: 'auto',
      skillManager: sm,
    });

    const events: any[] = [];
    for await (const event of core.run('aa')) {
      events.push(event);
    }

    const types = events.map((e) => e.type);
    expect(types).not.toContain('ERROR');
    expect(types).not.toContain('SKILL_LOADED');
    expect(types).toContain('SKILL_INDEXED');
    expect(types).toContain('THOUGHT');
    expect(types).toContain('COMPLETE');

    const thoughts = events
      .filter((e) => e.type === 'THOUGHT')
      .map((e) => e.payload.thought);
    expect(
      thoughts.some((t) =>
        t.includes('No matching or active skills found') ||
        t.includes('General Autonomous Agent')
      )
    ).toBe(true);
  });
});
