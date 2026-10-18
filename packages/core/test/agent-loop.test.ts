import { describe, it, expect } from 'vitest';
import { AgentLoop } from '../src/agent-loop.js';
import { SkillManager } from '../src/skills/skill-manager.js';
import { MockLLMProvider } from '../src/providers/mock.js';
import { HtmlValidator } from '../src/validator/html-validator.js';
import { AgentEvent } from '../src/types.js';

describe('AgentLoop', () => {
  const validHtml = `<!DOCTYPE html>
<html>
<head><title>Loop Test</title></head>
<body>
  <canvas id="c"></canvas>
  <script>
    requestAnimationFrame(() => {});
    window.addEventListener('click', () => {});
  </script>
</body>
</html>`;

  it('runs complete lifecycle on valid generation', async () => {
    const skillManager = new SkillManager();
    const provider = new MockLLMProvider({
      responses: [validHtml],
    });
    const validator = new HtmlValidator();
    const loop = new AgentLoop(skillManager, provider, validator);

    const events: AgentEvent[] = [];
    for await (const event of loop.run('ブロック崩しゲームを作って')) {
      events.push(event);
    }

    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toContain('SKILL_LOADED');
    expect(eventTypes).toContain('THINKING');
    expect(eventTypes).toContain('CODE_CHUNK');
    expect(eventTypes).toContain('VALIDATING');
    expect(eventTypes).toContain('COMPLETE');
    expect(eventTypes).not.toContain('REPAIRING');
    expect(eventTypes).not.toContain('ERROR');

    const completeEvent = events.find((e) => e.type === 'COMPLETE');
    expect(completeEvent?.payload.attempts).toBe(1);
    expect(completeEvent?.payload.html).toContain('<canvas id="c">');
  });

  it('executes auto-repair loop when validation fails initially', async () => {
    const brokenHtml = `<!DOCTYPE html><html><body><canvas></canvas><script>const a = ;</script></body></html>`;

    const skillManager = new SkillManager();
    const provider = new MockLLMProvider({
      responses: [brokenHtml, validHtml],
    });
    const validator = new HtmlValidator();
    const loop = new AgentLoop(skillManager, provider, validator, {
      maxRepairs: 2,
    });

    const events: AgentEvent[] = [];
    for await (const event of loop.run('落ちものパズルゲーム')) {
      events.push(event);
    }

    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toContain('SKILL_LOADED');
    expect(eventTypes).toContain('VALIDATING');
    expect(eventTypes).toContain('REPAIRING');
    expect(eventTypes).toContain('COMPLETE');

    const repairEvent = events.find((e) => e.type === 'REPAIRING');
    expect(repairEvent?.payload.attempt).toBe(1);
    expect(repairEvent?.payload.errors.length).toBeGreaterThan(0);

    const completeEvent = events.find((e) => e.type === 'COMPLETE');
    expect(completeEvent?.payload.attempts).toBe(2);
  });

  it('emits ERROR event when max repairs are exceeded', async () => {
    const brokenHtml = `broken code without html`;

    const skillManager = new SkillManager();
    const provider = new MockLLMProvider({
      responses: [brokenHtml, brokenHtml, brokenHtml],
    });
    const validator = new HtmlValidator();
    const loop = new AgentLoop(skillManager, provider, validator, {
      maxRepairs: 1,
    });

    const events: AgentEvent[] = [];
    for await (const event of loop.run('失敗テスト')) {
      events.push(event);
    }

    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toContain('REPAIRING');
    expect(eventTypes).toContain('ERROR');
    expect(eventTypes).not.toContain('COMPLETE');

    const errorEvent = events.find((e) => e.type === 'ERROR');
    expect(errorEvent?.payload.phase).toBe('validation');
  });
});
