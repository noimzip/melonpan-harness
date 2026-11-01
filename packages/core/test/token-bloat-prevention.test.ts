import { describe, it, expect, vi } from 'vitest';
import {
  pruneChatHistory,
  ToolOutputPruningStrategy,
  LlmSummaryCompactionStrategy,
  createDetailedTokenUsage,
  ReactAgent,
  ToolRegistry,
  createBuiltinTools,
  VirtualFS,
  ILLMProvider,
  LLMStreamChunk,
  AgentEvent,
} from '../src/index.js';

describe('Token Bloat Prevention & Fuel Efficiency Improvements', () => {
  describe('1. Past Thought Pruning / Stripping in pruneChatHistory', () => {
    it('strips thought text from older model turns into <Thought preserved: N chars> while preserving latest turn', () => {
      const history: any[] = [
        {
          role: 'user',
          parts: [{ text: 'Turn 1 user prompt' }],
        },
        {
          role: 'model',
          parts: [
            {
              text: 'This is a long turn 1 thought process detailing arcade physics algorithms.'.repeat(20),
              thought: true,
              thoughtSignature: 'sig_turn_1',
            },
            {
              functionCall: {
                name: 'write_file',
                args: { path: 'game.js', content: 'console.log("hello");' },
                thoughtSignature: 'sig_turn_1',
              },
              thoughtSignature: 'sig_turn_1',
            },
          ],
        },
        {
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: 'write_file',
                response: { output: 'Saved game.js' },
              },
            },
          ],
        },
        {
          role: 'model',
          parts: [
            {
              text: 'This is the latest turn 2 thought which must remain intact for API signature verification.'.repeat(10),
              thought: true,
              thoughtSignature: 'sig_turn_2',
            },
            {
              functionCall: {
                name: 'edit_file',
                args: { path: 'game.js', search: 'hello', replace: 'world' },
                thoughtSignature: 'sig_turn_2',
              },
              thoughtSignature: 'sig_turn_2',
            },
          ],
        },
      ];

      const initialTurn1ThoughtLength = history[1].parts[0].text.length;
      const initialTurn2Thought = history[3].parts[0].text;

      const result = pruneChatHistory(history, {
        writeThresholdChars: 200,
        editThresholdChars: 300,
        outputThresholdChars: 400,
        prunePastThoughts: true,
      });

      expect(result.prunedCallsCount).toBeGreaterThan(0);
      expect(result.savedCharsCount).toBeGreaterThan(1000);

      // Turn 1 thought must be masked to preserved marker
      const turn1ThoughtPart = history[1].parts[0];
      expect(turn1ThoughtPart.text).toBe(`<Thought preserved: ${initialTurn1ThoughtLength} chars>`);
      expect(turn1ThoughtPart.thought).toBe(true);
      expect(turn1ThoughtPart.thoughtSignature).toBe('sig_turn_1');

      // Turn 2 thought (the latest model turn) must remain untouched
      const turn2ThoughtPart = history[3].parts[0];
      expect(turn2ThoughtPart.text).toBe(initialTurn2Thought);
      expect(turn2ThoughtPart.thoughtSignature).toBe('sig_turn_2');
    });

    it('does not strip thoughts when prunePastThoughts is explicitly false', () => {
      const history: any[] = [
        {
          role: 'user',
          parts: [{ text: 'Prompt' }],
        },
        {
          role: 'model',
          parts: [
            {
              text: 'Thought to keep.'.repeat(30),
              thought: true,
              thoughtSignature: 'sig_1',
            },
          ],
        },
        {
          role: 'user',
          parts: [{ text: 'Next prompt' }],
        },
        {
          role: 'model',
          parts: [
            {
              text: 'Latest thought',
              thought: true,
            },
          ],
        },
      ];

      const origText = history[1].parts[0].text;
      const res = pruneChatHistory(history, {
        prunePastThoughts: false,
      });

      expect(res.prunedCallsCount).toBe(0);
      expect(history[1].parts[0].text).toBe(origText);
    });

    it('handles legacy number threshold argument without stripping thoughts (backward compatibility)', () => {
      const history: any[] = [
        {
          role: 'model',
          parts: [
            {
              text: 'Old thought'.repeat(50),
              thought: true,
            },
          ],
        },
        {
          role: 'model',
          parts: [
            {
              text: 'New thought',
              thought: true,
            },
          ],
        },
      ];

      const origText = history[0].parts[0].text;
      const res = pruneChatHistory(history, 200);

      expect(res.prunedCallsCount).toBe(0);
      expect(history[0].parts[0].text).toBe(origText);
    });
  });

  describe('2. Lower outputThresholdChars in ToolOutputPruningStrategy', () => {
    it('defaults to masking tool outputs exceeding 400 chars', () => {
      const output450Chars = 'x'.repeat(450);
      const history: any[] = [
        {
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: 'read_file',
                response: { output: output450Chars },
              },
            },
          ],
        },
      ];

      const strategy = new ToolOutputPruningStrategy();
      const res = strategy.apply(history);

      expect(res.compacted).toBe(true);
      expect(res.prunedCallsCount).toBe(1);
      expect(history[0].parts[0].functionResponse.response.output).toContain(
        '<Tool output pruned: 450 chars.'
      );
    });

    it('leaves outputs below 400 chars intact', () => {
      const output350Chars = 'y'.repeat(350);
      const history: any[] = [
        {
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: 'read_file',
                response: { output: output350Chars },
              },
            },
          ],
        },
      ];

      const strategy = new ToolOutputPruningStrategy();
      const res = strategy.apply(history);

      expect(res.compacted).toBe(false);
      expect(history[0].parts[0].functionResponse.response.output).toBe(output350Chars);
    });
  });

  describe('3. Lower LlmSummaryCompactionStrategy Trigger Threshold (30% utilization)', () => {
    it('triggers proactive compaction at 0.3 utilization (e.g. ~38k of 128k tokens)', async () => {
      const strategy = new LlmSummaryCompactionStrategy({
        maxContextTokens: 1000,
        // triggerUtilization defaults to 0.3 (i.e. 300 tokens)
      });

      // 1 char ≈ 0.25 tokens -> 1600 chars ≈ 400 tokens (> 300 tokens = 30%)
      const messages: any[] = [
        { role: 'user', parts: [{ text: 'a'.repeat(400) }] },
        { role: 'model', parts: [{ text: 'b'.repeat(400) }] },
        { role: 'user', parts: [{ text: 'c'.repeat(400) }] },
        { role: 'model', parts: [{ text: 'd'.repeat(400) }] },
      ];

      const res = await strategy.apply(messages);

      expect(res.compacted).toBe(true);
      expect(res.savedTokens).toBeGreaterThan(0);
      expect(messages[0].parts[0].text).toContain('[Compacted Session Context Summary]');
    });

    it('does not trigger compaction if utilization is below 0.3', async () => {
      const strategy = new LlmSummaryCompactionStrategy({
        maxContextTokens: 1000,
        // triggerUtilization defaults to 0.3 (300 tokens)
      });

      // 400 chars ≈ 100 tokens (< 300 tokens)
      const messages: any[] = [
        { role: 'user', parts: [{ text: 'a'.repeat(100) }] },
        { role: 'model', parts: [{ text: 'b'.repeat(100) }] },
        { role: 'user', parts: [{ text: 'c'.repeat(100) }] },
        { role: 'model', parts: [{ text: 'd'.repeat(100) }] },
      ];

      const res = await strategy.apply(messages);

      expect(res.compacted).toBe(false);
      expect(res.savedTokens).toBe(0);
    });
  });

  describe('4. dispatch_subagent Blind File Injection Avoidance', () => {
    it('does not inject index.html or plan.md into researcher subagent when file_path is omitted', async () => {
      const vfs = new VirtualFS();
      vfs.writeFile('index.html', '<!DOCTYPE html><html><body>Canvas Game 10000 lines</body></html>');
      vfs.writeFile('plan.md', '# Game Plan');

      let capturedContext: string | undefined = undefined;
      let capturedFilePath: string | undefined = undefined;

      const mockSpawner = {
        run: vi.fn(async (_agentType: string, _taskPrompt: string, opts: any) => {
          capturedContext = opts?.fileContext;
          capturedFilePath = opts?.filePath;
          return 'Discovered physics formula';
        }),
        getLastUsage: vi.fn(() => ({ promptTokens: 100, completionTokens: 50 })),
      };

      const registry = new ToolRegistry(createBuiltinTools());

      await registry.execute(
        'dispatch_subagent',
        {
          agent_type: 'researcher',
          task_prompt: 'Research Euler integration physics formulas for elastic ball bouncing',
        },
        {
          fs: vfs,
          subagentSpawner: mockSpawner as any,
          emit: () => {},
        }
      );

      expect(capturedContext).toBeUndefined();
      expect(capturedFilePath).toBeUndefined();
    });

    it('injects requested file when file_path is explicitly provided', async () => {
      const vfs = new VirtualFS();
      vfs.writeFile('plan.md', '# Specific Technical Spec');

      let capturedContext: string | undefined = undefined;
      let capturedFilePath: string | undefined = undefined;

      const mockSpawner = {
        run: vi.fn(async (_agentType: string, _taskPrompt: string, opts: any) => {
          capturedContext = opts?.fileContext;
          capturedFilePath = opts?.filePath;
          return 'Reviewed spec';
        }),
        getLastUsage: vi.fn(() => ({ promptTokens: 100, completionTokens: 50 })),
      };

      const registry = new ToolRegistry(createBuiltinTools());

      await registry.execute(
        'dispatch_subagent',
        {
          agent_type: 'code-reviewer',
          task_prompt: 'Audit architecture',
          file_path: 'plan.md',
        },
        {
          fs: vfs,
          subagentSpawner: mockSpawner as any,
          emit: () => {},
        }
      );

      expect(capturedFilePath).toBe('plan.md');
      expect(capturedContext).toBe('# Specific Technical Spec');
    });
  });

  describe('5. Billed vs Cached Tokens Accounting', () => {
    it('calculates billedPromptTokens as uncached tokens (promptTokens - cachedPromptTokens)', () => {
      const usage = createDetailedTokenUsage({
        billedPromptTokens: 2500, // Uncached fresh input tokens
        billedCompletionTokens: 800,
        cachedPromptTokens: 7500,
        rawPromptTokens: 10000,
        contextWindowTokens: 4000,
        maxContextWindowTokens: 128000,
      });

      expect(usage.billedPromptTokens).toBe(2500);
      expect(usage.cachedPromptTokens).toBe(7500);
      expect(usage.rawPromptTokens).toBe(10000);
      expect(usage.promptTokens).toBe(10000); // Raw prompt tokens for backward compatibility
      expect(usage.completionTokens).toBe(800);
      expect(usage.totalTokens).toBe(10800); // Raw + completion
      expect(usage.billedTotalTokens).toBe(3300); // Billed prompt (2500) + completion (800)
    });
  });

  describe('6. Multi-Turn ReAct Loop Token Bloat Prevention', () => {
    it('prunes past thoughts across 5 turns, keeping prompt tokens flat rather than quadratic', async () => {
      let turnCounter = 0;
      const historyLengthLog: number[] = [];
      const pastThoughtMaskLog: string[] = [];

      const mockProvider: ILLMProvider = {
        id: 'mock-test-provider',
        async *streamChat(params) {
          turnCounter++;
          const messages = params.messages;

          // Check how many earlier turns have their thoughts masked
          let maskedCount = 0;
          for (let i = 0; i < messages.length - 1; i++) {
            const m = messages[i];
            if (m.role === 'model') {
              for (const p of m.parts || []) {
                if (typeof p.text === 'string' && p.text.includes('<Thought preserved:')) {
                  maskedCount++;
                }
              }
            }
          }
          pastThoughtMaskLog.push(`Turn ${turnCounter}: ${maskedCount} past thoughts masked`);

          // Emit a heavy thought (3,000 chars)
          const heavyThought = `Thought for turn ${turnCounter}: Examining canvas rendering performance in detail... `.repeat(30);
          yield { type: 'thought_delta', delta: heavyThought };

          // On turns 1-4, call edit_file. On turn 5, complete_task.
          if (turnCounter < 5) {
            yield {
              type: 'tool_call',
              toolCall: {
                id: `call_${turnCounter}`,
                name: 'edit_file',
                args: {
                  path: 'index.html',
                  search: '<body>',
                  replace: `<body><!-- Turn ${turnCounter} -->`,
                },
                thoughtSignature: `sig_turn_${turnCounter}`,
              },
            };
          } else {
            yield {
              type: 'tool_call',
              toolCall: {
                id: `call_${turnCounter}`,
                name: 'complete_task',
                args: { summary: 'Completed 5 turns successfully.' },
                thoughtSignature: `sig_turn_${turnCounter}`,
              },
            };
          }

          // Emit usage with caching
          yield {
            type: 'usage',
            usage: {
              promptTokens: 2000,
              completionTokens: 200,
              totalTokens: 2200,
              cachedPromptTokens: 1500,
            },
          };
        },
      };

      const vfs = new VirtualFS();
      vfs.writeFile('index.html', '<!DOCTYPE html><html><body>Game</body></html>');

      const agent = new ReactAgent({
        provider: mockProvider,
        maxTurns: 10,
      });

      const events: AgentEvent[] = [];
      for await (const ev of agent.execute('Build game with multi-turn reasoning', undefined, vfs)) {
        events.push(ev);
      }

      const completeEvent = events.find((e) => e.type === 'COMPLETE');
      expect(completeEvent).toBeDefined();
      expect(completeEvent?.payload.turns).toBe(5);

      // Verify that past thoughts were masked in later turns
      // By turn 3, 4, 5, past model turns had their heavy thoughts pruned
      expect(pastThoughtMaskLog.some((log) => log.includes('1 past thoughts masked'))).toBe(true);
      expect(pastThoughtMaskLog.some((log) => log.includes('2 past thoughts masked'))).toBe(true);

      // Verify final usage reflects accurate billed vs cached tokens
      const finalUsage = completeEvent?.payload.usage;
      expect(finalUsage).toBeDefined();
      expect(finalUsage?.cachedPromptTokens).toBe(7500); // 1500 * 5 turns
      expect(finalUsage?.promptTokens).toBe(10000); // 2000 * 5 turns raw
      expect(finalUsage?.billedPromptTokens).toBe(2500); // 10000 - 7500
      expect(finalUsage?.billedTotalTokens).toBe(3500); // 2500 + (200 * 5)
    });
  });
});
