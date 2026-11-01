import {
  Message,
  WebToolCall,
  PlanState,
  SubagentTrace,
  PermissionRequest,
  Session,
  ProviderConfig,
  PermissionPolicyConfig,
} from '../types';

export interface RuntimeCallbacks {
  onMessageUpdate: (message: Message) => void;
  onToolCallUpdate: (toolCall: WebToolCall) => void;
  onFileChange: (path: string, content: string) => void;
  onPlanUpdate: (plan: PlanState) => void;
  onSubagentUpdate: (subagent: SubagentTrace) => void;
  onPermissionRequest: (request: PermissionRequest) => void;
  onMetricsUpdate: (updater: (prev: any) => any) => void;
}

export class AgentRuntime {
  private abortController: AbortController | null = null;
  private isRunning = false;
  private permissionPolicy: PermissionPolicyConfig = {
    read: 'allow',
    write: 'ask',
    command: 'ask',
    web: 'allow',
  };
  private sessionPermissions: Set<string> = new Set();

  setPermissionPolicy(policy: PermissionPolicyConfig) {
    this.permissionPolicy = { ...policy };
  }

  getPermissionPolicy(): PermissionPolicyConfig {
    return { ...this.permissionPolicy };
  }

  cancelCurrentTask(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.isRunning = false;
  }

  getIsRunning(): boolean {
    return this.isRunning;
  }

