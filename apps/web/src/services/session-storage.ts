import { Session } from '../types';

const STORAGE_KEY = 'melonpan_web_sessions_v1';
const ACTIVE_SESSION_ID_KEY = 'melonpan_active_session_id_v1';

const DEFAULT_GAME_HTML = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>🍈 メロンパン・バウンス (Melonpan Bounce)</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #fffaf1;
      color: #3b271d;
      font-family: 'Zen Kurenaido', sans-serif, system-ui;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      overflow: hidden;
      user-select: none;
    }
    #gameContainer {
      position: relative;
      border: 3px solid #3b271d;
      border-radius: 20px;
      background: #f7f2ea;
      box-shadow: 3px 5px 0 rgba(59, 39, 29, 0.25);
      overflow: hidden;
    }
    canvas {
      display: block;
      background: #fffdf9;
    }
    #hud {
      position: absolute;
      top: 10px;
      left: 14px;
      right: 14px;
      display: flex;
      justify-content: space-between;
      font-size: 16px;
      font-weight: bold;
      pointer-events: none;
    }
    #banner {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      text-align: center;
      background: rgba(255, 250, 241, 0.95);
      border: 2px solid #3b271d;
      border-radius: 16px;
      padding: 16px 24px;
      box-shadow: 2px 4px 0 rgba(59, 39, 29, 0.2);
      display: none;
    }
    #banner h2 { font-size: 20px; margin-bottom: 8px; color: #af734a; }
    #banner p { font-size: 14px; }
  </style>
</head>
<body>
  <div id="gameContainer">
    <div id="hud">
      <div>🍈 SCORE: <span id="scoreVal">0</span></div>
      <div>❤️ LIVES: <span id="livesVal">3</span></div>
    </div>
    <canvas id="gameCanvas" width="480" height="420"></canvas>
    <div id="banner">
      <h2 id="bannerTitle">GAME OVER</h2>
      <p>クリックまたはスペースキーで再開！</p>
    </div>
  </div>

  <script>
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    const scoreVal = document.getElementById('scoreVal');
    const livesVal = document.getElementById('livesVal');
    const banner = document.getElementById('banner');
    const bannerTitle = document.getElementById('bannerTitle');

    let score = 0;
    let lives = 3;
    let gameOver = false;
    let gameWon = false;

    // Paddle (手書き風カッティングボード)
    const paddle = {
      w: 80,
      h: 14,
      x: canvas.width / 2 - 40,
      y: canvas.height - 28,
      speed: 7,
      dx: 0
    };

    // Ball (メロンパン玉 🍈)
    const ball = {
      x: canvas.width / 2,
      y: canvas.height - 50,
      r: 9,
      dx: 3.5,
      dy: -3.5,
      rot: 0
    };

    // Blocks (クッキーブロック)
    const blocks = [];
    const rows = 4;
    const cols = 6;
    const blockW = 62;
    const blockH = 18;
    const blockPadding = 12;
    const blockOffsetTop = 50;
    const blockOffsetLeft = (canvas.width - (cols * (blockW + blockPadding) - blockPadding)) / 2;

    const colors = ['#af734a', '#c47c4a', '#8d5b4c', '#5d4037'];

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        blocks.push({
          x: blockOffsetLeft + c * (blockW + blockPadding),
          y: blockOffsetTop + r * (blockH + blockPadding),
          status: 1,
          color: colors[r % colors.length]
        });
      }
    }

    // Controls
    let leftPressed = false;
    let rightPressed = false;

    window.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'a') leftPressed = true;
      if (e.key === 'ArrowRight' || e.key === 'd') rightPressed = true;
      if (e.key === ' ' && (gameOver || gameWon)) restart();
    });

    window.addEventListener('keyup', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'a') leftPressed = false;
      if (e.key === 'ArrowRight' || e.key === 'd') rightPressed = false;
    });

    canvas.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      const rootX = e.clientX - rect.left;
      paddle.x = Math.max(0, Math.min(canvas.width - paddle.w, rootX - paddle.w / 2));
    });

    window.addEventListener('click', () => {
      if (gameOver || gameWon) restart();
    });

    function restart() {
      score = 0;
      lives = 3;
      gameOver = false;
      gameWon = false;
      scoreVal.textContent = score;
      livesVal.textContent = lives;
      banner.style.display = 'none';
      ball.x = canvas.width / 2;
      ball.y = canvas.height - 50;
      ball.dx = 3.5 * (Math.random() > 0.5 ? 1 : -1);
      ball.dy = -3.5;
      for (const b of blocks) b.status = 1;
      requestAnimationFrame(loop);
    }

    function update() {
      if (gameOver || gameWon) return;

      if (leftPressed && paddle.x > 0) paddle.x -= paddle.speed;
      if (rightPressed && paddle.x < canvas.width - paddle.w) paddle.x += paddle.speed;

      ball.x += ball.dx;
      ball.y += ball.dy;
      ball.rot += 0.05;

      // Wall bounce
      if (ball.x - ball.r < 0 || ball.x + ball.r > canvas.width) {
        ball.dx = -ball.dx;
      }
      if (ball.y - ball.r < 0) {
        ball.dy = -ball.dy;
      }

      // Paddle collision
      if (
        ball.y + ball.r >= paddle.y &&
        ball.y - ball.r <= paddle.y + paddle.h &&
        ball.x >= paddle.x &&
        ball.x <= paddle.x + paddle.w
      ) {
        ball.dy = -Math.abs(ball.dy);
        const hitOffset = (ball.x - (paddle.x + paddle.w / 2)) / (paddle.w / 2);
        ball.dx = hitOffset * 4.5;
      }

      // Block collision
      let activeBlocks = 0;
      for (const b of blocks) {
        if (b.status === 1) {
          activeBlocks++;
          if (
            ball.x + ball.r > b.x &&
            ball.x - ball.r < b.x + blockW &&
            ball.y + ball.r > b.y &&
            ball.y - ball.r < b.y + blockH
          ) {
            b.status = 0;
            ball.dy = -ball.dy;
            score += 10;
            scoreVal.textContent = score;
          }
        }
      }

      if (activeBlocks === 0) {
        gameWon = true;
        bannerTitle.textContent = '🎉 STAGE CLEAR!';
        banner.style.display = 'block';
        return;
      }

      // Bottom death
      if (ball.y - ball.r > canvas.height) {
        lives--;
        livesVal.textContent = lives;
        if (lives <= 0) {
          gameOver = true;
          bannerTitle.textContent = '😭 GAME OVER';
          banner.style.display = 'block';
        } else {
          ball.x = paddle.x + paddle.w / 2;
          ball.y = canvas.height - 50;
          ball.dx = 3.5 * (Math.random() > 0.5 ? 1 : -1);
          ball.dy = -3.5;
        }
      }
    }

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw blocks
      for (const b of blocks) {
        if (b.status === 1) {
          ctx.fillStyle = b.color;
          ctx.strokeStyle = '#3b271d';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.roundRect(b.x, b.y, blockW, blockH, 6);
          ctx.fill();
          ctx.stroke();

          // Criss-cross cookie lines
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
          ctx.beginPath();
          ctx.moveTo(b.x + 8, b.y + 3);
          ctx.lineTo(b.x + blockW - 8, b.y + blockH - 3);
          ctx.stroke();
        }
      }

      // Draw paddle
      ctx.fillStyle = '#3b271d';
      ctx.beginPath();
      ctx.roundRect(paddle.x, paddle.y, paddle.w, paddle.h, 7);
      ctx.fill();

      // Draw melonpan ball
      ctx.save();
      ctx.translate(ball.x, ball.y);
      ctx.rotate(ball.rot);

      ctx.fillStyle = '#f3ca65';
      ctx.strokeStyle = '#3b271d';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, ball.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Melonpan lattice pattern
      ctx.strokeStyle = '#9c6f2a';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-ball.r * 0.7, -ball.r * 0.4);
      ctx.lineTo(ball.r * 0.7, ball.r * 0.4);
      ctx.moveTo(-ball.r * 0.4, ball.r * 0.7);
      ctx.lineTo(ball.r * 0.4, -ball.r * 0.7);
      ctx.stroke();

      ctx.restore();
    }

    function loop() {
      update();
      draw();
      if (!gameOver && !gameWon) {
        requestAnimationFrame(loop);
      }
    }

    requestAnimationFrame(loop);
  </script>
