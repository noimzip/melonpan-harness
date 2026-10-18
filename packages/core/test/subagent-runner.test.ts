import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { SubagentRunner } from '../src/subagents/subagent-runner.js';

describe('SubagentRunner (Clean-Room Isolation)', () => {
  const currentFile = fileURLToPath(import.meta.url);
  const agentsDir = path.resolve(path.dirname(currentFile), '../agents');

  it('loads researcher and code-reviewer definitions from agents directory', async () => {
    const runner = new SubagentRunner({ agentsDir, simulate: true });
    const defs = await runner.loadDefinitions();

    expect(defs.has('researcher')).toBe(true);
    expect(defs.has('code-reviewer')).toBe(true);

    const researcher = defs.get('researcher')!;
    expect(researcher.description).toContain('Specialist in researching');
    expect(researcher.instruction).toContain('結論 (Conclusion)');
    expect(researcher.instruction).toContain('推奨実装 (Recommended Implementation)');
    expect(researcher.instruction).toContain('懸念点・リスク (Risks & Considerations)');

    const reviewer = defs.get('code-reviewer')!;
    expect(reviewer.instruction).toContain('Performance');
    expect(reviewer.instruction).toContain('Security');
    expect(reviewer.instruction).toContain('Visual & UI/UX');
    expect(reviewer.instruction).toContain('Critical');
    expect(reviewer.instruction).toContain('Warning');
    expect(reviewer.instruction).toContain('Verdict');
  });

  it('runs researcher in clean-room simulation and returns structured research report', async () => {
    const runner = new SubagentRunner({ agentsDir, simulate: true });
    const result = await runner.run(
      'researcher',
      'HTML5 Canvas 2D neon game physics and Orbitron HUD layout'
    );

    expect(result).toContain('### 1. 結論 (Conclusion)');
    expect(result).toContain('### 2. 推奨実装 (Recommended Implementation)');
    expect(result).toContain('### 3. 懸念点・リスク (Risks & Considerations)');
    expect(result).toContain('Orbitron');
    expect(result).toContain('backdrop-filter');
  });

  it('runs code-reviewer in clean-room simulation and returns multi-perspective audit report', async () => {
    const runner = new SubagentRunner({ agentsDir, simulate: true });
    const result = await runner.run(
      'code-reviewer',
      '<!DOCTYPE html><html><canvas id="c"></canvas></html>'
    );

    expect(result).toContain('### 1. Performance');
    expect(result).toContain('### 2. Security');
    expect(result).toContain('### 3. Visual & UI/UX');
    expect(result).toContain('### 4. Verdict');
    expect(result).toContain('APPROVED');
  });
});
