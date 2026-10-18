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
});
