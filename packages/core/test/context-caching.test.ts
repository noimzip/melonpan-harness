import { describe, it, expect, vi } from 'vitest';
import { ContextCacheManager } from '../src/cache/context-cache-manager.js';
import { MelonpanCore } from '../src/index.js';
import { AgentSession } from '../src/session/agent-session.js';
import { VirtualFS } from '../src/vfs/virtual-fs.js';
import { ToolOutputPruningStrategy, pruneChatHistory } from '../src/session/context-strategy.js';
import type { FunctionDeclaration } from '../src/types.js';

describe('ContextCacheManager', () => {
  it('stabilizeTools sorts tool declarations alphabetically by name for deterministic prefix caching', () => {
    const manager = new ContextCacheManager();
    const tools: FunctionDeclaration[] = [
      { name: 'write_file', description: 'Write file' },
      { name: 'ask_question', description: 'Ask question' },
      { name: 'edit_file', description: 'Edit file' },
      { name: 'dispatch_subagent', description: 'Dispatch' },
    ];

    const sorted = manager.stabilizeTools(tools);
    expect(sorted).toBeDefined();
    expect(sorted!.map((t) => t.name)).toEqual([
      'ask_question',
      'dispatch_subagent',
      'edit_file',
      'write_file',
    ]);

    // Handles empty or undefined
    expect(manager.stabilizeTools(undefined)).toBeUndefined();
    expect(manager.stabilizeTools([])).toEqual([]);
  });

  it('generateFingerprint produces identical hash regardless of tool declaration order', () => {
    const manager = new ContextCacheManager();
    const toolsA: FunctionDeclaration[] = [
      { name: 'write_file', description: 'Write file' },
      { name: 'read_file', description: 'Read file' },
    ];
    const toolsB: FunctionDeclaration[] = [
      { name: 'read_file', description: 'Read file' },
      { name: 'write_file', description: 'Write file' },
    ];

    const fpA = manager.generateFingerprint('gemini-3.8-flash', 'System instructions...', toolsA);
    const fpB = manager.generateFingerprint('gemini-3.8-flash', 'System instructions...', toolsB);

    expect(fpA).toBe(fpB);
    expect(fpA).toHaveLength(16);
    expect(/^[0-9a-f]{16}$/.test(fpA)).toBe(true);

    const fpDifferent = manager.generateFingerprint('gemini-3.8-flash', 'Different instructions', toolsA);
    expect(fpA).not.toBe(fpDifferent);
  });

  it('getOrCreateGeminiCache caches and reuses active cache handles', async () => {
    const manager = new ContextCacheManager({ ttlSeconds: 120 });
    let createCount = 0;

    const mockAiClient = {
      caches: {
        create: vi.fn(async (params: any) => {
          createCount++;
          return {
            name: `cachedContents/melonpan-cache-${createCount}`,
            model: params.model,
          };
        }),
      },
    };

    const cache1 = await manager.getOrCreateGeminiCache({
      ai: mockAiClient,
      model: 'gemini-3.8-flash',
      systemInstruction: 'Long system instructions (>4096 tokens)...',
      tools: [{ name: 'tool_a', description: 'Tool A' }],
    });

    expect(cache1).toBe('cachedContents/melonpan-cache-1');
    expect(createCount).toBe(1);

    // Calling again with the same instructions and model reuses active cache
    const cache2 = await manager.getOrCreateGeminiCache({
      ai: mockAiClient,
      model: 'gemini-3.8-flash',
      systemInstruction: 'Long system instructions (>4096 tokens)...',
      tools: [{ name: 'tool_a', description: 'Tool A' }],
    });

    expect(cache2).toBe('cachedContents/melonpan-cache-1');
    expect(createCount).toBe(1); // Cached, not recreated
  });

  it('getOrCreateGeminiCache gracefully falls back on API cache creation failure', async () => {
    const manager = new ContextCacheManager();

    const mockAiClient = {
      caches: {
        create: vi.fn(async () => {
          throw new Error('FAILED_PRECONDITION: Minimum token count for caching is 32768 tokens');
        }),
      },
    };

    const cache = await manager.getOrCreateGeminiCache({
      ai: mockAiClient,
      model: 'gemini-3.8-flash',
      systemInstruction: 'Short instructions',
      tools: [],
    });

    expect(cache).toBeUndefined(); // Fallback without throwing
  });

  it('isExplicitCacheSupported identifies model support correctly', () => {
    const manager = new ContextCacheManager();
    expect(manager.isExplicitCacheSupported('gemini-3.8-flash')).toBe(true);
    expect(manager.isExplicitCacheSupported('gemini-2.5-flash')).toBe(true);
    expect(manager.isExplicitCacheSupported('gemini-4-argon')).toBe(false);
  });

  it('applyPromptCacheControl injects ephemeral cache markers for Anthropic / OpenRouter across multi-turn messages', () => {
    const manager = new ContextCacheManager({ enablePromptCaching: true });

    const body: Record<string, any> = {
      messages: [
        { role: 'system', content: 'You are an autonomous game engine agent.' },
        { role: 'user', content: 'Turn 1 user prompt.' },
        { role: 'assistant', content: 'Turn 1 assistant response.' },
        { role: 'tool', tool_call_id: 'call_1', content: '{"output":"file written"}' },
        { role: 'user', content: 'Turn 2 user prompt.' },
      ],
      tools: [
        { type: 'function', function: { name: 'tool_1' } },
        { type: 'function', function: { name: 'tool_2' } },
      ],
    };

    manager.applyPromptCacheControl(body);

    // 1. System prompt marked
    expect(body.messages[0].cache_control).toEqual({ type: 'ephemeral' });

    // 2. Last tool definition marked
    expect(body.tools[0].cache_control).toBeUndefined();
    expect(body.tools[1].cache_control).toEqual({ type: 'ephemeral' });

    // 3. Conversation history prior-turn checkpoint marked (Turn 1 tool response right before Turn 2)
    expect(body.messages[3].cache_control).toEqual({ type: 'ephemeral' });
    expect(body.messages[4].cache_control).toBeUndefined(); // Current turn remains uncached for new inputs
  });

  it('extractGeminiUsage extracts cachedPromptTokens and billedPromptTokens correctly', () => {
    const manager = new ContextCacheManager();

    const metadata = {
      promptTokenCount: 10000,
      candidatesTokenCount: 500,
      totalTokenCount: 10500,
      cachedContentTokenCount: 7500,
    };

    const usage = manager.extractGeminiUsage(metadata);
    expect(usage.cachedPromptTokens).toBe(7500);
    expect(usage.billedPromptTokens).toBe(2500);
  });

  it('extractOpenAIUsage extracts cachedPromptTokens and normalizes Anthropic-style usage', () => {
    const manager = new ContextCacheManager();

    const rawUsage = {
      prompt_tokens: 8000,
      completion_tokens: 400,
      total_tokens: 8400,
      prompt_tokens_details: {
        cached_tokens: 6000,
      },
    };

    const usage = manager.extractOpenAIUsage(rawUsage);
    expect(usage.cachedPromptTokens).toBe(6000);
    expect(usage.billedPromptTokens).toBe(2000);

    // Anthropic Native style where input_tokens excludes cache_read_input_tokens
    const anthropicUsage = {
      input_tokens: 500,
      output_tokens: 300,
      cache_read_input_tokens: 4500,
      cache_creation_input_tokens: 200,
    };

    const normalized = manager.extractOpenAIUsage(anthropicUsage);
    expect(normalized.cachedPromptTokens).toBe(4500);
    expect(normalized.promptTokens).toBe(5000);
    expect(normalized.billedPromptTokens).toBe(500);
  });
});