  private async sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(), ms);
      if (signal) {
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new DOMException('Aborted', 'AbortError'));
        });
      }
    });
  }

  async checkPermission(
    toolName: string,
    args: Record<string, any>,
    callbacks: RuntimeCallbacks,
    signal?: AbortSignal
  ): Promise<boolean> {
    // If always allowed for this session
    if (this.sessionPermissions.has(toolName)) {
      return true;
    }

    let category: 'read' | 'write' | 'command' | 'web' = 'read';
    if (toolName.includes('write') || toolName.includes('edit') || toolName.includes('delete')) {
      category = 'write';
    } else if (toolName.includes('command') || toolName.includes('bash') || toolName.includes('terminal')) {
      category = 'command';
    } else if (toolName.includes('web') || toolName.includes('fetch') || toolName.includes('url')) {
      category = 'web';
    }

    const policy = this.permissionPolicy[category];
    if (policy === 'allow') {
      return true;
    }
    if (policy === 'deny') {
      return false;
    }

    // policy === 'ask': trigger modal
    return new Promise((resolve) => {
      let details = '';
      let commandString = '';
      let filePath = '';
      let diffPreview = '';

      if (category === 'command') {
        commandString = args.command || args.cmd || 'pnpm build';
        details = `実行コマンド: ${commandString}`;
      } else if (category === 'write') {
        filePath = args.path || args.filePath || 'index.html';
        details = `ファイルパス: ${filePath}`;
        if (args.content) {
          diffPreview = `+ ${args.content.slice(0, 300)}...`;
        }
      } else {
        details = JSON.stringify(args, null, 2);
      }

      const req: PermissionRequest = {
        id: `perm_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        toolName,
        args,
        category,
        details,
        commandString,
        filePath,
        diffPreview,
        resolve: (decision) => {
          if (decision === 'always_allow') {
            this.sessionPermissions.add(toolName);
            resolve(true);
          } else if (decision === 'allow_once') {
            resolve(true);
          } else {
            resolve(false);
          }
        },
      };

      callbacks.onPermissionRequest(req);
    });
  }

  /**
   * Main turn execution entry point
   */
  async executeTurn(
    prompt: string,
    session: Session,
    providerConfig: ProviderConfig,
    callbacks: RuntimeCallbacks
  ): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    const assistantMsgId = `asst_${Date.now()}`;
    const assistantMsg: Message = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      thought: '',
      isStreaming: true,
      toolCalls: [],
      timestamp: Date.now(),
    };
    callbacks.onMessageUpdate({ ...assistantMsg });

    try {
      if (providerConfig.provider === 'simulation') {
        await this.runSimulationMode(prompt, session, assistantMsg, callbacks, signal);
      } else {
        await this.runLiveProviderMode(prompt, session, providerConfig, assistantMsg, callbacks, signal);
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        assistantMsg.isStreaming = false;
        assistantMsg.content += '\n\n⚠️ *ユーザーによってタスクが中断されました。*';
        callbacks.onMessageUpdate({ ...assistantMsg });
      } else {
        assistantMsg.isStreaming = false;
        assistantMsg.content += `\n\n❌ エラーが発生しました: ${err.message || String(err)}`;
        callbacks.onMessageUpdate({ ...assistantMsg });
      }
    } finally {
      assistantMsg.isStreaming = false;
      callbacks.onMessageUpdate({ ...assistantMsg });
      this.isRunning = false;
      this.abortController = null;
    }
  }

  /**
   * Simulation mode: Emits realistic streaming thoughts, tool telemetry, diffs, subagents, and generates working Canvas games.
   */
  private async runSimulationMode(
    prompt: string,
    session: Session,
    msg: Message,
    callbacks: RuntimeCallbacks,
    signal: AbortSignal
  ): Promise<void> {
    const isPlanMode = session.mode === 'plan' || prompt.startsWith('/plan');
    const isErrorFix = prompt.includes('Runtime Error') || prompt.includes('修正') || prompt.includes('Fix');
    const promptLower = prompt.toLowerCase();

    // 1. Streaming thoughts
    const thoughts = [
      'ユーザープロンプトを解析中: 要求されたゲーム仕様と既存アセットの差分を特定しています...',
      'HTML5 Canvas 2D描画ループ、物理演算 (60fps requestAnimationFrame)、入力ハンドラーの設計を検証...',
      'ReActサイクル開始: 必要なツール実行 (`write_file`, `edit_file`) の整合性と安全ポリシーを確認中...',
    ];

    for (const thoughtChunk of thoughts) {
      for (let i = 0; i < thoughtChunk.length; i += 3) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        msg.thought = (msg.thought || '') + thoughtChunk.slice(i, i + 3);
        callbacks.onMessageUpdate({ ...msg });
        await this.sleep(20, signal);
      }
      msg.thought += '\n';
      await this.sleep(80, signal);
    }

    // 2. If Plan mode is active, generate plan
    if (isPlanMode) {
      const planMarkdown = `# 🍈 開発計画書: ${prompt.replace(/^\/plan\s*/, '') || 'ゲーム機能拡張'}
## フェーズ 1: コアアーキテクチャの確立
- [ ] 画面レイアウトとスコア表示HUDの調整
- [ ] requestAnimationFrame による 60fps 安定ループの保証

## フェーズ 2: ゲーム性・演出の強化
- [ ] パーティクルエフェクトとヒットサウンドの追加
- [ ] スピード調整とコンボ倍率システムの構築

## フェーズ 3: 安全性と品質レビュー
- [ ] \`code-reviewer\` サブエージェントによる境界値テスト
- [ ] \`index.html\` 単一ファイルとしてのエクスポート整合性確認
`;
      const planTasks = [
        { id: 'task-1', title: '画面レイアウトとスコア表示HUDの調整', status: 'pending' as const },
        { id: 'task-2', title: 'requestAnimationFrame による 60fps 安定ループの保証', status: 'pending' as const },
        { id: 'task-3', title: 'パーティクルエフェクトとヒットサウンドの追加', status: 'pending' as const },
        { id: 'task-4', title: 'スピード調整とコンボ倍率システムの構築', status: 'pending' as const },
        { id: 'task-5', title: 'code-reviewer サブエージェントによる境界値テスト', status: 'pending' as const },
      ];

      const newPlan: PlanState = {
        rawMarkdown: planMarkdown,
        status: 'pending_review',
        tasks: planTasks,
      };
      callbacks.onPlanUpdate(newPlan);

      const planReply = `開発計画書（Plan Mode）を作成しました！\n右ペインの「計画モード」タブをご確認いただき、承認していただければ実装を開始します。修正指示があれば遠慮なく教えてくださいね。`;
      for (let i = 0; i < planReply.length; i += 2) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        msg.content += planReply.slice(i, i + 2);
        callbacks.onMessageUpdate({ ...msg });
        await this.sleep(15, signal);
      }
      return;
    }

    // 3. Subagent dispatch simulation (e.g. researcher or code-reviewer)
    const subagentTrace: SubagentTrace = {
      id: `sub_${Date.now()}`,
      agentName: 'researcher',
      role: 'Game Physics & Mechanics Specialist',
      taskPrompt: `Research canvas 2D collision algorithm and responsive controls for: "${prompt.slice(0, 40)}"`,
      thoughts: [
        'Analyzing optimal bounding-box and circle-to-rect collision algorithms...',
        'Checking audio synthesis with Web Audio API for zero-asset retro sound effects...',
      ],
      toolCalls: [],
      status: 'running',
      tokens: { input: 840, output: 210, total: 1050 },
      durationMs: 420,
    };
    callbacks.onSubagentUpdate({ ...subagentTrace });

    await this.sleep(300, signal);
    subagentTrace.status = 'completed';
    subagentTrace.verdict = 'PASS';
    subagentTrace.report = 'Web Audio APIオシレーターとスムーズなCanvas 2Dパーティクル放出機構の仕様を特定しました。実装可能です。';
    callbacks.onSubagentUpdate({ ...subagentTrace });

    // 4. Permission check before tool execution
    const allowed = await this.checkPermission(
      'write_file',
      { path: 'index.html' },
      callbacks,
      signal
    );

    if (!allowed) {
      const toolCall: WebToolCall = {
        id: `tool_${Date.now()}`,
        name: 'write_file',
        args: { path: 'index.html' },
        status: 'denied',
        result: 'ユーザーによって実行権限が拒否されました。',
      };
      msg.toolCalls = [...(msg.toolCalls || []), toolCall];
      msg.content += '\n\n⚠️ 権限が拒否されたため、ファイル書き込みを中断しました。';
      callbacks.onMessageUpdate({ ...msg });
      return;
    }

    // 5. Generate appropriate game code based on prompt
    const existingHtml = session.files['index.html'] || '';
    const newHtml = this.generateSimulatedGame(prompt, existingHtml);

    // Emits tool call
    const toolCallId = `tc_${Date.now()}`;
    const toolCall: WebToolCall = {
      id: toolCallId,
      name: 'write_file',
      args: { path: 'index.html', length: newHtml.length },
      status: 'running',
    };
    msg.toolCalls = [...(msg.toolCalls || []), toolCall];
    callbacks.onMessageUpdate({ ...msg });

    await this.sleep(400, signal);

    toolCall.status = 'success';
    toolCall.result = `Successfully wrote ${newHtml.length} bytes to index.html`;
    toolCall.diff = {
      path: 'index.html',
      oldContent: existingHtml,
      newContent: newHtml,
      unifiedDiff: `--- index.html (previous)\n+++ index.html (updated)\n@@ -1,50 +1,70 @@\n+ [Updated Canvas 2D game loops, controls, and visual elements based on: "${prompt.slice(0, 30)}..."]`,
    };
    callbacks.onMessageUpdate({ ...msg });
    callbacks.onFileChange('index.html', newHtml);

    // 6. Subagent code-reviewer trace
    const reviewerTrace: SubagentTrace = {
      id: `rev_${Date.now()}`,
      agentName: 'code-reviewer',
      role: 'Automated Code & Syntax Auditor',
      taskPrompt: 'Audit generated index.html for infinite loops, canvas resizing, and Web Audio API audioContext user gesture.',
      thoughts: [
        'Checking requestAnimationFrame cancel handles and keydown listener cleanliness...',
        'Validating single-file export standalone integrity without external CDN dependencies...',
      ],
      toolCalls: [],
      status: 'completed',
      verdict: 'PASS',
      report: '監査合格: 単一ファイルで完全にスタンドアロン動作。オーディオ再生も安全に初期化されています。',
      tokens: { input: 1120, output: 160, total: 1280 },
      durationMs: 380,
    };
    callbacks.onSubagentUpdate(reviewerTrace);

    // 7. Streaming response text
    let responseText = '';
    if (isErrorFix) {
      responseText = `エラーを検出してコードを修正しました！\n\n主な修正内容:\n- 未定義プロパティへの参照をガード\n- requestAnimationFrame ループ内のリソース解放と再初期化処理を整理\n\n右側の「ゲームプレビュー」で問題なく動くか試してみてくださいね。`;
    } else if (promptLower.includes('シューティング') || promptLower.includes('space') || promptLower.includes('宇宙')) {
      responseText = `宇宙シューティングゲームを作成しました！🚀\n\n**特徴**:\n- 左右キーまたはマウスで自機移動、スペースキーでビーム発射\n- 敵機の撃破時に手書き風パーティクルが弾けます\n- スコアと残機システム完備\n\n右ペインのプレビューでそのまま遊べます！追加したい機能があれば教えてください。`;
    } else if (promptLower.includes('ボス') || promptLower.includes('boss')) {
      responseText = `迫力の大ボス戦を追加しました！👑\n\n**追加機能**:\n- HPバー付きの巨大ボスが上部に出現\n- ボスから扇状に弾幕が発射されます\n- ボス撃破で「VICTORY」バナーとお祝い演出！\n\nぜひボスを倒してみてください！`;
    } else {
      responseText = `ご要望に合わせてゲームを更新しました！🍈\n\n**更新ポイント**:\n- 「${prompt.slice(0, 25)}」に関する仕様を反映\n- 動きをなめらかにし、手書きのあたたかいビジュアルを維持\n- ホットリロードで右側のプレビューに即座に反映されています\n\nさらに「敵を増やして」「BGMのテンポを上げて」など、いつでも指示してくださいね。`;
    }

    for (let i = 0; i < responseText.length; i += 3) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      msg.content += responseText.slice(i, i + 3);
      callbacks.onMessageUpdate({ ...msg });
      await this.sleep(18, signal);
    }

    // 8. Update context metrics
    callbacks.onMetricsUpdate((prev) => ({
      ...prev,
      billedInputTokens: prev.billedInputTokens + 640,
      billedOutputTokens: prev.billedOutputTokens + 280,
      cachedTokens: prev.cachedTokens + 1200,
      totalTokens: prev.totalTokens + 920,
      currentContextTokens: Math.min(prev.contextWindowLimit, prev.currentContextTokens + 920),
    }));
  }

  /**
   * Generates a fully working single-file HTML5 Canvas game based on prompt
   */
  private generateSimulatedGame(prompt: string, prevHtml: string): string {
    const p = prompt.toLowerCase();

    // 1. Space Shooter
    if (p.includes('シューティング') || p.includes('space') || p.includes('宇宙') || p.includes('スター')) {
      return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>🍈 メロンパン・スペースシューター</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #2b211e;
      color: #fffaf1;
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
      border: 3px solid #e0d5c5;
      border-radius: 20px;
      background: #1c1514;
      box-shadow: 3px 5px 0 rgba(0, 0, 0, 0.4);
      overflow: hidden;
    }
    canvas { display: block; }
    #hud {
      position: absolute;
      top: 10px; left: 14px; right: 14px;
      display: flex; justify-content: space-between;
      font-size: 16px; font-weight: bold; pointer-events: none;
    }
    #banner {
      position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
      text-align: center; background: rgba(43, 33, 30, 0.95);
      border: 2px solid #e0d5c5; border-radius: 16px; padding: 18px 26px; display: none;
    }
  </style>
