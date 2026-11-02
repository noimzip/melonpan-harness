import { describe, it, expect } from 'vitest';
import { inspectHtmlGameQuality, createQualityGateMiddleware } from '../src/safety/quality-gate.js';
import { VirtualFS } from '../src/vfs/virtual-fs.js';
import { ToolRegistry } from '../src/tools/tool-registry.js';
import { createBuiltinTools } from '../src/tools/builtin-tools.js';

describe('Zero-Token Deterministic Quality Gate (Issue #59)', () => {
  it('passes valid 60fps Cyber-Neon HTML5 Canvas game with 100/100 score', () => {
    const validHtml = `<!DOCTYPE html>
<html>
<head>
  <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@700&display=swap" rel="stylesheet">
  <style>
    .hud { backdrop-filter: blur(8px); font-family: 'Orbitron', sans-serif; }
  </style>
</head>
<body>
  <div class="hud">SCORE: 0</div>
  <canvas id="game"></canvas>
  <script>
    const canvas = document.getElementById('game');
    const ctx = canvas.getContext('2d');
    window.addEventListener('keydown', () => {});
    window.addEventListener('pointerdown', () => {});
    function loop() {
      ctx.save();
      ctx.shadowBlur = 12;
      ctx.fillRect(0, 0, 10, 10);
      ctx.shadowBlur = 0;
      ctx.restore();
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  </script>
</body>
</html>`;

    const report = inspectHtmlGameQuality(validHtml, 'index.html');
    expect(report.passed).toBe(true);
    expect(report.score).toBe(100);
    expect(report.issues).toHaveLength(0);
    expect(report.summary).toContain('QUALITY_GATE: PASS (100/100)');
  });

  it('detects JavaScript syntax errors, unbalanced save/restore, and unreset shadowBlur', () => {
    const brokenHtml = `<html>
<body>
  <canvas id="game"></canvas>
  <script>
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.shadowBlur = 20;
    function broken( {
      console.log('syntax error');
    }
  </script>
</body>
</html>`;

    const report = inspectHtmlGameQuality(brokenHtml, 'index.html');
    expect(report.passed).toBe(false);
    const codes = report.issues.map((i) => i.code);
    expect(codes).toContain('JS_SYNTAX_ERROR');
    expect(codes).toContain('MISSING_DOCTYPE');
    expect(codes).toContain('UNBALANCED_CTX_SAVE_RESTORE');
    expect(codes).toContain('SHADOW_BLUR_NOT_RESET');
  });

  it('attaches qualityGate report to metadata and appends warning summary in middleware on write_file', async () => {
    const vfs = new VirtualFS();
    const registry = new ToolRegistry(createBuiltinTools(), [createQualityGateMiddleware()]);
    const res = await registry.execute(
      'write_file',
      {
        path: 'index.html',
        content: '<!DOCTYPE html><html><body><canvas></canvas><script>const x = ;</script></body></html>',
      },
      { fs: vfs, emit: () => {} } as any
    );

    expect(res.metadata?.qualityGate).toBeDefined();
    expect(res.metadata?.qualityGate.passed).toBe(false);
    expect(res.output).toContain('[QUALITY_GATE: FAIL');
    expect(res.output).toContain('JS_SYNTAX_ERROR');
  });
});