describe('End-to-End Cache Savings & Usage Telemetry in MelonpanCore', () => {
  it('yields USAGE events and COMPLETE event with cachedPromptTokens in simulation mode', async () => {
    const core = new MelonpanCore({
      simulate: true,
      mode: 'plan',
    });

    const events = [];
    for await (const event of core.run('Build cyber neon pong')) {
      events.push(event);
    }

    const usageEvents = events.filter((e) => e.type === 'USAGE');
    expect(usageEvents.length).toBeGreaterThan(0);

    const lastUsage = usageEvents[usageEvents.length - 1];
    expect(lastUsage.payload.cachedPromptTokens).toBeGreaterThan(0);
    expect(lastUsage.payload.promptTokens).toBeGreaterThan(0);

    const completeEvent = events.find((e) => e.type === 'COMPLETE');
    expect(completeEvent).toBeDefined();
    expect(completeEvent?.payload.usage?.cachedPromptTokens).toBeGreaterThan(0);
  });

  it('AgentSession records and provides cachedPromptTokens telemetry', async () => {
    const session = new AgentSession({
      fs: new VirtualFS(),
      contextStrategies: [new ToolOutputPruningStrategy()],
    });

    // Feed a USAGE event
    session.recordEvent({
      type: 'USAGE',
      payload: {
        promptTokens: 12000,
        completionTokens: 800,
        totalTokens: 12800,
        cachedPromptTokens: 9000,
        turn: 3,
      },
      timestamp: Date.now(),
    });

    const usage = session.getUsage();
    expect(usage.promptTokens).toBe(12000);
    expect(usage.completionTokens).toBe(800);
    expect(usage.cachedPromptTokens).toBe(9000);
  });

  it('pruneChatHistory masks both giant tool output and error responses', () => {
    const hugeError = 'Error: Stack trace line 1\n'.repeat(40);
    const history = [
      {
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: 'run_command',
              response: { error: hugeError },
            },
          },
        ],
      },
    ];

    const result = pruneChatHistory(history, { outputThresholdChars: 500 });
    expect(result.prunedCallsCount).toBe(1);
    expect(result.savedCharsCount).toBeGreaterThan(0);
    expect(history[0].parts[0].functionResponse.response.error).toContain('<Tool output pruned:');
  });

  it('Issue #54: enforces Append-Only Immutable Prefix across multi-turn execution without mutating prior turns', async () => {
    const turnSnapshots: string[][] = [];
    let turn = 0;

    const mockProvider = {
      id: 'mock-prefix-check',
      async *streamChat(req: any) {
        turn++;
        // Record serialized snapshot of each message in the request
        turnSnapshots.push(req.messages.map((m: any) => JSON.stringify(m)));

        yield {
          type: 'thought_delta' as const,
          delta: `Turn ${turn} architectural reasoning that exceeds forty characters easily.`,
          thoughtSignature: `sig_${turn}`,
        };

        if (turn === 1) {
          yield {
            type: 'tool_call' as const,
            toolCall: {
              id: 'call_1',
              name: 'write_file',
              args: {
                path: 'index.html',
                content: '<!DOCTYPE html><html><body>' + 'A'.repeat(400) + '</body></html>',
              },
              thoughtSignature: 'sig_1',
            },
          };
        } else if (turn === 2) {
          yield {
            type: 'tool_call' as const,
            toolCall: {
              id: 'call_2',
              name: 'edit_file',
              args: {
                path: 'index.html',
                search: '<body>',
                replace: '<body class="neon">' + 'B'.repeat(350),
              },
              thoughtSignature: 'sig_2',
            },
          };
        } else {
          yield {
            type: 'tool_call' as const,
            toolCall: {
              id: 'call_3',
              name: 'complete_task',
              args: { summary: 'Done with immutable prefix' },
              thoughtSignature: 'sig_3',
            },
          };
        }

        yield {
          type: 'usage' as const,
          usage: {
            promptTokens: 1500,
            completionTokens: 150,
            totalTokens: 1650,
            cachedPromptTokens: turn > 1 ? 1200 : 0,
          },
        };
      },
    };

    const { ReactAgent } = await import('../src/react-agent.js');
    const vfs = new VirtualFS();
    const agent = new ReactAgent({
      provider: mockProvider,
      maxContextTokens: 128000,
    });

    for await (const _ev of agent.execute('Build game', undefined, vfs)) {
      // consume stream
    }

    expect(turnSnapshots.length).toBe(3);
    // Turn 1 has 1 message ([user_0])
    // Turn 2 has 3 messages ([user_0, model_1, user_1]) -> prefix [0] must match Turn 1 [0] byte-for-byte
    expect(turnSnapshots[1]![0]).toBe(turnSnapshots[0]![0]);
    // Turn 3 has 5 messages ([user_0, model_1, user_1, model_2, user_2]) -> prefix [0..2] must match Turn 2 [0..2] byte-for-byte!
    expect(turnSnapshots[2]![0]).toBe(turnSnapshots[1]![0]);
    expect(turnSnapshots[2]![1]).toBe(turnSnapshots[1]![1]);
    expect(turnSnapshots[2]![2]).toBe(turnSnapshots[1]![2]);
  });

  it('Issue #55: compacts large EditFileTool diffs and RunCommandTool outputs at ingestion time while preserving full metadata/events', async () => {
    const { createBuiltinTools, compactOutputAtIngestion } = await import('../src/tools/builtin-tools.js');
    const vfs = new VirtualFS();
    const initialLines = Array.from({ length: 60 }, (_, i) => `const line_${i} = ${i};`).join('\n');
    const replacedLines = Array.from({ length: 60 }, (_, i) => `const updated_${i} = ${i * 10};`).join('\n');
    await vfs.writeFile('game.js', initialLines);

    const tools = createBuiltinTools();
    const editTool = tools.find((t) => t.name === 'edit_file')!;
    const emitted: any[] = [];

    const editRes = await editTool.execute(
      {
        path: 'game.js',
        search: initialLines,
        replace: replacedLines,
      },
      { fs: vfs, emit: (e: any) => emitted.push(e) } as any
    );

    expect(editRes.isError).toBe(false);
    // LLM output is compacted at ingestion time
    expect(editRes.output).toContain('Compacted');
    expect(editRes.output.length).toBeLessThan(600);
    // Full unifiedDiff is preserved in metadata and FILE_CHANGED event for UI
    expect(editRes.metadata?.unifiedDiff.length).toBeGreaterThan(1500);
    expect(emitted[0]?.payload?.unifiedDiff?.length).toBeGreaterThan(1500);

    // Direct helper check for huge stdout logs
    const hugeLog = Array.from({ length: 120 }, (_, i) => `[TEST PASS] Suite ${i}: verified`).join('\n');
    const compactedLog = compactOutputAtIngestion(hugeLog, {
      maxChars: 1000,
      maxLines: 30,
      headLines: 10,
      tailLines: 10,
    });
    expect(compactedLog.compacted).toBe(true);
    expect(compactedLog.text).toContain('[TEST PASS] Suite 0: verified');
    expect(compactedLog.text).toContain('[TEST PASS] Suite 119: verified');
    expect(compactedLog.text).toContain('Compacted 100 lines at ingestion');
  });

  it('Issue #58: ContextCacheManager skips explicit cache creation when below minExplicitCacheTokens and supports prompt_cache_key', async () => {
    const manager = new ContextCacheManager({
      minExplicitCacheTokens: 2048,
      promptCacheKey: 'session-melonpan-123',
    });

    const mockAiClient = {
      caches: {
        create: vi.fn(async () => ({ name: 'cachedContents/should-not-be-called' })),
      },
    };

    // Short prompt (< 2048 tokens) skips explicit API call and relies on Implicit Caching
    const skipped = await manager.getOrCreateGeminiCache({
      ai: mockAiClient,
      model: 'gemini-3.8-flash',
      systemInstruction: 'Short system instruction under 2048 tokens',
      tools: [],
    });
    expect(skipped).toBeUndefined();
    expect(mockAiClient.caches.create).not.toHaveBeenCalled();

    // Prompt cache key is injected into OpenAI/Codex compatible body
    const body: Record<string, any> = {
      messages: [{ role: 'system', content: 'System' }],
    };
    manager.applyPromptCacheControl(body);
    expect(body.prompt_cache_key).toBe('session-melonpan-123');
  });

  it('Issue #58: LlmSummaryCompactionStrategy defaults to 85% triggerUtilization and 6 keepRecentMessages for production context windows', async () => {
    const { LlmSummaryCompactionStrategy } = await import('../src/session/context-strategy.js');
    const prodStrategy = new LlmSummaryCompactionStrategy({ maxContextTokens: 128000 });
    expect((prodStrategy as any).triggerUtilization).toBe(0.85);
    expect((prodStrategy as any).keepRecentMessages).toBe(6);
  });
});
