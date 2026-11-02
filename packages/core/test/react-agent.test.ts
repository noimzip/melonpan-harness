import { describe, it, expect } from 'vitest';
import { ReactAgent, resolveAdaptiveThinkingLevel } from '../src/react-agent.js';
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

  it('defaults maxTurns to 300 and allows custom maxTurns override', () => {
    const defaultAgent = new ReactAgent({ simulate: true });
    expect((defaultAgent as any).maxTurns).toBe(300);

    const customAgent = new ReactAgent({ simulate: true, maxTurns: 50 });
    expect((customAgent as any).maxTurns).toBe(50);
  });

  it('completes naturally without forcing an extra complete_task turn when tools have executed and model returns final text (#57)', async () => {
    let providerCalls = 0;
    const mockProvider = {
      name: 'mock-provider',
      async *streamChat() {
        providerCalls++;
        if (providerCalls === 1) {
          yield {
            type: 'tool_call' as const,
            toolCall: {
              id: 'call-1',
              name: 'write_file',
              args: {
                path: 'index.html',
                content: '<!DOCTYPE html><html><body><canvas id="game"></canvas></body></html>',
              },
            },
          };
          yield {
            type: 'usage' as const,
            usage: { promptTokens: 500, completionTokens: 120, totalTokens: 620, cachedPromptTokens: 0 },
          };
        } else {
          // Turn 2: Model returns final summary text directly without calling complete_task
          yield {
            type: 'text_delta' as const,
            delta: 'Completed the Neon Cyber Arcade game in index.html with 60fps loop.',
          };
          yield {
            type: 'usage' as const,
            usage: { promptTokens: 650, completionTokens: 30, totalTokens: 680, cachedPromptTokens: 450 },
          };
        }
      },
    };

    const agent = new ReactAgent({ provider: mockProvider as any, maxTurns: 10 });
    const vfs = new VirtualFS();
    const events: any[] = [];
    for await (const ev of agent.execute('Build neon game', mockSkill, vfs)) {
      events.push(ev);
    }

    expect(providerCalls).toBe(2);
    const completeEv = events.find((e) => e.type === 'COMPLETE');
    expect(completeEv).toBeDefined();
    expect(completeEv.payload.turns).toBe(2);
    expect(completeEv.payload.summary).toContain('Completed the Neon Cyber Arcade game');
    expect(vfs.hasFile('index.html')).toBe(true);
  });

  it('dynamically adjusts thinking effort across phases via resolveAdaptiveThinkingLevel (#60)', async () => {
    // 1. Initial design turn (turn 1) uses 'high'
    expect(resolveAdaptiveThinkingLevel({ configuredLevel: 'high', turn: 1 })).toBe('high');

    // 2. Routine read-only turn drops to 'low' to save reasoning tokens
    expect(
      resolveAdaptiveThinkingLevel({
        configuredLevel: 'high',
        turn: 2,
        lastToolNames: ['read_file', 'list_files'],
      })
    ).toBe('low');

    // 3. Routine write/edit turn uses balanced 'medium'
    expect(
      resolveAdaptiveThinkingLevel({
        configuredLevel: 'high',
        turn: 3,
        lastToolNames: ['edit_file'],
      })
    ).toBe('medium');

    // 4. Error or Quality Gate failure escalates back to 'high' for deep self-repair
    expect(
      resolveAdaptiveThinkingLevel({
        configuredLevel: 'high',
        turn: 4,
        lastToolNames: ['edit_file'],
        lastTurnHadError: true,
      })
    ).toBe('high');

    // 5. Explicit user setting ('minimal') is respected without override
    expect(
      resolveAdaptiveThinkingLevel({
        configuredLevel: 'minimal',
        turn: 1,
      })
    ).toBe('minimal');
  });
});
