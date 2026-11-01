import { describe, it, expect, vi } from 'vitest';
import { ContextCacheManager } from '../src/cache/context-cache-manager.js';
import { MelonpanCore } from '../src/index.js';
import { AgentSession } from '../src/session/agent-session.js';
import { VirtualFS } from '../src/vfs/virtual-fs.js';
import { ToolOutputPruningStrategy } from '../src/session/context-strategy.js';
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

  it('applyPromptCacheControl injects ephemeral cache markers for Anthropic / OpenRouter', () => {
    const manager = new ContextCacheManager({ enablePromptCaching: true });

    const body: Record<string, any> = {
      messages: [
        { role: 'system', content: 'You are an autonomous game engine agent.' },
        { role: 'user', content: 'Create a game.' },
      ],
      tools: [
        { type: 'function', function: { name: 'tool_1' } },
        { type: 'function', function: { name: 'tool_2' } },
      ],
    };

    manager.applyPromptCacheControl(body);

    // System prompt marked
    expect(body.messages[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(body.messages[1].cache_control).toBeUndefined();

    // Last tool definition marked
    expect(body.tools[0].cache_control).toBeUndefined();
    expect(body.tools[1].cache_control).toEqual({ type: 'ephemeral' });
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

  it('extractOpenAIUsage extracts cachedPromptTokens from prompt_tokens_details', () => {
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
});
