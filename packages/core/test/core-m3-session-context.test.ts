import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  pruneChatHistory,
  ToolOutputPruningStrategy,
  LlmSummaryCompactionStrategy,
  createDetailedTokenUsage,
  InMemorySessionStore,
  JsonFileSessionStore,
  AgentSession,
  VirtualFS,
  AgentEvent,
} from '../src/index.js';

describe('Core-M3: Session Persistence, Context Pruning & Compaction, and Token Accounting', () => {
  describe('1. Extended pruneChatHistory & ToolOutputPruningStrategy (#11, #26)', () => {
    it('prunes large edit_file search/replace chunks and large read_file/run_command outputs', () => {
      const largeReplace = 'function renderFrame() {\n  ctx.fillRect(0, 0, 440, 680);\n}\n'.repeat(15);
      const largeReadOutput = '1: const line = "some source code line";\n'.repeat(30);

      const history: any[] = [
        {
          role: 'model',
          parts: [
            {
              functionCall: {
                name: 'edit_file',
                args: {
                  path: 'index.html',
                  search: 'old()',
                  replace: largeReplace,
                },
              },
            },
          ],
        },
        {
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: 'read_file',
                response: {
                  output: largeReadOutput,
                },
              },
            },
          ],
        },
      ];

      const strategy = new ToolOutputPruningStrategy({
        writeThresholdChars: 200,
        editThresholdChars: 300,
        outputThresholdChars: 500,
      });

      const res = strategy.apply(history);
      expect(res.compacted).toBe(true);
      expect(res.prunedCallsCount).toBe(2);
      expect(res.savedTokens).toBeGreaterThan(100);

      expect(history[0].parts[0].functionCall.args.replace).toBe(
        `<Content preserved in VFS: ${largeReplace.length} chars>`
      );
      expect(history[1].parts[0].functionResponse.response.output).toContain(
        `<Tool output pruned: ${largeReadOutput.length} chars.`
      );
    });
  });

  describe('2. LlmSummaryCompactionStrategy & AgentSession.compact() (#26)', () => {
    it('compacts older conversation turns when threshold is exceeded or force is true, emitting CONTEXT_COMPACTED', async () => {
      const session = new AgentSession({
        sessionId: 'sess-compact-1',
        maxContextTokens: 500,
      });

      // Populate multi-turn messages
      for (let i = 1; i <= 6; i++) {
        session.appendMessage({
          role: 'user',
          parts: [{ text: `Turn ${i} request: ${'elaborate requirement details '.repeat(15)}` }],
        });
        session.appendMessage({
          role: 'model',
          parts: [{ text: `Turn ${i} response: ${'implemented feature module '.repeat(15)}` }],
        });
      }

      const events: AgentEvent[] = [];
      session.subscribe((ev) => events.push(ev));

      const beforeCount = session.getMessages().length;
      expect(beforeCount).toBe(12);

      const compactRes = await session.compact({ force: true });
      expect(compactRes.compacted).toBe(true);
      expect(compactRes.afterTokens).toBeLessThan(compactRes.beforeTokens);
      expect(compactRes.savedTokens).toBeGreaterThan(0);

      const afterMessages = session.getMessages();
      expect(afterMessages.length).toBeLessThan(beforeCount);
      expect(afterMessages[0]?.parts[0]?.text).toContain('[Compacted Session Context Summary]');

      const compactEvent = events.find((e) => e.type === 'CONTEXT_COMPACTED');
      expect(compactEvent).toBeDefined();
      expect(compactEvent?.payload.savedTokens).toBeGreaterThan(0);
    });
  });

  describe('3. Distinct Billed Cumulative Tokens vs Context Window Size (#17)', () => {
    it('separates cumulative billed tokens from current context window size and utilization', () => {
      const usage = createDetailedTokenUsage({
        billedPromptTokens: 4500,
        billedCompletionTokens: 1200,
        contextWindowTokens: 900,
        maxContextWindowTokens: 10000,
      });

      // Backward-compatible fields
      expect(usage.promptTokens).toBe(4500);
      expect(usage.completionTokens).toBe(1200);
      expect(usage.totalTokens).toBe(5700);

      // Explicit separated fields (#17)
      expect(usage.billedPromptTokens).toBe(4500);
      expect(usage.billedCompletionTokens).toBe(1200);
      expect(usage.billedTotalTokens).toBe(5700);
      expect(usage.contextWindowTokens).toBe(900);
      expect(usage.maxContextWindowTokens).toBe(10000);
      expect(usage.contextWindowUtilization).toBeCloseTo(0.09, 4);
    });
  });

  describe('4. ISessionStore (InMemorySessionStore & JsonFileSessionStore) & State Snapshot (#26, #53)', () => {
    it('saves, lists, loads, and deletes sessions in InMemorySessionStore and JsonFileSessionStore', async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'melonpan-sessions-'));
      try {
        const jsonStore = new JsonFileSessionStore({ storageDir: tempDir });
        const vfs = new VirtualFS();
        vfs.writeFile('index.html', '<h1>Saved Session Game</h1>');

        const session1 = new AgentSession({
          sessionId: 'my-session-alpha',
          mode: 'auto',
          model: 'gemini-3.8-flash',
          fs: vfs,
          store: jsonStore,
        });

        session1.appendMessage({
          role: 'user',
          parts: [{ text: 'Create a neon puzzle game' }],
        });
        session1.recordEvent({
          type: 'THOUGHT',
          payload: { thought: 'Designing puzzle grid...' },
          timestamp: Date.now(),
        });

        await session1.saveToStore();

        const listed = await jsonStore.list();
        expect(listed).toHaveLength(1);
        expect(listed[0]!.sessionId).toBe('my-session-alpha');

        // Restore into a fresh AgentSession + fresh VirtualFS
        const vfs2 = new VirtualFS();
        const session2 = new AgentSession({
          sessionId: 'my-session-alpha',
          fs: vfs2,
          store: jsonStore,
        });

        const restored = await session2.restoreFromStore();
        expect(restored).toBe(true);
        expect(session2.getMode()).toBe('auto');
        expect(session2.getMessages()).toHaveLength(1);
        expect(vfs2.readFile('index.html')).toBe('<h1>Saved Session Game</h1>');

        const snapshot = session2.getStateSnapshot();
        expect(snapshot.sessionId).toBe('my-session-alpha');
        expect(snapshot.files['index.html']).toBe('<h1>Saved Session Game</h1>');

        expect(await jsonStore.delete('my-session-alpha')).toBe(true);
        expect(await jsonStore.list()).toHaveLength(0);
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });
  });
});
