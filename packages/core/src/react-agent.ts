import { GoogleGenAI } from '@google/genai';
import { SubagentRunner } from './subagents/subagent-runner.js';
import { MELONPAN_TOOLS } from './tools/tool-definitions.js';
import { AgentEvent, LoadedSkill } from './types.js';
import { VirtualFS } from './vfs/virtual-fs.js';

export interface ReactAgentOptions {
  apiKey?: string;
  model?: string;
  thinkingLevel?: string;
  maxTurns?: number;
  simulate?: boolean;
  mode?: 'plan' | 'act' | 'auto';
  agentsDir?: string;
}

/**
 * ReAct (Reasoning + Acting) 自律エージェントループ
 * Gemini Function Calling を活用し、思考 ⇄ ツール実行 ⇄ 観測 ⇄ ファイル修正を自律的に繰り返します。
 * Clean-Room Sub-agent (researcher / code-reviewer) への委譲および Plan Mode に対応。
 */
export class ReactAgent {
  private apiKey: string;
  private model: string;
  private thinkingLevel: string;
  private maxTurns: number;
  private simulate: boolean;
  private mode: 'plan' | 'act' | 'auto';
  private subagentRunner: SubagentRunner;

  constructor(options: ReactAgentOptions = {}) {
    const envApiKey =
      typeof (globalThis as any).process !== 'undefined'
        ? (globalThis as any).process.env?.GEMINI_API_KEY
        : '';
    this.apiKey = options.apiKey || envApiKey || '';
    this.model = options.model || 'gemini-3.8-flash';
    this.thinkingLevel = options.thinkingLevel || 'high';
    this.maxTurns = options.maxTurns ?? 12;
    this.simulate = options.simulate ?? !this.apiKey;
    this.mode = options.mode || 'act';

    this.subagentRunner = new SubagentRunner({
      apiKey: this.apiKey,
      model: this.model,
      agentsDir: options.agentsDir,
      simulate: this.simulate,
    });
  }

