import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { MelonpanCore } from '../src/index.js';

describe('MelonpanCore Facade', () => {
  const currentFile = fileURLToPath(import.meta.url);
  const skillsDir = path.resolve(path.dirname(currentFile), '../skills');

  it('runs complete lifecycle yielding SKILL_INDEXED, SKILL_LOADED, and ReAct events', async () => {
    const core = new MelonpanCore({
      skillsDir,
      simulate: true,
    });

    const events: any[] = [];
    for await (const event of core.run('ネオンサイバーなブロック崩しゲーム')) {
      events.push(event);
    }

    const types = events.map((e) => e.type);
    expect(types).toContain('SKILL_INDEXED');
    expect(types).toContain('SKILL_LOADED');
    expect(types).toContain('THOUGHT');
    expect(types).toContain('TOOL_CALL');
    expect(types).toContain('FILE_CHANGED');
    expect(types).toContain('TOOL_RESULT');
    expect(types).toContain('COMPLETE');

    const vfsFiles = core.getVirtualFiles();
    expect(vfsFiles['index.html']).toBeDefined();
    expect(vfsFiles['index.html']).toContain('<!DOCTYPE html>');
  });

  it('dynamically resolves and updates context window on setModel without explicit override', () => {
    const core = new MelonpanCore({
      model: 'gemini-3.8-flash',
      simulate: true,
    });
    expect((core.getAgent() as any).maxContextTokens).toBe(1_048_576);
    expect((core.getSession() as any).maxContextTokens).toBe(1_048_576);

    core.getAgent().setModel('gpt-4o');
    core.getSession().setModel('gpt-4o');
    expect((core.getAgent() as any).maxContextTokens).toBe(128_000);
    expect((core.getSession() as any).maxContextTokens).toBe(128_000);

    core.getAgent().setModel('claude-3-7-sonnet');
    core.getSession().setModel('claude-3-7-sonnet');
    expect((core.getAgent() as any).maxContextTokens).toBe(200_000);
    expect((core.getSession() as any).maxContextTokens).toBe(200_000);
  });
});
