import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { MelonpanCore } from '../src/index.js';

describe('Plan Mode & Sub-agent Delegation', () => {
  const currentFile = fileURLToPath(import.meta.url);
  const coreDir = path.resolve(path.dirname(currentFile), '..');
  const skillsDir = path.resolve(coreDir, 'skills');
  const agentsDir = path.resolve(coreDir, 'agents');

  it('runs strictly in plan mode: generates plan.md and halts without index.html', async () => {
    const core = new MelonpanCore({
      skillsDir,
      agentsDir,
      mode: 'plan',
      simulate: true,
    });

    const events: any[] = [];
    for await (const event of core.run('ネオンサイバーなブロック崩しゲーム')) {
      events.push(event);
    }

    const types = events.map((e) => e.type);
    expect(types).toContain('PLAN_STARTED');
    expect(types).toContain('SUBAGENT_DISPATCHED');
    expect(types).toContain('SUBAGENT_COMPLETED');
    expect(types).toContain('PLAN_CREATED');
    expect(types).toContain('COMPLETE');

    const vfsFiles = core.getVirtualFiles();
    expect(vfsFiles['plan.md']).toBeDefined();
    expect(vfsFiles['plan.md']).toContain('# Implementation Plan');
    // index.html must NOT be created in plan mode
    expect(vfsFiles['index.html']).toBeUndefined();

    const planCreatedEvent = events.find((e) => e.type === 'PLAN_CREATED');
    expect(planCreatedEvent.payload.path).toBe('plan.md');
  });

  it('runs in auto mode: executes Plan -> Act -> Audit with both researcher and code-reviewer', async () => {
    const core = new MelonpanCore({
      skillsDir,
      agentsDir,
      mode: 'auto',
      simulate: true,
    });

    const events: any[] = [];
    for await (const event of core.run('宇宙の重力ジャンプアクションゲーム')) {
      events.push(event);
    }

    const types = events.map((e) => e.type);
    expect(types).toContain('PLAN_STARTED');
    expect(types).toContain('PLAN_CREATED');
    expect(types).toContain('FILE_CHANGED');
    expect(types).toContain('SUBAGENT_DISPATCHED');
    expect(types).toContain('SUBAGENT_COMPLETED');
    expect(types).toContain('COMPLETE');

    // Both subagents dispatched
    const dispatched = events
      .filter((e) => e.type === 'SUBAGENT_DISPATCHED')
      .map((e) => e.payload.agentType);
    expect(dispatched).toContain('researcher');
    expect(dispatched).toContain('code-reviewer');

    const vfsFiles = core.getVirtualFiles();
    expect(vfsFiles['plan.md']).toBeDefined();
    expect(vfsFiles['index.html']).toBeDefined();
    expect(vfsFiles['index.html']).toContain('<!DOCTYPE html>');
  });
});
