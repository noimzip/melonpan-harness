import { MelonpanCore } from '../packages/core/src/index.js';
import { MockLLMProvider } from '../packages/core/src/providers/mock.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

async function main() {
  console.log(`\n========================================`);
  console.log(`🍈 Melonpan Agent Harness (Mock Demo)`);
  console.log(`高専祭オフライン実演 & 自動修復ループのシミュレーション`);
  console.log(`========================================\n`);

  // 1回目は意図的に構文エラーを含むコード、2回目に完動コードを返すプロバイダ
  const brokenAttempt = `<!DOCTYPE html>
<html>
<body>
  <canvas id="c" width="400" height="400"></canvas>
  <script>
    // 意図的な構文エラー（未完結式）
    const player = ;
  </script>
</body>
</html>`;

  const validAttempt = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Melonpan Space Jumper</title>
  <style>
    body { margin: 0; padding: 0; overflow: hidden; background: #0b0c10; touch-action: none; display: flex; justify-content: center; align-items: center; height: 100vh; font-family: sans-serif; }
    canvas { border: 2px solid #66fcf1; border-radius: 8px; box-shadow: 0 0 25px rgba(102,252,241,0.5); max-width: 100vw; max-height: 100vh; }
  </style>
</head>
<body>
  <canvas id="gameCanvas" width="400" height="600"></canvas>
  <script>
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    let score = 0;
    let highScore = 0;
    let gameOver = false;
    let player = { x: 180, y: 500, w: 36, h: 36, vy: 0, vx: 0, onGround: false };
    let platforms = [
      { x: 50, y: 550, w: 300, h: 16 },
      { x: 100, y: 440, w: 200, h: 16 },
      { x: 160, y: 320, w: 160, h: 16 },
      { x: 80, y: 200, w: 140, h: 16 },
      { x: 180, y: 80, w: 120, h: 16 }
    ];

    window.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'a') player.vx = -6;
      if (e.key === 'ArrowRight' || e.key === 'd') player.vx = 6;
      if ((e.key === 'ArrowUp' || e.key === 'w' || e.key === ' ') && player.onGround) {
        player.vy = -14;
        player.onGround = false;
      }
      if (gameOver && (e.key === ' ' || e.key === 'Enter')) restart();
    });
    window.addEventListener('keyup', (e) => {
      if (['ArrowLeft', 'ArrowRight', 'a', 'd'].includes(e.key)) player.vx = 0;
    });

    canvas.addEventListener('pointerdown', (e) => {
      if (gameOver) { restart(); return; }
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) * (canvas.width / rect.width);
      if (player.onGround) {
        player.vy = -14;
        player.onGround = false;
      }
      player.vx = x < canvas.width / 2 ? -6 : 6;
    });
    canvas.addEventListener('pointerup', () => { player.vx = 0; });

    function restart() {
      score = 0;
      gameOver = false;
      player.x = 180;
      player.y = 500;
      player.vy = 0;
      player.vx = 0;
      loop();
    }

    function loop() {
      if (gameOver) {
        ctx.fillStyle = 'rgba(11,12,16,0.85)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#66fcf1';
        ctx.font = 'bold 28px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('MISSION OVER', 200, 260);
        ctx.fillStyle = '#c5c6c7';
        ctx.font = '18px sans-serif';
        ctx.fillText('Final Score: ' + score, 200, 310);
        ctx.fillText('High Score: ' + highScore, 200, 340);
        ctx.fillStyle = '#45a29e';
        ctx.fillText('Press Space or Tap to Retry', 200, 400);
        return;
      }

      player.vy += 0.6; // 重力
      player.y += player.vy;
      player.x = Math.max(0, Math.min(canvas.width - player.w, player.x + player.vx));

      player.onGround = false;
      for (const p of platforms) {
        if (
          player.x + player.w > p.x &&
          player.x < p.x + p.w &&
          player.y + player.h >= p.y &&
          player.y + player.h <= p.y + p.h + player.vy &&
          player.vy >= 0
        ) {
          player.y = p.y - player.h;
          player.vy = 0;
          player.onGround = true;
          break;
        }
      }

      // カメラ上昇（スクロール）
      if (player.y < 250) {
        const diff = 250 - player.y;
        player.y = 250;
        score += Math.floor(diff);
        if (score > highScore) highScore = score;
        for (const p of platforms) {
          p.y += diff;
          if (p.y > canvas.height) {
            p.y = 0;
            p.x = Math.random() * (canvas.width - p.w);
          }
        }
      }

      if (player.y > canvas.height) {
        gameOver = true;
      }

      // 描画
      ctx.fillStyle = '#1f2833';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // プラットフォーム
      ctx.fillStyle = '#45a29e';
      for (const p of platforms) {
        ctx.fillRect(p.x, p.y, p.w, p.h);
      }

      // プレイヤー
      ctx.fillStyle = '#66fcf1';
      ctx.fillRect(player.x, player.y, player.w, player.h);

      // UI
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 18px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('ALTITUDE: ' + score + ' m', 16, 32);

      requestAnimationFrame(loop);
    }

    requestAnimationFrame(loop);
  </script>
</body>
</html>`;

  const mockProvider = new MockLLMProvider({
    responses: [brokenAttempt, validAttempt],
    delayMs: 2, // 高速ストリーミング演出
  });

  const core = new MelonpanCore({
    provider: mockProvider,
    maxRepairs: 2,
  });

  const prompt = '宇宙を舞台にしたジャンプアクションゲーム';
  console.log(`プロンプト: "${prompt}"\n`);

  const eventStream = core.run(prompt);
  let finalHtml = '';

  for await (const event of eventStream) {
    switch (event.type) {
      case 'SKILL_LOADED':
        console.log(`[Skill Loaded]: ${event.payload.name}`);
        break;
      case 'THINKING':
        console.log(`[Thinking]: ${event.payload.message}\n`);
        console.log(`--- [Code Streaming Output (Attempt 1)] ---`);
        break;
      case 'CODE_CHUNK':
        process.stdout.write(event.payload);
        break;
      case 'VALIDATING':
        console.log(`\n-------------------------------`);
        console.log(`[Validating]: ${event.payload.message}`);
        break;
      case 'REPAIRING':
        console.log(`\n[Repairing]: ⚠️ 構文エラー検知！自動修復を実行します (Attempt ${event.payload.attempt})`);
        for (const err of event.payload.errors) {
          console.log(`  - 検知されたエラー: ${err}`);
        }
        console.log(`--- [Code Streaming Output (Attempt 2: Repaired)] ---`);
        break;
      case 'COMPLETE':
        console.log(`\n========================================`);
        console.log(`🎉 [Complete]: ゲーム生成＆自動修復が正常完了しました！`);
        console.log(`総試行回数: ${event.payload.attempts} 回`);
        console.log(`処理所要時間: ${event.payload.durationMs} ms`);
        console.log(`========================================\n`);
        finalHtml = event.payload.html;
        break;
      case 'ERROR':
        console.error(`\n❌ [Error]:`, event.payload.error);
        break;
    }
  }

  if (finalHtml) {
    const outputPath = path.resolve(process.cwd(), 'generated-game.html');
    fs.writeFileSync(outputPath, finalHtml, 'utf-8');
    console.log(`📁 完動ゲームHTMLを保存しました: ${outputPath}`);
  }
}

main().catch(console.error);