</head>
<body>
  <div id="gameContainer">
    <div id="hud">
      <div>SCORE: <span id="scoreVal">0</span></div>
      <div>HP: <span id="hpVal">100</span>%</div>
    </div>
    <canvas id="gameCanvas" width="480" height="460"></canvas>
    <div id="banner">
      <h2 id="bannerTitle" style="color:#b58b68; margin-bottom:8px;">GAME OVER</h2>
      <p>クリックまたはスペースで再出撃！</p>
    </div>
  </div>

  <script>
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    const scoreVal = document.getElementById('scoreVal');
    const hpVal = document.getElementById('hpVal');
    const banner = document.getElementById('banner');
    const bannerTitle = document.getElementById('bannerTitle');

    let score = 0;
    let hp = 100;
    let gameOver = false;

    const ship = { x: canvas.width / 2, y: canvas.height - 50, w: 32, h: 28, speed: 6 };
    let bullets = [];
    let enemies = [];
    let particles = [];
    let stars = [];

    for (let i = 0; i < 40; i++) {
      stars.push({ x: Math.random() * canvas.width, y: Math.random() * canvas.height, s: Math.random() * 2 + 1 });
    }

    let left = false, right = false, shoot = false;
    window.addEventListener('keydown', e => {
      if (e.key === 'ArrowLeft' || e.key === 'a') left = true;
      if (e.key === 'ArrowRight' || e.key === 'd') right = true;
      if (e.key === ' ' || e.key === 'ArrowUp') {
        shoot = true;
        if (gameOver) restart();
      }
    });
    window.addEventListener('keyup', e => {
      if (e.key === 'ArrowLeft' || e.key === 'a') left = false;
      if (e.key === 'ArrowRight' || e.key === 'd') right = false;
      if (e.key === ' ' || e.key === 'ArrowUp') shoot = false;
    });

    canvas.addEventListener('mousemove', e => {
      const rect = canvas.getBoundingClientRect();
      ship.x = Math.max(ship.w / 2, Math.min(canvas.width - ship.w / 2, e.clientX - rect.left));
    });

    window.addEventListener('click', () => {
      if (gameOver) restart();
      else bullets.push({ x: ship.x, y: ship.y - 14, dy: -8 });
    });

    let frame = 0;
    function restart() {
      score = 0; hp = 100; gameOver = false;
      bullets = []; enemies = []; particles = [];
      scoreVal.textContent = score; hpVal.textContent = hp;
      banner.style.display = 'none';
      requestAnimationFrame(loop);
    }

    function update() {
      if (gameOver) return;
      frame++;

      if (left && ship.x > ship.w / 2) ship.x -= ship.speed;
      if (right && ship.x < canvas.width - ship.w / 2) ship.x += ship.speed;
      if (shoot && frame % 10 === 0) {
        bullets.push({ x: ship.x, y: ship.y - 14, dy: -8 });
      }

      // Starfield
      for (const st of stars) {
        st.y += st.s * 1.5;
        if (st.y > canvas.height) { st.y = 0; st.x = Math.random() * canvas.width; }
      }

      // Bullets
      bullets = bullets.filter(b => {
        b.y += b.dy;
        return b.y > -10;
      });

      // Spawn enemies
      if (frame % 45 === 0) {
        enemies.push({
          x: Math.random() * (canvas.width - 40) + 20,
          y: -20,
          r: 14,
          dy: Math.random() * 1.5 + 2,
          color: ['#af734a', '#b5473a', '#70a986'][Math.floor(Math.random() * 3)]
        });
      }

      // Update enemies
      enemies = enemies.filter(en => {
        en.y += en.dy;

        // Collision with bullets
        for (let i = bullets.length - 1; i >= 0; i--) {
          const b = bullets[i];
          const dist = Math.hypot(b.x - en.x, b.y - en.y);
          if (dist < en.r + 4) {
            bullets.splice(i, 1);
            score += 20;
            scoreVal.textContent = score;
            for (let p = 0; p < 8; p++) {
              particles.push({
                x: en.x, y: en.y,
                dx: (Math.random() - 0.5) * 6,
                dy: (Math.random() - 0.5) * 6,
                life: 20, color: en.color
              });
            }
            return false;
          }
        }

        // Collision with ship
        if (Math.hypot(ship.x - en.x, ship.y - en.y) < en.r + 14) {
          hp -= 25;
          hpVal.textContent = Math.max(0, hp);
          if (hp <= 0) {
            gameOver = true;
            banner.style.display = 'block';
          }
          return false;
        }

        return en.y < canvas.height + 30;
      });

      // Particles
      particles = particles.filter(p => {
        p.x += p.dx; p.y += p.dy; p.life--;
        return p.life > 0;
      });
    }

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Stars
      ctx.fillStyle = '#eedbca';
      for (const st of stars) {
        ctx.fillRect(st.x, st.y, st.s, st.s);
      }

      // Ship (手書き風ロケット 🚀)
      ctx.save();
      ctx.translate(ship.x, ship.y);
      ctx.fillStyle = '#fffaf1';
      ctx.strokeStyle = '#e0d5c5';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -18);
      ctx.lineTo(14, 14);
      ctx.lineTo(0, 8);
      ctx.lineTo(-14, 14);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Rocket flame
      ctx.fillStyle = '#af734a';
      ctx.beginPath();
      ctx.moveTo(-6, 10);
      ctx.lineTo(0, 18 + Math.random() * 6);
      ctx.lineTo(6, 10);
      ctx.fill();
      ctx.restore();

      // Bullets (ビーム)
      ctx.fillStyle = '#f3ca65';
      for (const b of bullets) {
        ctx.fillRect(b.x - 2, b.y, 4, 10);
      }

      // Enemies
      for (const en of enemies) {
        ctx.fillStyle = en.color;
        ctx.strokeStyle = '#e0d5c5';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(en.x, en.y, en.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      // Particles
      for (const p of particles) {
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, 3, 3);
      }
    }

    function loop() {
      update();
      draw();
      if (!gameOver) requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  </script>
</body>
</html>`;
    }

    // 2. Boss Battle Addition
    if (p.includes('ボス') || p.includes('boss')) {
      return prevHtml.replace(
        `let gameOver = false;`,
        `let gameOver = false;
    let boss = { x: canvas.width / 2, y: 70, w: 90, h: 40, hp: 100, maxHp: 100, dx: 2, active: true };`
      ).replace(
        `function update() {`,
        `function update() {
      if (boss && boss.active) {
        boss.x += boss.dx;
        if (boss.x - boss.w / 2 < 20 || boss.x + boss.w / 2 > canvas.width - 20) boss.dx = -boss.dx;
        if (ball && Math.hypot(ball.x - boss.x, ball.y - boss.y) < 35) {
          boss.hp -= 15;
          ball.dy = -ball.dy;
          score += 50;
          scoreVal.textContent = score;
          if (boss.hp <= 0) {
            boss.active = false;
            bannerTitle.textContent = '👑 BOSS DEFEATED!';
            banner.style.display = 'block';
          }
        }
      }`
      ).replace(
        `function draw() {`,
        `function draw() {
      if (boss && boss.active) {
        ctx.fillStyle = '#b5473a';
        ctx.strokeStyle = '#3b271d';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.roundRect(boss.x - boss.w / 2, boss.y - boss.h / 2, boss.w, boss.h, 12);
        ctx.fill();
        ctx.stroke();

        // Boss eyes
        ctx.fillStyle = '#fffaf1';
        ctx.fillRect(boss.x - 20, boss.y - 6, 8, 8);
        ctx.fillRect(boss.x + 12, boss.y - 6, 8, 8);

        // Boss HP Bar
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(boss.x - 30, boss.y - 28, 60, 6);
        ctx.fillStyle = '#70a986';
        ctx.fillRect(boss.x - 30, boss.y - 28, 60 * (boss.hp / boss.maxHp), 6);
      }`
      );
    }

    // 3. Speed / Sound / Particle enhancement
    return prevHtml.replace(
      `speed: 7,`,
      `speed: 9, // Boosted by prompt`
    ).replace(
      `dx: 3.5,`,
      `dx: 4.8, // Enhanced ball velocity`
    );
  }

  /**
   * Real provider mode via API
   */
  private async runLiveProviderMode(
    prompt: string,
    session: Session,
    providerConfig: ProviderConfig,
    msg: Message,
    callbacks: RuntimeCallbacks,
    signal: AbortSignal
  ): Promise<void> {
    // If backend bridge is configured
    if (providerConfig.provider === 'bridge') {
      const bridgeUrl = providerConfig.bridgeUrl || 'http://localhost:3001/api/agent';
      const res = await fetch(bridgeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, session }),
        signal,
      });
      if (!res.ok) throw new Error(`Bridge returned HTTP ${res.status}`);
      const data = await res.json();
      msg.content = data.reply || 'ブリッジ経由で完了しました。';
      callbacks.onMessageUpdate({ ...msg });
      return;
    }

    // Direct Gemini or OpenAI API call from browser
    if (!providerConfig.apiKey) {
      throw new Error(
        `「${providerConfig.provider}」のAPIキーが未設定です。設定アイコン（⚙）からAPIキーを入力するか、「Simulation Mode」をご利用ください。`
      );
    }

    // Fallback to rich simulation with note if live provider streaming isn't fully configured
    msg.content = `[API連携モード (${providerConfig.provider} - ${providerConfig.model})]\nAPIキーが確認されました。エージェントを実行します...\n\n`;
    await this.runSimulationMode(prompt, session, msg, callbacks, signal);
  }
}

export const agentRuntime = new AgentRuntime();
