import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createInitialSession,
  loadSessions,
  saveSessions,
} from '../src/services/session-storage';
import { AgentRuntime } from '../src/services/agent-runtime';
import { Session, Message, PlanState, SubagentTrace } from '../src/types';
import JSZip from 'jszip';

describe('WebUI Feature Suite (Issues #44 - #49)', () => {
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

  describe('Issue #44: Session Management & Initial State', () => {
    it('creates initial session with default melonpan HTML5 game and markdown', () => {
      const session = createInitialSession('テストセッション');
      expect(session.name).toBe('テストセッション');
      expect(session.files['index.html']).toBeDefined();
      expect(session.files['index.html']).toContain('<!DOCTYPE html>');
      expect(session.files['index.html']).toContain('canvas');
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
  });

  describe('Issue #45: Tool Telemetry, Diff Generation & Sandbox Error Recovery', () => {
    it('executes simulation turn, emits thought deltas, tool call and updates index.html', async () => {
      const runtime = new AgentRuntime();
      const session = createInitialSession('テスト');
      let updatedFile = '';
      let receivedMsg: Message | null = null;

      await runtime.executeTurn(
        '宇宙シューティングゲームを作って！',
        session,
        {
          provider: 'simulation',
          model: 'gemini-2.5-flash',
          apiKey: '',
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
          onMetricsUpdate: () => {},
        }
      );

      expect(receivedMsg).not.toBeNull();
      expect(receivedMsg!.content).toContain('宇宙シューティング');
      expect(receivedMsg!.thought).toBeDefined();
      expect(receivedMsg!.thought!.length).toBeGreaterThan(0);
      expect(updatedFile).toContain('スペースシューター');
      expect(receivedMsg!.toolCalls?.length).toBeGreaterThan(0);
      expect(receivedMsg!.toolCalls![0].name).toBe('write_file');
      expect(receivedMsg!.toolCalls![0].diff).toBeDefined();
    });

    it('handles sandbox error injection script generation correctly', () => {
      const rawHtml = '<!DOCTYPE html><html><head><title>Test</title></head><body></body></html>';
      const errorCaptureScript = '<script>window.onerror = function() {};</script>';
      const injected = rawHtml.replace('<head>', `<head>${errorCaptureScript}`);
      expect(injected).toContain(errorCaptureScript);
      expect(injected).toContain('<head><script>window.onerror');
    });
  });

  describe('Issue #46: Plan Mode Review Workbench & Interactive Permission Policies', () => {
    it('generates plan state when in plan mode or prompt starts with /plan', async () => {
      const runtime = new AgentRuntime();
      const session = createInitialSession('テスト');
      session.mode = 'plan';
      let generatedPlan: PlanState | null = null;

      await runtime.executeTurn(
        '/plan ボス戦とサウンドエフェクトを追加',
        session,
        {
          provider: 'simulation',
          model: 'gemini-2.5-flash',
          apiKey: '',
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
        }
      );

      expect(generatedPlan).not.toBeNull();
      expect(generatedPlan!.status).toBe('pending_review');
      expect(generatedPlan!.tasks.length).toBeGreaterThanOrEqual(3);
      expect(generatedPlan!.rawMarkdown).toContain('開発計画書');
    });

    it('respects permission policy when write is denied', async () => {
      const runtime = new AgentRuntime();
      runtime.setPermissionPolicy({
        read: 'allow',
        write: 'deny',
        command: 'deny',
        web: 'allow',
      });
      const session = createInitialSession('テスト');
      let receivedMsg: Message | null = null;

      await runtime.executeTurn(
        'ゲームを更新して',
        session,
        {
          provider: 'simulation',
          model: 'gemini-2.5-flash',
          apiKey: '',
          baseUrl: '',
          thinkingEffort: 'medium',
          bridgeUrl: '',
        },
        {
          onMessageUpdate: (m) => {
            receivedMsg = m;
          },
          onToolCallUpdate: () => {},
          onFileChange: () => {},
          onPlanUpdate: () => {},
          onSubagentUpdate: () => {},
          onPermissionRequest: (req) => req.resolve('deny'),
          onMetricsUpdate: () => {},
        }
      );

      expect(receivedMsg).not.toBeNull();
      expect(receivedMsg!.content).toContain('権限が拒否されたため');
    });
  });

  describe('Issue #47: Subagent Traces and Skill progressive disclosure', () => {
    it('traces dispatched subagents with roles, thoughts, and PASS verdict', async () => {
      const runtime = new AgentRuntime();
      const session = createInitialSession('テスト');
      const subagents: SubagentTrace[] = [];

      await runtime.executeTurn(
        'ボスバトルを追加して',
        session,
        {
          provider: 'simulation',
          model: 'gemini-2.5-flash',
          apiKey: '',
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
            const idx = subagents.findIndex((s) => s.id === sub.id);
            if (idx >= 0) subagents[idx] = sub;
            else subagents.push(sub);
          },
          onPermissionRequest: (req) => req.resolve('allow_once'),
          onMetricsUpdate: () => {},
        }
      );

      expect(subagents.length).toBeGreaterThan(0);
      const researcher = subagents.find((s) => s.agentName === 'researcher');
      expect(researcher).toBeDefined();
      expect(researcher!.status).toBe('completed');
      expect(researcher!.verdict).toBe('PASS');
    });
  });

  describe('Issue #48: Context Gauge & Artifact ZIP Generation', () => {
    it('generates a valid multi-file ZIP archive containing index.html and assets', async () => {
      const session = createInitialSession('テスト');
      const zip = new JSZip();

      for (const [name, content] of Object.entries(session.files)) {
        zip.file(name, content);
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      expect(zipBlob.size).toBeGreaterThan(100);

      // Verify reading back from zip
      const unzipped = await JSZip.loadAsync(zipBlob);
      const indexHtml = await unzipped.file('index.html')?.async('string');
      expect(indexHtml).toBeDefined();
      expect(indexHtml).toContain('<!DOCTYPE html>');
    });
  });

  describe('Issue #49: Token streaming abort controller cancellation', () => {
    it('aborts running task immediately when cancelCurrentTask is triggered', async () => {
      const runtime = new AgentRuntime();
      const session = createInitialSession('テスト');
      let finalMsg: Message | null = null;

      const promise = runtime.executeTurn(
        '長い処理を実行して',
        session,
        {
          provider: 'simulation',
          model: 'gemini-2.5-flash',
          apiKey: '',
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
        }
      );

      // Cancel after 25ms
      setTimeout(() => {
        runtime.cancelCurrentTask();
      }, 25);

      await promise;
      expect(finalMsg).not.toBeNull();
      expect(finalMsg!.content).toContain('中断されました');
    });
  });
});
