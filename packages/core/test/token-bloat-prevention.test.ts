import { describe, it, expect, vi } from 'vitest';
import {
  pruneChatHistory,
  ToolOutputPruningStrategy,
  LlmSummaryCompactionStrategy,
  createDetailedTokenUsage,
  ReactAgent,
  SubagentRunner,
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

    it('strips thought text from older assistant messages (role: assistant) while preserving latest assistant turn', () => {
      const history: any[] = [
        {
          role: 'user',
          parts: [{ text: 'Prompt 1' }],
        },
        {
          role: 'assistant',
          parts: [
            {
              text: 'Thinking deeply about architecture... '.repeat(10),
              thought: true,
              thoughtSignature: 'sig_a1',
            },
          ],
        },
        {
          role: 'user',
          parts: [{ text: 'Prompt 2' }],
        },
        {
          role: 'assistant',
          parts: [
            {
              text: 'Latest assistant thought process.',
              thought: true,
              thoughtSignature: 'sig_a2',
            },
          ],
        },
      ];

      const res = pruneChatHistory(history, { prunePastThoughts: true });
      expect(res.prunedCallsCount).toBe(1);
      expect(history[1].parts[0].text).toContain('<Thought preserved:');
      expect(history[3].parts[0].text).toBe('Latest assistant thought process.');
    });

    it('does not mask short thoughts (<= 40 chars) to avoid bloating token count', () => {
      const history: any[] = [
        {
          role: 'model',
          parts: [{ text: 'Brief thought', thought: true }],
        },
        {
          role: 'model',
          parts: [{ text: 'Latest turn thought', thought: true }],
        },
      ];

      const res = pruneChatHistory(history, { prunePastThoughts: true });
      expect(res.prunedCallsCount).toBe(0);
      expect(history[0].parts[0].text).toBe('Brief thought');
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

    it('gracefully returns compacted: false when cutoff <= 0 without corrupting or bloating messages', async () => {
      const strategy = new LlmSummaryCompactionStrategy({
        maxContextTokens: 100,
        keepRecentMessages: 10, // More than total message count
      });

      const messages: any[] = [
        { role: 'user', parts: [{ text: 'User prompt' }] },
        { role: 'model', parts: [{ text: 'Model response' }] },
      ];

      const res = await strategy.apply(messages, { force: true });
      expect(res.compacted).toBe(false);
      expect(res.savedTokens).toBe(0);
      expect(messages.length).toBe(2);
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

    it('does not inject index.html into code-reviewer when task prompt has generic words like game or canvas', async () => {
      const vfs = new VirtualFS();
      vfs.writeFile('index.html', '<!DOCTYPE html><html><body>Canvas Game 10000 lines</body></html>');

      let capturedContext: string | undefined = undefined;
      let capturedFilePath: string | undefined = undefined;

      const mockSpawner = {
        run: vi.fn(async (_agentType: string, _taskPrompt: string, opts: any) => {
          capturedContext = opts?.fileContext;
          capturedFilePath = opts?.filePath;
          return 'Reviewed general principles';
        }),
        getLastUsage: vi.fn(() => ({ promptTokens: 100, completionTokens: 50 })),
      };

      const registry = new ToolRegistry(createBuiltinTools());

      await registry.execute(
        'dispatch_subagent',
        {
          agent_type: 'code-reviewer',
          task_prompt: 'Review best practices for audio synthesizers in arcade games',
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

    it('injects index.html into researcher when index.html is explicitly requested in task prompt', async () => {
      const vfs = new VirtualFS();
      vfs.writeFile('index.html', '<!DOCTYPE html><html><body>Target Game Code</body></html>');

      let capturedContext: string | undefined = undefined;
      let capturedFilePath: string | undefined = undefined;

      const mockSpawner = {
        run: vi.fn(async (_agentType: string, _taskPrompt: string, opts: any) => {
          capturedContext = opts?.fileContext;
          capturedFilePath = opts?.filePath;
          return 'Researched code in index.html';
        }),
        getLastUsage: vi.fn(() => ({ promptTokens: 100, completionTokens: 50 })),
      };

      const registry = new ToolRegistry(createBuiltinTools());

      await registry.execute(
        'dispatch_subagent',
        {
          agent_type: 'researcher',
          task_prompt: 'Investigate physics collision functions in index.html',
        },
        {
          fs: vfs,
          subagentSpawner: mockSpawner as any,
          emit: () => {},
        }
      );

      expect(capturedFilePath).toBe('index.html');
      expect(capturedContext).toContain('Target Game Code');
    });

    it('injects index.html into code-reviewer when specifically asked to audit existing code', async () => {
      const vfs = new VirtualFS();
      vfs.writeFile('index.html', '<!DOCTYPE html><html><body>Audit Me</body></html>');

      let capturedContext: string | undefined = undefined;
      let capturedFilePath: string | undefined = undefined;

      const mockSpawner = {
        run: vi.fn(async (_agentType: string, _taskPrompt: string, opts: any) => {
          capturedContext = opts?.fileContext;
          capturedFilePath = opts?.filePath;
          return 'Audit completed';
        }),
        getLastUsage: vi.fn(() => ({ promptTokens: 100, completionTokens: 50 })),
      };

      const registry = new ToolRegistry(createBuiltinTools());

      await registry.execute(
        'dispatch_subagent',
        {
          agent_type: 'code-reviewer',
          task_prompt: 'Audit the existing code for 60fps performance and memory leaks',
        },
        {
          fs: vfs,
          subagentSpawner: mockSpawner as any,
          emit: () => {},
        }
      );

      expect(capturedFilePath).toBe('index.html');
      expect(capturedContext).toContain('Audit Me');
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

    it('SubagentRunner populates cachedPromptTokens, billedPromptTokens, and rawPromptTokens in lastUsage', async () => {
      const runner = new SubagentRunner({ simulate: true });
      await runner.run('researcher', 'Quick physics query');
      const usage = runner.getLastUsage();

      expect(usage).toBeDefined();
      expect(usage?.promptTokens).toBeGreaterThan(0);
      expect(usage?.rawPromptTokens).toBe(usage?.promptTokens);
      expect(usage?.billedPromptTokens).toBe(usage?.promptTokens);
      expect(usage?.cachedPromptTokens).toBe(0);

      // Now with a provider that emits cached tokens
      const mockProvider: ILLMProvider = {
        id: 'mock-subagent-provider',
        async *streamChat() {
          yield { type: 'text_delta', delta: 'Findings: optimal speed is 5.' };
          yield {
            type: 'usage',
            usage: {
              promptTokens: 1200,
              rawPromptTokens: 1200,
              completionTokens: 80,
              cachedPromptTokens: 1000,
              totalTokens: 1280,
            },
          };
        },
      };

      const providerRunner = new SubagentRunner({ provider: mockProvider });
      await providerRunner.run('researcher', 'Analyze cache efficiency');
      const provUsage = providerRunner.getLastUsage();

      expect(provUsage).toBeDefined();
      expect(provUsage?.promptTokens).toBe(1200);
      expect(provUsage?.rawPromptTokens).toBe(1200);
      expect(provUsage?.cachedPromptTokens).toBe(1000);
      expect(provUsage?.billedPromptTokens).toBe(200); // 1200 - 1000
      expect(provUsage?.completionTokens).toBe(80);
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

  describe('6. Tool Output Size Safeguards (read_file & grep_search)', () => {
    it('read_file clips large files to default 200 lines and provides range guidance', async () => {
      const vfs = new VirtualFS();
      const largeContent = Array.from({ length: 500 }, (_, i) => `Line ${i + 1}: const item_${i} = ${i};`).join('\n');
      await vfs.writeFile('large-source.ts', largeContent);

      const tools = createBuiltinTools();
      const readFileTool = tools.find((t) => t.name === 'read_file');
      expect(readFileTool).toBeDefined();

      const emitMock = vi.fn();
      const result = await readFileTool!.execute(
        { path: 'large-source.ts' },
        { fs: vfs, emit: emitMock } as any
      );

      expect(result.isError).toBeFalsy();
      expect(result.metadata?.truncated).toBe(true);
      expect(result.metadata?.totalLines).toBe(500);
      expect(result.metadata?.startLine).toBe(1);
      expect(result.metadata?.endLine).toBe(200);
      expect(result.output).toContain('1: Line 1:');
      expect(result.output).toContain('200: Line 200:');
      expect(result.output).not.toContain('201: Line 201:');
      expect(result.output).toContain('Showing lines 1-200 of 500');
    });

    it('grep_search limits match count to 30 and truncates lines longer than 160 chars', async () => {
      const vfs = new VirtualFS();
      // Generate 50 matching lines with ultra-long content
      const longLine = 'TARGET_KEYWORD ' + 'X'.repeat(300);
      const fileContent = Array.from({ length: 50 }, () => longLine).join('\n');
      await vfs.writeFile('large-grep.txt', fileContent);

      const tools = createBuiltinTools();
      const grepTool = tools.find((t) => t.name === 'grep_search');
      expect(grepTool).toBeDefined();

      const emitMock = vi.fn();
      const result = await grepTool!.execute(
        { query: 'TARGET_KEYWORD' },
        { fs: vfs, emit: emitMock } as any
      );

      expect(result.isError).toBeFalsy();
      expect(result.metadata?.matchCount).toBe(30);
      expect(result.metadata?.truncated).toBe(true);
      expect(result.output).toContain('... [Truncated: Showing top 30 matches');
      // Verify line clipping
      const lines = result.output.split('\n');
      const sampleMatch = lines[0];
      expect(sampleMatch).toContain('TARGET_KEYWORD');
      expect(sampleMatch.endsWith('...')).toBe(true);
      // The clipped line content should not exceed ~200 characters including prefix
      expect(sampleMatch.length).toBeLessThan(220);
    });
  });

  describe('7. Research Phase Blind-Spot Prevention & Repetitive Loop Detector', () => {
    it('pruneChatHistory preserves latest turn tool output so agent can read inspected file while pruning older turns', () => {
      const longOutputTurn1 = '1: const score = 100;\n'.repeat(30); // ~660 chars (> 400 outputThreshold)
      const longOutputTurn2 = '1: const lives = 3;\n'.repeat(30); // ~600 chars (> 400 outputThreshold)

      const history: any[] = [
        { role: 'user', parts: [{ text: 'Please inspect game' }] },
        // Turn 1
        {
          role: 'model',
          parts: [{ functionCall: { name: 'read_file', args: { path: 'game.js' } } }],
        },
        {
          role: 'user',
          parts: [{ functionResponse: { name: 'read_file', response: { output: longOutputTurn1 } } }],
        },
        // Turn 2 (latest model turn + latest tool result)
        {
          role: 'model',
          parts: [{ functionCall: { name: 'read_file', args: { path: 'game.js' } } }],
        },
        {
          role: 'user',
          parts: [{ functionResponse: { name: 'read_file', response: { output: longOutputTurn2 } } }],
        },
      ];

      const res = pruneChatHistory(history, {
        outputThresholdChars: 400,
        preserveRecentMessages: 2,
      });

      // Older turn 1 tool result MUST be pruned
      const turn1Response = history[2].parts[0].functionResponse.response.output;
      expect(turn1Response).toContain('<Tool output pruned:');

      // Latest turn 2 tool result MUST BE PRESERVED so model is not blinded!
      const turn2Response = history[4].parts[0].functionResponse.response.output;
      expect(turn2Response).toBe(longOutputTurn2);
      expect(turn2Response).not.toContain('<Tool output pruned:');
      expect(res.prunedCallsCount).toBeGreaterThan(0);
    });

    it('createRepetitiveCallGuardMiddleware blocks runaway repeated read_file on the same file', async () => {
      const vfs = new VirtualFS();
      await vfs.writeFile('game.js', 'console.log("hello");');
      const tools = createBuiltinTools();
      const readFileTool = tools.find((t) => t.name === 'read_file')!;

      const registry = new ToolRegistry([readFileTool]);
      // Use the repetitive call guard with maxConsecutiveCalls = 3
      const { createRepetitiveCallGuardMiddleware } = await import('../src/safety/index.js');
      registry.use(createRepetitiveCallGuardMiddleware({ maxConsecutiveCalls: 3 }));

      const dummyCtx = { fs: vfs, emit: vi.fn() } as any;

      // 1st, 2nd, 3rd calls: Allowed
      const res1 = await registry.execute('read_file', { path: 'game.js' }, dummyCtx);
      expect(res1.output).toContain('console.log("hello");');
      expect(res1.metadata?.loopGuardTriggered).toBeFalsy();

      const res2 = await registry.execute('read_file', { path: 'game.js' }, dummyCtx);
      expect(res2.output).toContain('console.log("hello");');

      const res3 = await registry.execute('read_file', { path: 'game.js' }, dummyCtx);
      expect(res3.output).toContain('console.log("hello");');

      // 4th call: Blocked by loop guard with guidance and isError: true
      const res4 = await registry.execute('read_file', { path: 'game.js' }, dummyCtx);
      expect(res4.isError).toBe(true);
      expect(res4.output).toContain('[LOOP_GUARD_WARNING]');
      expect(res4.output).toContain('read_file("game.js") 4 times in succession');
      expect(res4.output).toContain('Proceed immediately to edit_file(path, search, replace)');
      expect(res4.metadata?.loopGuardTriggered).toBe(true);
    });

    it('createRepetitiveCallGuardMiddleware allows reading different line ranges of a large file and resets recentWindow after edit_file', async () => {
      const vfs = new VirtualFS();
      const lines = Array.from({ length: 100 }, (_, i) => `const x_${i} = ${i};`).join('\n');
      await vfs.writeFile('game.js', lines);
      const tools = createBuiltinTools();
      const registry = new ToolRegistry(tools);
      const { createRepetitiveCallGuardMiddleware } = await import('../src/safety/index.js');
      registry.use(createRepetitiveCallGuardMiddleware({ maxConsecutiveCalls: 2 }));

      const dummyCtx = { fs: vfs, emit: vi.fn() } as any;

      // Reading 4 different line ranges sequentially must NOT trigger the loop guard
      const r1 = await registry.execute('read_file', { path: 'game.js', start_line: 1, end_line: 20 }, dummyCtx);
      const r2 = await registry.execute('read_file', { path: 'game.js', start_line: 21, end_line: 40 }, dummyCtx);
      const r3 = await registry.execute('read_file', { path: 'game.js', start_line: 41, end_line: 60 }, dummyCtx);
      const r4 = await registry.execute('read_file', { path: 'game.js', start_line: 61, end_line: 80 }, dummyCtx);
      expect(r1.isError).toBeFalsy();
      expect(r2.isError).toBeFalsy();
      expect(r3.isError).toBeFalsy();
      expect(r4.isError).toBeFalsy();

      // Reading the exact same range 2 times is allowed (maxConsecutiveCalls = 2)
      const same1 = await registry.execute('read_file', { path: 'game.js', start_line: 1, end_line: 10 }, dummyCtx);
      const same2 = await registry.execute('read_file', { path: 'game.js', start_line: 1, end_line: 10 }, dummyCtx);
      expect(same1.isError).toBeFalsy();
      expect(same2.isError).toBeFalsy();

      // Now call edit_file -> must clear recentWindow so post-edit verification read is allowed!
      const editRes = await registry.execute(
        'edit_file',
        { path: 'game.js', search: 'const x_0 = 0;', replace: 'const x_0 = 999;' },
        dummyCtx
      );
      expect(editRes.isError).toBe(false);

      // Post-edit verification reads of the same range (1-10) should be allowed again
      const postEditRead1 = await registry.execute('read_file', { path: 'game.js', start_line: 1, end_line: 10 }, dummyCtx);
      const postEditRead2 = await registry.execute('read_file', { path: 'game.js', start_line: 1, end_line: 10 }, dummyCtx);
      expect(postEditRead1.isError).toBeFalsy();
      expect(postEditRead2.isError).toBeFalsy();
    });

    it('ReactAgent deduplicates identical tool_call chunks emitted across streaming chunks in a single turn', async () => {
      const vfs = new VirtualFS();
      await vfs.writeFile('index.html', '<html><body>Hello</body></html>');

      let readCallCount = 0;
      const customTools = createBuiltinTools().map((t) => {
        if (t.name === 'read_file') {
          return {
            ...t,
            execute: async (args: any, ctx: any) => {
              readCallCount++;
              return t.execute(args, ctx);
            },
          };
        }
        return t;
      });

      let turn = 0;
      const duplicateStreamProvider: ILLMProvider = {
        id: 'dup-stream-provider',
        async *streamChat() {
          turn++;
          if (turn === 1) {
            // Simulate a streaming provider emitting the same functionCall across 3 chunks
            const duplicateTc = {
              id: 'call_dup_1',
              name: 'read_file',
              args: { path: 'index.html' },
            };
            yield { type: 'tool_call', toolCall: duplicateTc };
            yield { type: 'tool_call', toolCall: duplicateTc };
            yield { type: 'tool_call', toolCall: duplicateTc };
          } else {
            yield {
              type: 'tool_call',
              toolCall: {
                id: 'call_done',
                name: 'complete_task',
                args: { summary: 'Done without duplicate execution' },
              },
            };
          }
          yield {
            type: 'usage',
            usage: { promptTokens: 200, completionTokens: 50, totalTokens: 250 },
          };
          yield { type: 'done' };
        },
      };

      const agent = new ReactAgent({
        provider: duplicateStreamProvider,
        tools: customTools,
      });

      const events: AgentEvent[] = [];
      for await (const ev of agent.execute('Check index.html', undefined, vfs)) {
        events.push(ev);
      }

      // Must only execute read_file ONCE in turn 1 despite 3 duplicate streaming chunks
      expect(readCallCount).toBe(1);
      const readToolCallEvents = events.filter(
        (e) => e.type === 'TOOL_CALL' && e.payload.name === 'read_file'
      );
      expect(readToolCallEvents).toHaveLength(1);
    });

    it('EditFileTool includes applied diff preview so model does not need confirmation read_file', async () => {
      const vfs = new VirtualFS();
      await vfs.writeFile('index.html', '<!DOCTYPE html><html><body><div id="score">0</div></body></html>');

      const tools = createBuiltinTools();
      const editFileTool = tools.find((t) => t.name === 'edit_file')!;

      const emitMock = vi.fn();
      const result = await editFileTool.execute(
        {
          path: 'index.html',
          search: '<div id="score">0</div>',
          replace: '<div id="score">100</div>',
        },
        { fs: vfs, emit: emitMock } as any
      );

      expect(result.isError).toBe(false);
      expect(result.output).toContain('Replaced 23 chars with 25 chars in "index.html"');
      expect(result.output).toContain('[Applied Diff Preview]:');
      expect(result.output).toContain('-<!DOCTYPE html>');
      expect(result.output).toContain('+<!DOCTYPE html>');
    });
  });
});