  /**
   * ReAct自律ループを実行し、全イベントをリアルタイムに送出する
   */
  async *execute(
    prompt: string,
    skill: LoadedSkill | undefined,
    vfs: VirtualFS
  ): AsyncGenerator<AgentEvent, void, unknown> {
    const startTime = Date.now();

    // Plan Mode 開始イベントの送出
    if (this.mode === 'plan' || this.mode === 'auto') {
      yield {
        type: 'PLAN_STARTED',
        payload: {
          mode: this.mode,
          prompt,
        },
        timestamp: Date.now(),
      };
    }

    // 1. オフライン / テスト用確定型シミュレーションモード
    if (this.simulate) {
      yield* this.executeSimulation(prompt, skill, vfs, startTime);
      return;
    }

    // 2. 本番 Gemini ReAct ループ
    try {
      const ai = new GoogleGenAI({ apiKey: this.apiKey });

      let modeSpecificInstruction = '';
      if (this.mode === 'plan') {
        modeSpecificInstruction = `
OPERATIONAL MODE: [PLAN MODE]
- Your goal is strictly to analyze requirements and produce a thorough implementation plan.
- Use \`dispatch_subagent('researcher', ...)\` to research algorithms, Canvas physics, and visual aesthetics.
- Use \`write_file('plan.md', content)\` to draft the structured technical plan.
- Once plan.md is saved, call \`complete_task(summary)\` with the plan summary. Do NOT generate index.html in plan mode.
        `.trim();
      } else if (this.mode === 'auto') {
        modeSpecificInstruction = `
OPERATIONAL MODE: [AUTO MODE: Plan -> Implement -> Multi-Perspective Audit]
- Phase 1 (Plan): Dispatch \`researcher\` if needed, then write a concise technical design to \`plan.md\`.
- Phase 2 (Act): Implement the complete HTML5 Canvas game in \`index.html\`.
- Phase 3 (Audit): Call \`dispatch_subagent('code-reviewer', gameCode)\` to thoroughly audit the code.
- Phase 4 (Refine): If any warnings or issues were found, use \`edit_file\` to fix them, then call \`complete_task\`.
        `.trim();
      } else {
        modeSpecificInstruction = `
OPERATIONAL MODE: [ACT MODE]
- Implement the complete HTML5 Canvas game in \`index.html\` using \`write_file\`.
- You can dispatch \`researcher\` for technical questions, or \`code-reviewer\` to audit code before finalizing.
- When verified and fully playable, call \`complete_task\`.
        `.trim();
      }

      const activeSkillSection = skill
        ? `
==================================================
ACTIVE SKILL SPECIFICATION: [${skill.name}]
==================================================
${skill.instruction}`.trim()
        : `
==================================================
ACTIVE SKILL SPECIFICATION: [General Autonomous Agent]
==================================================
No specialized domain skill is active (all skills disabled or no specific match).
Rely on your core software engineering, creative design, and problem-solving capabilities to inspect the request, generate solutions, and verify deliverables.`.trim();

      const systemInstruction = `
You are an autonomous elite creative technologist and game engineer powered by Melonpan Core.
You operate in a strict ReAct (Reasoning + Acting) loop.

YOUR WORKSPACE TOOLS:
1. write_file(path, content): Create or overwrite a file in the virtual filesystem.
2. edit_file(path, search, replace): Modify an existing file with exact search/replace.
3. dispatch_subagent(agent_type, task_prompt): Delegate research or code review to a clean-room subagent ('researcher' or 'code-reviewer').
4. complete_task(summary): Declare that the implementation is verified, fully playable, and complete.

${modeSpecificInstruction}

${activeSkillSection}
`.trim();

      const config: Record<string, any> = {
        systemInstruction,
        tools: MELONPAN_TOOLS,
      };

      // thinkingConfig による推論レベル（thinking level / effort）の設定
      const thinkingLevelUpper = (this.thinkingLevel || 'high').toUpperCase();
      const validLevels = ['MINIMAL', 'LOW', 'MEDIUM', 'HIGH'];
      if (validLevels.includes(thinkingLevelUpper)) {
        config.thinkingConfig = {
          includeThoughts: true,
          thinkingLevel: thinkingLevelUpper,
        };
      } else {
        config.thinkingConfig = {
          includeThoughts: true,
        };
      }

      const chat = ai.chats.create({
        model: this.model,
        config,
      });

      let turns = 0;
      let currentMessage: any = prompt;
      let totalPromptTokens = 0;
      let totalCompletionTokens = 0;

      while (turns < this.maxTurns) {
        turns++;

        const response = await chat.sendMessage({
          message: currentMessage,
        });

        // トークン使用量の集計 (usageMetadata)
        const usageMeta = (response as any).usageMetadata;
        if (usageMeta) {
          totalPromptTokens += usageMeta.promptTokenCount || 0;
          totalCompletionTokens += usageMeta.candidatesTokenCount || 0;
        }

        // 思考 (Thought) の抽出と配信
        if (response.text && response.text.trim()) {
          yield {
            type: 'THOUGHT',
            payload: { thought: response.text.trim() },
            timestamp: Date.now(),
          };
        }

        const functionCalls = response.functionCalls;

        if (functionCalls && functionCalls.length > 0) {
          const functionResponses: any[] = [];
          let isComplete = false;
          let completionSummary = '';

          for (const call of functionCalls) {
            yield {
              type: 'TOOL_CALL',
              payload: {
                name: call.name,
                args: call.args || {},
                callId: call.id,
              },
              timestamp: Date.now(),
            };

            if (call.name === 'write_file') {
              const pathArg = String(call.args?.path || 'index.html');
              const contentArg = String(call.args?.content || '');
              vfs.writeFile(pathArg, contentArg);

              yield {
                type: 'FILE_CHANGED',
                payload: {
                  path: pathArg,
                  action: 'write',
                  size: contentArg.length,
                },
                timestamp: Date.now(),
              };

              // plan.md が書き出された場合は PLAN_CREATED を送出
              if (pathArg === 'plan.md' || pathArg.endsWith('/plan.md')) {
                yield {
                  type: 'PLAN_CREATED',
                  payload: {
                    plan: contentArg,
                    path: pathArg,
                  },
                  timestamp: Date.now(),
                };
              }

              const observation = `Successfully wrote ${contentArg.length} characters to "${pathArg}".`;
              yield {
                type: 'TOOL_RESULT',
                payload: {
                  name: 'write_file',
                  result: observation,
                  callId: call.id,
                },
                timestamp: Date.now(),
              };

              functionResponses.push({
                functionResponse: {
                  name: 'write_file',
                  response: { output: observation },
                  id: call.id,
                },
              });
            } else if (call.name === 'edit_file') {
              const pathArg = String(call.args?.path || '');
              const searchArg = String(call.args?.search || '');
              const replaceArg = String(call.args?.replace || '');

              const editRes = vfs.editFile(pathArg, searchArg, replaceArg);
              if (editRes.success) {
                yield {
                  type: 'FILE_CHANGED',
                  payload: {
                    path: pathArg,
                    action: 'edit',
                    size: vfs.readFile(pathArg)?.length || 0,
                    diffSummary: editRes.diffSummary,
                  },
                  timestamp: Date.now(),
                };
              }

              const observation = editRes.success
                ? editRes.diffSummary!
                : `Error: ${editRes.error}`;

              yield {
                type: 'TOOL_RESULT',
                payload: {
                  name: 'edit_file',
                  result: observation,
                  isError: !editRes.success,
                  callId: call.id,
                },
                timestamp: Date.now(),
              };

              functionResponses.push({
                functionResponse: {
                  name: 'edit_file',
                  response: { output: observation },
                  id: call.id,
                },
              });
            } else if (call.name === 'dispatch_subagent') {
              const agentType = String(call.args?.agent_type || 'researcher');
              const taskPrompt = String(call.args?.task_prompt || '');
              const subStartTime = Date.now();

              yield {
                type: 'SUBAGENT_DISPATCHED',
                payload: {
                  agentType,
                  taskPrompt,
                  callId: call.id,
                },
                timestamp: Date.now(),
              };

              // Clean-room isolation 実行
              const subResult = await this.subagentRunner.run(agentType, taskPrompt);
              const durationMs = Date.now() - subStartTime;

              yield {
                type: 'SUBAGENT_COMPLETED',
                payload: {
                  agentType,
                  result: subResult,
                  durationMs,
                  callId: call.id,
                },
                timestamp: Date.now(),
              };

              const observation = `[Clean-Room Sub-agent: ${agentType} Report]\n${subResult}`;
              yield {
                type: 'TOOL_RESULT',
                payload: {
                  name: 'dispatch_subagent',
                  result: observation,
                  callId: call.id,
                },
                timestamp: Date.now(),
              };

              functionResponses.push({
                functionResponse: {
                  name: 'dispatch_subagent',
                  response: { output: observation },
                  id: call.id,
                },
              });
            } else if (call.name === 'complete_task') {
              isComplete = true;
              completionSummary = String(
                call.args?.summary || 'Task completed successfully.'
              );

              const observation = `Task completion confirmed.`;
              yield {
                type: 'TOOL_RESULT',
                payload: {
                  name: 'complete_task',
                  result: observation,
                  callId: call.id,
                },
                timestamp: Date.now(),
              };

              functionResponses.push({
                functionResponse: {
                  name: 'complete_task',
                  response: { output: observation },
                  id: call.id,
                },
              });
            } else {
              const observation = `Unknown tool "${call.name}". Please use write_file, edit_file, dispatch_subagent, or complete_task.`;
              yield {
                type: 'TOOL_RESULT',
                payload: {
                  name: call.name,
                  result: observation,
                  isError: true,
                  callId: call.id,
                },
                timestamp: Date.now(),
              };

              functionResponses.push({
                functionResponse: {
                  name: call.name,
                  response: { error: observation },
                  id: call.id,
                },
              });
            }
          }

          if (isComplete) {
            yield {
              type: 'COMPLETE',
              payload: {
                summary: completionSummary,
                files: vfs.getFiles(),
                turns,
                durationMs: Date.now() - startTime,
                usage: {
                  promptTokens: totalPromptTokens,
                  completionTokens: totalCompletionTokens,
                  totalTokens: totalPromptTokens + totalCompletionTokens,
                },
              },
              timestamp: Date.now(),
            };
            return;
          }

          // 次のターンへツール観測結果を返却
          currentMessage = functionResponses;
        } else {
          // ツール呼び出しがなかった場合はツール実行を促す
          currentMessage =
            'Please proceed by calling write_file to create index.html, dispatch_subagent to review, or complete_task if finished.';
        }
      }

      // 最大ターン数到達
      yield {
        type: 'COMPLETE',
        payload: {
          summary: `Execution ended after reaching maximum allowed turns (${this.maxTurns}).`,
          files: vfs.getFiles(),
          turns,
          durationMs: Date.now() - startTime,
          usage: {
            promptTokens: totalPromptTokens,
            completionTokens: totalCompletionTokens,
            totalTokens: totalPromptTokens + totalCompletionTokens,
          },
        },
        timestamp: Date.now(),
      };
    } catch (err: any) {
      yield {
        type: 'ERROR',
        payload: {
          error: err instanceof Error ? err : new Error(String(err)),
          phase: 'react_loop',
        },
        timestamp: Date.now(),
      };
    }
  }

