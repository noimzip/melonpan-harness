import { describe, it, expect } from 'vitest';
import { HtmlValidator } from '../src/validator/html-validator.js';

describe('HtmlValidator', () => {
  const validator = new HtmlValidator();

  const validHtml = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>Test Game</title>
</head>
<body>
  <canvas id="c" width="300" height="300"></canvas>
  <script>
    const canvas = document.getElementById('c');
    const ctx = canvas.getContext('2d');
    window.addEventListener('keydown', () => {});
    function loop() {
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  </script>
</body>
</html>`;

  it('validates correct HTML5 Canvas code', () => {
    const result = validator.validate(validHtml);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.sanitizedHtml).toContain('<canvas id="c"');
  });

  it('extracts HTML from markdown code blocks', () => {
    const markdown = `
Here is the generated game:
\`\`\`html
${validHtml}
\`\`\`
Have fun playing!
    `.trim();

    const extracted = validator.extractHtml(markdown);
    expect(extracted.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(extracted.endsWith('</html>')).toBe(true);

    const result = validator.validate(markdown);
    expect(result.valid).toBe(true);
  });

  it('detects missing closing tags', () => {
    const broken = `<!DOCTYPE html><html><body><canvas></canvas><script>requestAnimationFrame(() => {}); window.addEventListener('click', ()=>{});</script>`;
    const result = validator.validate(broken);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('</html>'))).toBe(true);
  });

  it('detects missing canvas element', () => {
    const noCanvas = `<!DOCTYPE html><html><body><div>No canvas</div><script>requestAnimationFrame(() => {}); window.addEventListener('click', ()=>{});</script></body></html>`;
    const result = validator.validate(noCanvas);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('<canvas>'))).toBe(true);
  });

  it('detects missing game loop', () => {
    const noLoop = `<!DOCTYPE html><html><body><canvas></canvas><script>window.addEventListener('click', ()=>{});</script></body></html>`;
    const result = validator.validate(noLoop);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('game loop'))).toBe(true);
  });

  it('detects JavaScript syntax errors without executing script', () => {
    const syntaxErrorHtml = `<!DOCTYPE html>
<html>
<body>
  <canvas></canvas>
  <script>
    requestAnimationFrame(() => {});
    window.addEventListener('click', () => {});
    function broken() {
      const a = ;
    }
  </script>
</body>
</html>`;
    const result = validator.validate(syntaxErrorHtml);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('JavaScript syntax error'))).toBe(
      true
    );
  });
});
