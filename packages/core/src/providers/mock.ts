import { GenerateStreamParams, LLMProvider } from '../types.js';

export interface MockLLMProviderOptions {
  /** 各試行ごとの完全なレスポンス文字列の配列 (試行ごとに消費される) */
  responses?: string[];
  /** 1回の試行で送出するチャンクの配列 */
  chunks?: string[];
  /** チャンク間のディレイ (ミリ秒) */
  delayMs?: number;
}

/**
 * テスト・オフライン用のモックLLMプロバイダー
 */
export class MockLLMProvider implements LLMProvider {
  private responses: string[];
  private chunks?: string[];
  private delayMs: number;
  private attemptIndex: number = 0;

  constructor(options: MockLLMProviderOptions = {}) {
    this.responses = options.responses ? [...options.responses] : [];
    this.chunks = options.chunks;
    this.delayMs = options.delayMs ?? 0;
  }

  async *generateStream(_params: GenerateStreamParams): AsyncIterable<string> {
    if (this.chunks && this.chunks.length > 0) {
      for (const chunk of this.chunks) {
        if (this.delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, this.delayMs));
        }
        yield chunk;
      }
      return;
    }

    if (this.responses.length > 0) {
      const response =
        this.attemptIndex < this.responses.length
          ? this.responses[this.attemptIndex]
          : this.responses[this.responses.length - 1];
      this.attemptIndex++;

      // 40文字程度の断片に分割してストリーミング演出
      const chunkSize = 40;
      for (let i = 0; i < response.length; i += chunkSize) {
        if (this.delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, this.delayMs));
        }
        yield response.slice(i, i + chunkSize);
      }
      return;
    }

    // デフォルトの完動HTML5 Canvasゲーム
    const defaultGame = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Melonpan Canvas Demo</title>
  <style>
    body { margin: 0; padding: 0; overflow: hidden; background: #1a1a2e; touch-action: none; display: flex; justify-content: center; align-items: center; height: 100vh; }
    canvas { border: 2px solid #e94560; border-radius: 8px; box-shadow: 0 0 20px rgba(233,69,96,0.4); max-width: 100vw; max-height: 100vh; }
  </style>
</head>
<body>
  <canvas id="gameCanvas" width="400" height="600"></canvas>
  <script>
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    let score = 0;
    let gameOver = false;
    let player = { x: 180, y: 500, w: 40, h: 40, vx: 0 };
    let stars = [];

    for (let i = 0; i < 5; i++) {
      stars.push({ x: Math.random() * 360, y: Math.random() * 400, r: 15, vy: 2 + Math.random() * 3 });
    }

    window.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'a') player.vx = -5;
      if (e.key === 'ArrowRight' || e.key === 'd') player.vx = 5;
      if (gameOver && (e.key === ' ' || e.key === 'Enter')) restart();
    });
    window.addEventListener('keyup', () => { player.vx = 0; });
    canvas.addEventListener('pointerdown', (e) => {
      if (gameOver) { restart(); return; }
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) * (canvas.width / rect.width);
      player.vx = x < canvas.width / 2 ? -5 : 5;
    });
    canvas.addEventListener('pointerup', () => { player.vx = 0; });

    function restart() {
      score = 0;
      gameOver = false;
      player.x = 180;
      stars.forEach(s => { s.y = Math.random() * -200; });
      loop();
    }

    function loop() {
      if (gameOver) {
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#fff';
        ctx.font = '24px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('GAME OVER', 200, 280);
        ctx.font = '16px sans-serif';
        ctx.fillText('Score: ' + score, 200, 320);
        ctx.fillText('Tap or Space to Restart', 200, 360);
        return;
      }
      player.x = Math.max(0, Math.min(canvas.width - player.w, player.x + player.vx));
      ctx.fillStyle = '#16213e';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#0f3460';
      ctx.fillRect(player.x, player.y, player.w, player.h);

      ctx.fillStyle = '#e94560';
      stars.forEach(s => {
        s.y += s.vy;
        if (s.y > canvas.height) { s.y = -20; s.x = Math.random() * 360; score += 10; }
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
        if (s.y + s.r > player.y && s.x > player.x && s.x < player.x + player.w) {
          gameOver = true;
        }
      });

      ctx.fillStyle = '#fff';
      ctx.font = '18px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('Score: ' + score, 15, 30);
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  </script>
</body>
</html>`;

    const chunkSize = 40;
    for (let i = 0; i < defaultGame.length; i += chunkSize) {
      if (this.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.delayMs));
      }
      yield defaultGame.slice(i, i + chunkSize);
    }
  }
}