  /**
   * オフライン / テスト用決定論的 ReAct シミュレーション (Plan Mode & Sub-agents 対応)
   */
  private async *executeSimulation(
    prompt: string,
    skill: LoadedSkill | undefined,
    vfs: VirtualFS,
    startTime: number
  ): AsyncGenerator<AgentEvent, void, unknown> {
    // ------------------------------------------------------------------
    // Case A: Plan Mode (計画書作成のみを行い停止)
    // ------------------------------------------------------------------
    if (this.mode === 'plan') {
      yield {
        type: 'THOUGHT',
        payload: {
          thought: `[Plan Mode] Entering planning phase for "${prompt}". Dispatching "researcher" sub-agent for physics and visual architecture recommendations.`,
        },
        timestamp: Date.now(),
      };

      // 1. Dispatch researcher
      yield {
        type: 'TOOL_CALL',
        payload: {
          name: 'dispatch_subagent',
          args: {
            agent_type: 'researcher',
            task_prompt: `Investigate physics and HUD layout for "${prompt}".`,
          },
          callId: 'sim-sub-1',
        },
        timestamp: Date.now(),
      };

      yield {
        type: 'SUBAGENT_DISPATCHED',
        payload: {
          agentType: 'researcher',
          taskPrompt: `Investigate physics and HUD layout for "${prompt}".`,
          callId: 'sim-sub-1',
        },
        timestamp: Date.now(),
      };

      const researchReport = await this.subagentRunner.run('researcher', prompt);

      yield {
        type: 'SUBAGENT_COMPLETED',
        payload: {
          agentType: 'researcher',
          result: researchReport,
          durationMs: 5,
          callId: 'sim-sub-1',
        },
        timestamp: Date.now(),
      };

      yield {
        type: 'TOOL_RESULT',
        payload: {
          name: 'dispatch_subagent',
          result: `[Clean-Room Sub-agent: researcher Report]\n${researchReport}`,
          callId: 'sim-sub-1',
        },
        timestamp: Date.now(),
      };

      // 2. Write plan.md
      const planContent = [
        `# Implementation Plan: ${prompt}`,
        '',
        '## 1. Architecture & Components',
        '- Canvas: 440x680 responsive cyber-neon layout.',
        '- HUD: Glassmorphism overlay bar with Orbitron typography.',
        '- Audio: Synthesized Web Audio API bleeps.',
        '',
        '## 2. Research Findings',
        researchReport,
        '',
        '## 3. Milestones',
        '- [ ] Setup canvas container and glassmorphic HUD bar.',
        '- [ ] Implement player movement and dual keyboard/touch controls.',
        '- [ ] Implement game loop and particle explosion engine.',
      ].join('\n');

      yield {
        type: 'THOUGHT',
        payload: {
          thought: 'Drafting structured technical plan in "plan.md" based on research findings.',
        },
        timestamp: Date.now(),
      };

      yield {
        type: 'TOOL_CALL',
        payload: {
          name: 'write_file',
          args: { path: 'plan.md', content: planContent },
          callId: 'sim-plan-write',
        },
        timestamp: Date.now(),
      };

      vfs.writeFile('plan.md', planContent);

      yield {
        type: 'FILE_CHANGED',
        payload: { path: 'plan.md', action: 'write', size: planContent.length },
        timestamp: Date.now(),
      };

      yield {
        type: 'PLAN_CREATED',
        payload: { plan: planContent, path: 'plan.md' },
        timestamp: Date.now(),
      };

      yield {
        type: 'TOOL_RESULT',
        payload: {
          name: 'write_file',
          result: `Successfully wrote plan.md.`,
          callId: 'sim-plan-write',
        },
        timestamp: Date.now(),
      };

      // 3. Complete Task
      const planSummary = 'Plan Mode finalized. Technical design generated in plan.md.';
      yield {
        type: 'TOOL_CALL',
        payload: {
          name: 'complete_task',
          args: { summary: planSummary },
          callId: 'sim-plan-complete',
        },
        timestamp: Date.now(),
      };

      yield {
        type: 'COMPLETE',
        payload: {
          summary: planSummary,
          files: vfs.getFiles(),
          turns: 2,
          durationMs: Date.now() - startTime,
          usage: {
            promptTokens: 1250,
            completionTokens: 450,
            totalTokens: 1700,
          },
        },
        timestamp: Date.now(),
      };
      return;
    }

    // ------------------------------------------------------------------
    // Case B & C: Auto Mode or Act Mode with Sub-agents
    // ------------------------------------------------------------------
    let turnsCount = 0;

    // Auto Mode: Phase 1 Researcher & Plan
    if (this.mode === 'auto') {
      turnsCount++;
      yield {
        type: 'THOUGHT',
        payload: {
          thought: `[Auto Mode: Phase 1] Dispatching "researcher" sub-agent to investigate optimal mechanics and visual constraints.`,
        },
        timestamp: Date.now(),
      };

      yield {
        type: 'TOOL_CALL',
        payload: {
          name: 'dispatch_subagent',
          args: {
            agent_type: 'researcher',
            task_prompt: `Research mechanics and visual HUD for "${prompt}".`,
          },
          callId: 'sim-sub-res',
        },
        timestamp: Date.now(),
      };

      yield {
        type: 'SUBAGENT_DISPATCHED',
        payload: {
          agentType: 'researcher',
          taskPrompt: `Research mechanics and visual HUD for "${prompt}".`,
          callId: 'sim-sub-res',
        },
        timestamp: Date.now(),
      };

      const resReport = await this.subagentRunner.run('researcher', prompt);

      yield {
        type: 'SUBAGENT_COMPLETED',
        payload: {
          agentType: 'researcher',
          result: resReport,
          durationMs: 4,
          callId: 'sim-sub-res',
        },
        timestamp: Date.now(),
      };

      yield {
        type: 'TOOL_RESULT',
        payload: {
          name: 'dispatch_subagent',
          result: `[Clean-Room Sub-agent: researcher Report]\n${resReport}`,
          callId: 'sim-sub-res',
        },
        timestamp: Date.now(),
      };

      // Write plan.md
      const autoPlan = `# Plan: ${prompt}\n\n${resReport}\n\n- Implementation file: index.html`;
      vfs.writeFile('plan.md', autoPlan);
      yield {
        type: 'PLAN_CREATED',
        payload: { plan: autoPlan, path: 'plan.md' },
        timestamp: Date.now(),
      };
    }

    // Phase 2: Act (Write index.html)
    turnsCount++;
    yield {
      type: 'THOUGHT',
      payload: {
        thought: `[ReAct: Implementation] Writing complete cyber-neon HTML5 Canvas arcade game to "index.html" with Orbitron typography, glassmorphism HUD, particle engine, and touch/keyboard controls.`,
      },
      timestamp: Date.now(),
    };

    const simulatedHtml = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>CYBER STRIKE - Melonpan Canvas Arcade</title>
  <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@700;900&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0; padding: 0; overflow: hidden; background: #0a0a16;
      display: flex; justify-content: center; align-items: center;
      height: 100vh; font-family: 'Orbitron', monospace; touch-action: none;
    }
    #game-container {
      position: relative; width: 440px; height: 680px; max-width: 100vw; max-height: 100vh;
      border: 1px solid rgba(0, 240, 255, 0.4); border-radius: 12px;
      box-shadow: 0 0 30px rgba(0, 240, 255, 0.25); overflow: hidden;
    }
    #hud {
      position: absolute; top: 0; left: 0; width: 100%; height: 50px;
      background: rgba(10, 10, 22, 0.75); backdrop-filter: blur(10px);
      border-bottom: 1px solid rgba(0, 240, 255, 0.3);
      display: flex; justify-content: space-between; align-items: center;
      padding: 0 16px; color: #00f0ff; z-index: 10; font-size: 14px;
    }
    .hud-val { color: #fff; font-weight: 900; margin-left: 4px; text-shadow: 0 0 8px #00f0ff; }
    canvas { display: block; width: 100%; height: 100%; background: #05050f; }
  </style>
</head>
<body>
  <div id="game-container">
    <div id="hud">
      <div>SCORE: <span id="score-val" class="hud-val">0</span></div>
      <div>STAGE: <span id="stage-val" class="hud-val">1</span></div>
      <div>LIVES: <span id="lives-val" class="hud-val">♥♥♥</span></div>
    </div>
    <canvas id="c" width="440" height="680"></canvas>
  </div>
  <script>
    const canvas = document.getElementById('c');
    const ctx = canvas.getContext('2d');
    const scoreVal = document.getElementById('score-val');
    let score = 0, stage = 1, lives = 3, gameOver = false;
    let player = { x: 220, y: 580, w: 40, h: 20, vx: 0 };
    let bullets = [], enemies = [], particles = [];

    window.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'a') { player.vx = -7; e.preventDefault(); }
      if (e.key === 'ArrowRight' || e.key === 'd') { player.vx = 7; e.preventDefault(); }
      if (e.key === ' ' || e.key === 'Enter') {
        if (gameOver) restart();
        else shoot();
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => {
      if (['ArrowLeft', 'ArrowRight', 'a', 'd'].includes(e.key)) player.vx = 0;
    });

    canvas.addEventListener('pointerdown', (e) => {
      if (gameOver) { restart(); return; }
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) * (canvas.width / rect.width);
      player.x = x;
      shoot();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (gameOver) return;
      const rect = canvas.getBoundingClientRect();
      player.x = (e.clientX - rect.left) * (canvas.width / rect.width);
    });

    function shoot() {
      bullets.push({ x: player.x, y: player.y - 10, vy: -12 });
    }

    function createExplosion(x, y, color) {
      for (let i = 0; i < 16; i++) {
        particles.push({
          x, y,
          vx: (Math.random() - 0.5) * 8,
          vy: (Math.random() - 0.5) * 8,
          alpha: 1,
          color
        });
      }
    }

    function restart() {
      score = 0; stage = 1; lives = 3; gameOver = false;
      enemies = []; bullets = []; particles = [];
      scoreVal.textContent = score;
      loop();
    }

    setInterval(() => {
      if (!gameOver && enemies.length < 8) {
        enemies.push({
          x: Math.random() * (canvas.width - 30) + 15,
          y: 70,
          w: 30, h: 24,
          vy: 2 + Math.random() * 2
        });
      }
    }, 1200);

    function loop() {
      if (gameOver) {
        ctx.fillStyle = 'rgba(10, 10, 22, 0.85)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#ff007f';
        ctx.font = '900 32px Orbitron';
        ctx.textAlign = 'center';
        ctx.fillText('MISSION FAILED', 220, 320);
        ctx.fillStyle = '#00f0ff';
        ctx.font = '16px Orbitron';
        ctx.fillText('TAP OR PRESS SPACE TO RETRY', 220, 370);
        return;
      }

      ctx.fillStyle = '#05050f';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      player.x += player.vx;
      player.x = Math.max(player.w / 2, Math.min(canvas.width - player.w / 2, player.x));

      // Player glow
      ctx.shadowBlur = 12; ctx.shadowColor = '#00f0ff';
      ctx.fillStyle = '#00f0ff';
      ctx.beginPath();
      ctx.moveTo(player.x, player.y - 15);
      ctx.lineTo(player.x - player.w / 2, player.y + 10);
      ctx.lineTo(player.x + player.w / 2, player.y + 10);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;

      // Bullets
      ctx.fillStyle = '#ffe600';
      ctx.shadowBlur = 8; ctx.shadowColor = '#ffe600';
      for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.y += b.vy;
        ctx.fillRect(b.x - 2, b.y - 6, 4, 12);
        if (b.y < 50) bullets.splice(i, 1);
      }
      ctx.shadowBlur = 0;

      // Enemies
      ctx.fillStyle = '#ff007f';
      ctx.shadowBlur = 10; ctx.shadowColor = '#ff007f';
      for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];
        e.y += e.vy;
        ctx.fillRect(e.x - e.w / 2, e.y, e.w, e.h);

        for (let j = bullets.length - 1; j >= 0; j--) {
          const b = bullets[j];
          if (Math.abs(b.x - e.x) < e.w / 2 && Math.abs(b.y - e.y) < e.h / 2) {
            createExplosion(e.x, e.y, '#ff007f');
            enemies.splice(i, 1);
            bullets.splice(j, 1);
            score += 100;
            scoreVal.textContent = score;
            break;
          }
        }

        if (e && e.y > canvas.height - 40) {
          enemies.splice(i, 1);
          lives--;
          document.getElementById('lives-val').textContent = '♥'.repeat(Math.max(0, lives));
          if (lives <= 0) gameOver = true;
        }
      }
      ctx.shadowBlur = 0;

      // Particles
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx; p.y += p.vy; p.alpha -= 0.03;
        if (p.alpha <= 0) {
          particles.splice(i, 1);
        } else {
          ctx.fillStyle = p.color;
          ctx.globalAlpha = p.alpha;
          ctx.fillRect(p.x, p.y, 3, 3);
          ctx.globalAlpha = 1.0;
        }
      }

      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  </script>
