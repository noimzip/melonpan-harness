import { describe, it, expect } from 'vitest';
import {
  AVAILABLE_MODELS,
  THINKING_LEVELS,
  MelonpanCore,
  ReactAgent,
} from '../src/index.js';

describe('Models and Thinking Levels (Effort)', () => {
  it('defines the 4 required models and thinking levels correctly', () => {
    expect(AVAILABLE_MODELS).toEqual([
      'gemma-4-31b-it',
      'gemini-4-argon',
      'gemini-3.8-flash',
      'gemini-3.5-flash-lite',
    ]);

    expect(THINKING_LEVELS).toEqual(['minimal', 'low', 'medium', 'high']);
  });

  it('allows MelonpanCore to be initialized with any available model and thinking level', () => {
    for (const model of AVAILABLE_MODELS) {
      for (const effort of THINKING_LEVELS) {
        const core = new MelonpanCore({
          model,
          thinkingLevel: effort,
          simulate: true,
        });
        expect(core).toBeInstanceOf(MelonpanCore);
      }
    }
  });

  it('runs simulation with custom model and effort', async () => {
    const core = new MelonpanCore({
      model: 'gemini-4-argon',
      thinkingLevel: 'medium',
      simulate: true,
      mode: 'plan',
    });

    const events = [];
    for await (const event of core.run('Test game')) {
      events.push(event);
    }

    expect(events.length).toBeGreaterThan(0);
    const complete = events.find((e) => e.type === 'COMPLETE');
    expect(complete).toBeDefined();
  });
});