</body>
</html>`;

export function createInitialSession(name = '新しいゲーム開発'): Session {
  const id = `session_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  return {
    id,
    name,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    mode: 'auto',
    messages: [
      {
        id: 'msg_welcome',
        role: 'assistant',
        content:
          '今日はどんな一日だった？ うれしいことも、ちょっと疲れたことも、ゆっくり聞かせてね。\n\n melonpan-harness へようこそ！作りたいHTML5 Canvasゲームや追加したい機能、ボス戦、サウンド演出など何でも教えてください。',
        timestamp: Date.now(),
      },
    ],
    files: {
      'index.html': DEFAULT_GAME_HTML,
      'README.md': '# 🍈 Melonpan Game Project\n\n生成されたゲームのコードがここに格納されます。',
    },
    activeFile: 'index.html',
    subagents: [],
    metrics: {
      billedInputTokens: 0,
      billedOutputTokens: 0,
      cachedTokens: 0,
      totalTokens: 0,
      contextWindowLimit: 128000,
      currentContextTokens: 1420,
      prunedChars: 0,
      compactionCount: 0,
      compactionLogs: [],
    },
  };
}

export function loadSessions(): Session[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const initial = createInitialSession('はじめてのメロンパンゲーム');
      saveSessions([initial]);
      setActiveSessionId(initial.id);
      return [initial];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      const initial = createInitialSession('はじめてのメロンパンゲーム');
      saveSessions([initial]);
      return [initial];
    }
    return parsed;
  } catch {
    const initial = createInitialSession('はじめてのメロンパンゲーム');
    return [initial];
  }
}

export function saveSessions(sessions: Session[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch (err) {
    console.error('Failed to save sessions to localStorage:', err);
  }
}

export function getActiveSessionId(): string | null {
  return localStorage.getItem(ACTIVE_SESSION_ID_KEY);
}

export function setActiveSessionId(id: string): void {
  localStorage.setItem(ACTIVE_SESSION_ID_KEY, id);
}