</body>
</html>`;

    yield {
      type: 'TOOL_CALL',
      payload: {
        name: 'write_file',
        args: { path: 'index.html', content: simulatedHtml },
        callId: 'sim-call-write',
      },
      timestamp: Date.now(),
    };

    vfs.writeFile('index.html', simulatedHtml);

    yield {
      type: 'FILE_CHANGED',
      payload: {
        path: 'index.html',
        action: 'write',
        size: simulatedHtml.length,
      },
      timestamp: Date.now(),
    };

    yield {
      type: 'TOOL_RESULT',
      payload: {
        name: 'write_file',
        result: `Successfully wrote ${simulatedHtml.length} characters to "index.html".`,
        callId: 'sim-call-write',
      },
      timestamp: Date.now(),
    };

    // Phase 3: Code Review (Sub-agent)
    turnsCount++;
    yield {
      type: 'THOUGHT',
      payload: {
        thought: `[ReAct: Multi-Perspective Audit] Dispatching "code-reviewer" sub-agent to audit performance, security, and UI/UX polish.`,
      },
      timestamp: Date.now(),
    };

    yield {
      type: 'TOOL_CALL',
      payload: {
        name: 'dispatch_subagent',
        args: {
          agent_type: 'code-reviewer',
          task_prompt: `Audit "index.html" (${simulatedHtml.length} chars) for performance, security, and neon visual polish.`,
        },
        callId: 'sim-sub-review',
      },
      timestamp: Date.now(),
    };

    yield {
      type: 'SUBAGENT_DISPATCHED',
      payload: {
        agentType: 'code-reviewer',
        taskPrompt: `Audit "index.html" (${simulatedHtml.length} chars) for performance, security, and neon visual polish.`,
        callId: 'sim-sub-review',
      },
      timestamp: Date.now(),
    };

    const reviewReport = await this.subagentRunner.run('code-reviewer', simulatedHtml);

    yield {
      type: 'SUBAGENT_COMPLETED',
      payload: {
        agentType: 'code-reviewer',
        result: reviewReport,
        durationMs: 6,
        callId: 'sim-sub-review',
      },
      timestamp: Date.now(),
    };

    yield {
      type: 'TOOL_RESULT',
      payload: {
        name: 'dispatch_subagent',
        result: `[Clean-Room Sub-agent: code-reviewer Report]\n${reviewReport}`,
        callId: 'sim-sub-review',
      },
      timestamp: Date.now(),
    };

    // Phase 4: Complete
    turnsCount++;
    yield {
      type: 'THOUGHT',
      payload: {
        thought:
          'Code review passed with APPROVED verdict. Verification confirmed. Finalizing task.',
      },
      timestamp: Date.now(),
    };

    const summary =
      'Implemented full standalone cyber-neon HTML5 Canvas arcade game with glassmorphic overlay HUD, Orbitron typography, particle explosion system, and responsive touch/keyboard controls. Validated by clean-room code reviewer.';

    yield {
      type: 'TOOL_CALL',
      payload: {
        name: 'complete_task',
        args: { summary },
        callId: 'sim-call-complete',
      },
      timestamp: Date.now(),
    };

    yield {
      type: 'TOOL_RESULT',
      payload: {
        name: 'complete_task',
        result: 'Task completion confirmed.',
        callId: 'sim-call-complete',
      },
      timestamp: Date.now(),
    };

    yield {
      type: 'COMPLETE',
      payload: {
        summary,
        files: vfs.getFiles(),
        turns: turnsCount,
        durationMs: Date.now() - startTime,
        usage: {
          promptTokens: turnsCount * 1400,
          completionTokens: turnsCount * 650,
          totalTokens: turnsCount * 2050,
        },
      },
      timestamp: Date.now(),
    };
  }
}
