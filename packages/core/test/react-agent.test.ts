import { describe, it, expect } from 'vitest';
import { ReactAgent } from '../src/react-agent.js';
import { LoadedSkill } from '../src/types.js';
import { VirtualFS } from '../src/vfs/virtual-fs.js';

describe('ReactAgent', () => {
  const mockSkill: LoadedSkill = {
    name: 'game-generator',
    description: 'Game generator skill',
    skillDir: 'skills/game-generator',
    filePath: 'skills/game-generator/SKILL.md',
    frontmatter: {
      name: 'game-generator',
      description: 'Game generator skill',
    },
    instruction: 'Create single-file HTML5 Canvas game in index.html.',
  };

  it('runs ReAct loop with simulation when no API key is provided', async () => {
    const agent = new ReactAgent({ simulate: true });
    const vfs = new VirtualFS();

    const events: any[] = [];
    for await (const event of agent.execute('Space Shooter', mockSkill, vfs)) {
      events.push(event);
    }

    const types = events.map((e) => e.type);
    expect(types).toContain('THOUGHT');
    expect(types).toContain('TOOL_CALL');
    expect(types).toContain('FILE_CHANGED');
    expect(types).toContain('TOOL_RESULT');
    expect(types).toContain('COMPLETE');

    // VFS should contain index.html
    expect(vfs.hasFile('index.html')).toBe(true);
    const html = vfs.readFile('index.html');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Orbitron');

    const completeEvent = events.find((e) => e.type === 'COMPLETE');
    expect(completeEvent.payload.files['index.html']).toBeDefined();
    expect(completeEvent.payload.turns).toBeGreaterThan(0);
  });

  it('defaults maxTurns to 100 and allows custom maxTurns override', () => {
    const defaultAgent = new ReactAgent({ simulate: true });
    expect((defaultAgent as any).maxTurns).toBe(100);

    const customAgent = new ReactAgent({ simulate: true, maxTurns: 50 });
    expect((customAgent as any).maxTurns).toBe(50);
  });
});
