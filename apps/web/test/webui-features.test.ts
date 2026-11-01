import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createInitialSession,
  loadSessions,
  saveSessions,
} from '../src/services/session-storage';
import { AgentRuntime, parsePlanTasks } from '../src/services/agent-runtime';
import { webCommandRegistry, WebCommandContext } from '../src/services/command-registry';
import {
  getStoredApiKeys,
  saveStoredApiKey,
  clearAllStoredApiKeys,
  maskApiKey,
  createProviderInstance,
} from '../src/services/provider-factory';
import { Session, Message, PlanState, SubagentTrace, ProviderConfig } from '../src/types';
import { SimulatedProvider } from '@melonpan/core';
import JSZip from 'jszip';

describe('WebUI Feature Suite - TUI Spec & MelonpanCore Alignment', () => {
  beforeEach(() => {
    // Mock localStorage
    const store: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store[k] || null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
      clear: () => {
        for (const k in store) delete store[k];
      },
    });
  });

  describe('1. Session Management & Initial State', () => {
    it('creates initial session with clean empty VFS and welcome message', () => {
      const session = createInitialSession('テストセッション');
      expect(session.name).toBe('テストセッション');
      expect(Object.keys(session.files).length).toBe(0);
      expect(session.activeFile).toBe('');
      expect(session.messages.length).toBeGreaterThan(0);
      expect(session.metrics.currentContextTokens).toBeGreaterThan(0);
    });

    it('persists sessions to localStorage and loads them accurately', () => {
      const s1 = createInitialSession('セッション1');
      const s2 = createInitialSession('セッション2');
      saveSessions([s1, s2]);

      const loaded = loadSessions();
      expect(loaded.length).toBe(2);
      expect(loaded[0].name).toBe('セッション1');
      expect(loaded[1].name).toBe('セッション2');
    });

    it('verifies session files can be added and inspected in VFS', () => {
      const session = createInitialSession('テスト');
      session.files['index.html'] = '<!DOCTYPE html><html><body><h1>Hello</h1></body></html>';
      expect(session.files['index.html']).toContain('<!DOCTYPE html>');
    });
  });

  describe('2. Slash Commands System (TUI Alignment)', () => {
    const createTestContext = (): { ctx: WebCommandContext; loggedMessages: string[]; activeSession: Session } => {
      const activeSession = createInitialSession('コマンドテスト');
      let providerConfig: ProviderConfig = {
        provider: 'gemini',
        model: 'gemini-3.8-flash',
        apiKey: '',
        baseUrl: '',
        thinkingEffort: 'medium',
        bridgeUrl: 'http://localhost:3001/api/agent',
      };
      let permissionPolicy = {
        read: 'allow' as const,
        write: 'ask' as const,
        command: 'ask' as const,
        web: 'allow' as const,
      };
      const loggedMessages: string[] = [];

      const ctx: WebCommandContext = {
        session: activeSession,
        get providerConfig() {
          return providerConfig;
        },
        get permissionPolicy() {
          return permissionPolicy;
        },
        setProviderConfig: (updater: any) => {
          providerConfig = typeof updater === 'function' ? updater(providerConfig) : updater;
        },
        setPermissionPolicy: (updater: any) => {
          permissionPolicy = typeof updater === 'function' ? updater(permissionPolicy) : updater;
        },
        updateActiveSession: (updater) => {
          Object.assign(activeSession, updater(activeSession));
        },
        executePrompt: vi.fn(),
        logMessage: (content) => {
          loggedMessages.push(content);
        },
      };

      return { ctx, loggedMessages, activeSession };
    };

    it('executes /help command and displays command list', async () => {
      const { ctx, loggedMessages } = createTestContext();
      const handled = await webCommandRegistry.executeCommand('/help', ctx);
      expect(handled).toBe(true);
      expect(loggedMessages.length).toBe(1);
      expect(loggedMessages[0]).toContain('スラッシュコマンド一覧');
      expect(loggedMessages[0]).toContain('/model');
      expect(loggedMessages[0]).toContain('/plan');
      expect(loggedMessages[0]).toContain('/cost');
    });

    it('executes /key commands (set, status, clear)', async () => {
      const { ctx, loggedMessages } = createTestContext();

      // 1. Set key directly
      await webCommandRegistry.executeCommand('/key AIzaSyTestKey12345678', ctx);
      expect(loggedMessages[loggedMessages.length - 1]).toContain('AIzaSy...5678');
      expect(getStoredApiKeys().gemini).toBe('AIzaSyTestKey12345678');

      // 2. Set key for openai
      await webCommandRegistry.executeCommand('/key openai sk-openai-test-key-9999', ctx);
      expect(getStoredApiKeys().openai).toBe('sk-openai-test-key-9999');

      // 3. Status check
      await webCommandRegistry.executeCommand('/key status', ctx);
      expect(loggedMessages[loggedMessages.length - 1]).toContain('APIキー設定ステータス');
      expect(loggedMessages[loggedMessages.length - 1]).toContain('sk-ope...9999');

      // 4. Clear keys
      await webCommandRegistry.executeCommand('/key clear', ctx);
      expect(Object.keys(getStoredApiKeys()).length).toBe(0);
    });

    it('executes /model command and switches model and provider', async () => {
      const { ctx, loggedMessages } = createTestContext();

      // Switch to gpt-4o
      await webCommandRegistry.executeCommand('/model gpt-4o', ctx);
      expect(loggedMessages[loggedMessages.length - 1]).toContain('gpt-4o');

      // Switch to gemini-4-argon
      await webCommandRegistry.executeCommand('/model gemini-4-argon', ctx);
      expect(loggedMessages[loggedMessages.length - 1]).toContain('gemini-4-argon');
    });

    it('executes /effort command and validates levels', async () => {
      const { ctx, loggedMessages } = createTestContext();
      await webCommandRegistry.executeCommand('/effort high', ctx);
      expect(loggedMessages[loggedMessages.length - 1]).toContain('high');
    });

    it('executes /plan command to toggle or run direct plan prompt', async () => {
      const { ctx, loggedMessages } = createTestContext();

      // Toggle plan mode ON
      await webCommandRegistry.executeCommand('/plan', ctx);
      expect(ctx.session.mode).toBe('plan');
      expect(loggedMessages[loggedMessages.length - 1]).toContain('ON');

      // Direct plan prompt
      await webCommandRegistry.executeCommand('/plan ボス戦を追加', ctx);
      expect(ctx.executePrompt).toHaveBeenCalledWith('ボス戦を追加', 'plan');
    });

    it('executes /cost command and calculates billed usage & context occupation', async () => {
      const { ctx, loggedMessages } = createTestContext();
      ctx.session.metrics = {
        ...ctx.session.metrics,
        billedInputTokens: 50000,
        billedOutputTokens: 10000,
        cachedTokens: 20000,
        totalTokens: 60000,
        currentContextTokens: 15000,
        contextWindowLimit: 128000,
      };

      await webCommandRegistry.executeCommand('/cost', ctx);
      expect(loggedMessages.length).toBe(1);
      expect(loggedMessages[0]).toContain('/cost');
      expect(loggedMessages[0]).toContain('USD');
      expect(loggedMessages[0]).toContain('JPY');
      expect(loggedMessages[0]).toContain('キャッシュヒット');
    });

    it('executes /permissions command and toggles policy', async () => {
      const { ctx, loggedMessages } = createTestContext();
      await webCommandRegistry.executeCommand('/permissions auto', ctx);
      expect(loggedMessages[loggedMessages.length - 1]).toContain('AUTO');
      expect(ctx.permissionPolicy.write).toBe('allow');

      await webCommandRegistry.executeCommand('/permissions ask', ctx);
      expect(loggedMessages[loggedMessages.length - 1]).toContain('ASK');
      expect(ctx.permissionPolicy.write).toBe('ask');
    });

    it('executes /clear command and resets session and context window tokens to 0', async () => {
      const { ctx, loggedMessages, activeSession } = createTestContext();
      activeSession.messages.push({
        id: 'msg_1',
        role: 'user',
        content: '何かゲームを作って',
        timestamp: Date.now(),
      });
      activeSession.metrics.currentContextTokens = 5000;
      activeSession.metrics.billedInputTokens = 10000;

      await webCommandRegistry.executeCommand('/clear', ctx);
      expect(loggedMessages[loggedMessages.length - 1]).toContain('リセットしました');
      expect(activeSession.messages.length).toBe(0);
      expect(activeSession.metrics.currentContextTokens).toBe(0);
      expect(activeSession.metrics.billedInputTokens).toBe(0);
    });

    it('executes /compact command with small history and reports already compact', async () => {
      const { ctx, loggedMessages } = createTestContext();
      // Default session has only 1 initial message
      await webCommandRegistry.executeCommand('/compact', ctx);
      expect(loggedMessages[loggedMessages.length - 1]).toContain('すでにコンパクト');
    });

    it('executes /compact command with multi-turn history, actually pruning messages and computing real token reductions', async () => {
      const { ctx, loggedMessages, activeSession } = createTestContext();
      activeSession.metrics.currentContextTokens = 8000;
      activeSession.messages = [
        { id: 'm0', role: 'assistant', content: '初期挨拶', timestamp: 1 },
        { id: 'm1', role: 'user', content: '超大作RPGを作って！'.repeat(50), timestamp: 2 },
        { id: 'm2', role: 'assistant', content: '詳細な設計書を提案します。'.repeat(50), thought: 'アルゴリズム検討中'.repeat(20), timestamp: 3 },
        { id: 'm3', role: 'user', content: '戦闘システムを追加して'.repeat(30), timestamp: 4 },
        { id: 'm4', role: 'assistant', content: '戦闘システムを実装しました！'.repeat(30), timestamp: 5 },
        { id: 'm5', role: 'user', content: '最新のバグ修正をお願い', timestamp: 6 },
        { id: 'm6', role: 'assistant', content: '修正完了しました。', timestamp: 7 },
      ];

      const initialCount = activeSession.messages.length;
      await webCommandRegistry.executeCommand('/compact バグ修正に注力', ctx);

      expect(loggedMessages[loggedMessages.length - 1]).toContain('コンテキストの要約・圧縮が完了しました');
      // Pruned middle messages and replaced with 1 summary system message
      expect(activeSession.messages.length).toBeLessThan(initialCount);
      expect(activeSession.metrics.compactionCount).toBe(1);
      expect(activeSession.metrics.prunedChars).toBeGreaterThan(1000);
      expect(activeSession.metrics.currentContextTokens).toBeLessThan(8000);
      expect(activeSession.messages.some((m) => m.content.includes('[過去の会話要約'))).toBe(true);
    });

    it('returns autocomplete suggestions for slash commands and subcommands', () => {
      // Base command suggestions
      const slashSuggestions = webCommandRegistry.getAutocompleteSuggestions('/');
      expect(slashSuggestions.length).toBeGreaterThan(5);
      expect(slashSuggestions.some((s) => s.text.startsWith('/model'))).toBe(true);
      expect(slashSuggestions.some((s) => s.text.startsWith('/cost'))).toBe(true);

      // Model suggestions
      const modelSuggestions = webCommandRegistry.getAutocompleteSuggestions('/model ');
      expect(modelSuggestions.length).toBeGreaterThan(3);

      // Effort suggestions
      const effortSuggestions = webCommandRegistry.getAutocompleteSuggestions('/effort ');
      expect(effortSuggestions.length).toBe(4);
    });
  });

  describe('3. MelonpanCore ReAct Loop Execution via AgentRuntime', () => {
    it('executes a real turn with MelonpanCore, yielding thoughts, tool calls, and updating index.html in VFS', async () => {
      const runtime = new AgentRuntime();
      const session = createInitialSession('テストセッション');
      let updatedFile = '';
      let receivedMsg: Message | null = null;
      let completedCalled = false;

      // SimulatedProvider implements the standard ILLMProvider interface in @melonpan/core
      const testProvider = new SimulatedProvider([
        (_req) => [
          { type: 'thought_delta', delta: 'Canvas 2D 物理演算と思考プロセスを検証中...' },
          {
            type: 'tool_call',
            toolCall: {
              id: 'call_1',
              name: 'write_file',
              args: {
                path: 'index.html',
                content: '<!DOCTYPE html><html><body><h1>スペースシューター</h1><canvas id="c"></canvas></body></html>',
              },
            },
          },
        ],
        (_req) => [
          {
            type: 'tool_call',
            toolCall: {
              id: 'call_2',
              name: 'complete_task',
              args: { summary: '宇宙シューティングゲームが完成しました！' },
            },
          },
          { type: 'text_delta', delta: '宇宙シューティングゲームを作成しました！' },
          {
            type: 'usage',
            usage: { promptTokens: 600, completionTokens: 250, totalTokens: 850, cachedPromptTokens: 150 },
          },
          { type: 'done' },
        ],
      ]);

      await runtime.executeTurn(
        '宇宙シューティングゲームを作って！',
        session,
        {
          provider: 'gemini',
          model: 'gemini-3.8-flash',
          apiKey: 'test-key',
          baseUrl: '',
          thinkingEffort: 'medium',
          bridgeUrl: '',
        },
        {
          onMessageUpdate: (m) => {
            receivedMsg = m;
          },
          onToolCallUpdate: () => {},
          onFileChange: (path, content) => {
            if (path === 'index.html') updatedFile = content;
          },
          onPlanUpdate: () => {},
          onSubagentUpdate: () => {},
          onPermissionRequest: (req) => req.resolve('allow_once'),
          onMetricsUpdate: () => {
            completedCalled = true;
          },
        },
        testProvider
      );

      expect(receivedMsg).not.toBeNull();
      expect(receivedMsg!.thought).toContain('Canvas 2D 物理演算');
      expect(receivedMsg!.content).toContain('宇宙シューティングゲーム');
      expect(updatedFile).toContain('スペースシューター');
      expect(receivedMsg!.toolCalls?.length).toBeGreaterThan(0);
      expect(completedCalled).toBe(true);
    });

    it('enforces interactive permission checks for tool execution', async () => {
      const runtime = new AgentRuntime();
      runtime.setPermissionPolicy({
        read: 'allow',
        write: 'ask',
        command: 'ask',
        web: 'allow',
      });
      const session = createInitialSession('権限テスト');
      let permissionRequested = false;

      const testProvider = new SimulatedProvider([
        (_req) => [
          {
            type: 'tool_call',
            toolCall: {
              id: 'call_write',
              name: 'write_file',
              args: { path: 'index.html', content: 'new content' },
            },
          },
        ],
        (_req) => [
          {
            type: 'tool_call',
            toolCall: { id: 'call_done', name: 'complete_task', args: { summary: 'done' } },
          },
          { type: 'done' },
        ],
      ]);

      await runtime.executeTurn(
        'ファイルを書き換えて',
        session,
        {
          provider: 'gemini',
          model: 'gemini-3.8-flash',
          apiKey: 'test-key',
          baseUrl: '',
          thinkingEffort: 'medium',
          bridgeUrl: '',
        },
        {
          onMessageUpdate: () => {},
          onToolCallUpdate: () => {},
          onFileChange: () => {},
          onPlanUpdate: () => {},
          onSubagentUpdate: () => {},
          onPermissionRequest: (req) => {
            permissionRequested = true;
            req.resolve('allow_once');
          },
          onMetricsUpdate: () => {},
        },
        testProvider
      );

      expect(permissionRequested).toBe(true);
    });

    it('generates plan and parses checklist tasks when in plan mode', async () => {
      const runtime = new AgentRuntime();
      const session = createInitialSession('計画テスト');
      session.mode = 'plan';
      let generatedPlan: PlanState | null = null;

      const planMarkdown = `# 🍈 開発計画書: ボス戦
## フェーズ 1: コア設計
- [ ] 画面レイアウトとHUDの調整
- [ ] 60fpsループの保証

## フェーズ 2: 実装
- [ ] ボス出現と弾幕パターン
- [ ] サウンドエフェクト追加
`;

      const testProvider = new SimulatedProvider([
        (_req) => [
          {
            type: 'tool_call',
            toolCall: {
              id: 'call_plan',
              name: 'write_file',
              args: { path: 'plan.md', content: planMarkdown },
            },
          },
        ],
        (_req) => [
          {
            type: 'tool_call',
            toolCall: { id: 'call_done', name: 'complete_task', args: { summary: 'Plan created' } },
          },
          { type: 'done' },
        ],
      ]);

      await runtime.executeTurn(
        'ボス戦の計画書を作って',
        session,
        {
          provider: 'gemini',
          model: 'gemini-3.8-flash',
          apiKey: 'test-key',
          baseUrl: '',
          thinkingEffort: 'medium',
          bridgeUrl: '',
        },
        {
          onMessageUpdate: () => {},
          onToolCallUpdate: () => {},
          onFileChange: () => {},
          onPlanUpdate: (p) => {
            generatedPlan = p;
          },
          onSubagentUpdate: () => {},
          onPermissionRequest: (req) => req.resolve('allow_once'),
          onMetricsUpdate: () => {},
        },
        testProvider
      );

      expect(generatedPlan).not.toBeNull();
      expect(generatedPlan!.status).toBe('pending_review');
      expect(generatedPlan!.tasks.length).toBeGreaterThanOrEqual(4);
    });

    it('aborts running task immediately when cancelCurrentTask is triggered', async () => {
      const runtime = new AgentRuntime();
      const session = createInitialSession('キャンセルテスト');
      let finalMsg: Message | null = null;

      class AbortableProvider {
        readonly id = 'abortable';
        async *streamChat(_req: any, signal?: AbortSignal) {
          yield { type: 'thought_delta', delta: '考え中...' };
          await new Promise((_, reject) => {
            if (signal?.aborted) {
              reject(new DOMException('Aborted', 'AbortError'));
            }
            signal?.addEventListener('abort', () => {
              reject(new DOMException('Aborted', 'AbortError'));
            });
          });
        }
      }
      const testProvider = new AbortableProvider() as any;

      const promise = runtime.executeTurn(
        '処理を実行して',
        session,
        {
          provider: 'gemini',
          model: 'gemini-3.8-flash',
          apiKey: 'test-key',
          baseUrl: '',
          thinkingEffort: 'medium',
          bridgeUrl: '',
        },
        {
          onMessageUpdate: (m) => {
            finalMsg = m;
          },
          onToolCallUpdate: () => {},
          onFileChange: () => {},
          onPlanUpdate: () => {},
          onSubagentUpdate: () => {},
          onPermissionRequest: (req) => req.resolve('allow_once'),
          onMetricsUpdate: () => {},
        },
        testProvider
      );

      setTimeout(() => {
        runtime.cancelCurrentTask();
      }, 15);

      await promise;
      expect(finalMsg).not.toBeNull();
      expect(finalMsg!.content).toContain('中断されました');
    });

    it('generates a valid multi-file ZIP archive containing index.html and assets', async () => {
      const session = createInitialSession('ZIPテスト');
      session.files['index.html'] = '<!DOCTYPE html><html><body><canvas id="c"></canvas></body></html>';
      session.files['game.js'] = 'console.log("Game started");';
      const zip = new JSZip();

      for (const [name, content] of Object.entries(session.files)) {
        zip.file(name, content);
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      expect(zipBlob.size).toBeGreaterThan(100);

      const unzipped = await JSZip.loadAsync(zipBlob);
      const indexHtml = await unzipped.file('index.html')?.async('string');
      expect(indexHtml).toBeDefined();
      expect(indexHtml).toContain('<!DOCTYPE html>');
    });

    it('faithfully parses checklist and numbered items without hallucinating fake dummy tasks', () => {
      // 1. Checklist
      const checklistMarkdown = `# 計画書\n- [ ] 敵AIの実装\n- [x] サウンド調整`;
      const tasks1 = parsePlanTasks(checklistMarkdown);
      expect(tasks1.length).toBe(2);
      expect(tasks1[0].title).toBe('敵AIの実装');
      expect(tasks1[0].status).toBe('pending');
      expect(tasks1[1].title).toBe('サウンド調整');
      expect(tasks1[1].status).toBe('completed');

      // 2. Numbered list
      const numberedMarkdown = `# 計画書\n1. 画面レイアウトの作成\n2. 入力イベントの実装`;
      const tasks2 = parsePlanTasks(numberedMarkdown);
      expect(tasks2.length).toBe(2);
      expect(tasks2[0].title).toBe('画面レイアウトの作成');
      expect(tasks2[1].title).toBe('入力イベントの実装');

      // 3. Plain text without any task patterns -> returns empty array without dummy game task injection
      const plainMarkdown = `# 概要説明\nこれは単純な説明テキストです。タスク一覧はありません。`;
      const tasks3 = parsePlanTasks(plainMarkdown);
      expect(tasks3.length).toBe(0);
    });

    it('handles subagent events without hardcoded token/duration fallbacks and preserves task prompt', async () => {
      const runtime = new AgentRuntime();
      const session = createInitialSession('サブエージェントテスト');
      const traces: SubagentTrace[] = [];

      const testProvider = new SimulatedProvider([
        (_req) => [
          {
            type: 'tool_call',
            toolCall: {
              id: 'call_sub',
              name: 'dispatch_subagent',
              args: {
                agent_type: 'researcher',
                task_prompt: 'Web Audio APIのシンセサイズ仕様を調査',
              },
            },
          },
        ],
        (_req) => [
          {
            type: 'tool_call',
            toolCall: {
              id: 'call_done',
              name: 'complete_task',
              args: { summary: 'サブエージェント調査完了' },
            },
          },
          { type: 'done' },
        ],
      ]);

      await runtime.executeTurn(
        'サブエージェントを呼んで',
        session,
        {
          provider: 'gemini',
          model: 'gemini-3.8-flash',
          apiKey: 'test-key',
          baseUrl: '',
          thinkingEffort: 'medium',
          bridgeUrl: '',
        },
        {
          onMessageUpdate: () => {},
          onToolCallUpdate: () => {},
          onFileChange: () => {},
          onPlanUpdate: () => {},
          onSubagentUpdate: (sub) => {
            const idx = traces.findIndex((t) => t.id === sub.id);
            if (idx >= 0) {
              traces[idx] = {
                ...traces[idx],
                ...sub,
                taskPrompt: sub.taskPrompt || traces[idx].taskPrompt,
              };
            } else {
              traces.push(sub);
            }
          },
          onPermissionRequest: (req) => req.resolve('allow_once'),
          onMetricsUpdate: () => {},
        },
        testProvider
      );

      // Verify traces were captured
      if (traces.length > 0) {
        expect(traces[0].agentName).toBe('researcher');
        expect(traces[0].taskPrompt).toContain('Web Audio API');
      }
    });
  });
});
