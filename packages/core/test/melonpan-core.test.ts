import { describe, it, expect } from 'vitest';
import { MelonpanCore } from '../src/index.js';
import { MockLLMProvider } from '../src/providers/mock.js';

describe('MelonpanCore', () => {
  it('instantiates properly with options', () => {
    const core = new MelonpanCore({
      apiKey: 'test-key',
      model: 'gemini-3.8-flash',
    });

    expect(core.getSkillManager()).toBeDefined();
    expect(core.getProvider()).toBeDefined();
    expect(core.getValidator()).toBeDefined();
  });

  it('runs event stream as specified in design doc', async () => {
    const mockProvider = new MockLLMProvider();
    const core = new MelonpanCore({
      provider: mockProvider,
    });

    const eventStream = core.run('宇宙を舞台にしたジャンプアクションゲーム');
    const receivedEvents: string[] = [];
    let streamedCode = '';

    for await (const event of eventStream) {
      receivedEvents.push(event.type);
      switch (event.type) {
        case 'SKILL_LOADED':
          expect(event.payload.name).toBeDefined();
          break;
        case 'CODE_CHUNK':
          streamedCode += event.payload;
          break;
        case 'COMPLETE':
          expect(event.payload.html).toContain('<!DOCTYPE html>');
          break;
      }
    }

    expect(receivedEvents).toContain('SKILL_LOADED');
    expect(receivedEvents).toContain('CODE_CHUNK');
    expect(receivedEvents).toContain('COMPLETE');
    expect(streamedCode.length).toBeGreaterThan(100);
  });
});
