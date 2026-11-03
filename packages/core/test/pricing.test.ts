import { describe, it, expect } from 'vitest';
import {
  resolveModelPricing,
  calculateTokenCost,
  DEFAULT_COST_CAP_USD,
  USD_TO_JPY_RATE,
  ReactAgent,
  VirtualFS,
  ILLMProvider,
  StreamDelta,
  ChatResponse,
} from '../src/index.js';

describe('Model Pricing & Cost Calculation Engine', () => {
  it('resolves pricing for Gemini, OpenAI, and Claude models (including provider-prefixed names)', () => {
    expect(resolveModelPricing('gemini-3.8-flash').inputPerMillion).toBe(0.1);
    expect(resolveModelPricing('gpt-4o').inputPerMillion).toBe(2.5);
    expect(resolveModelPricing('openai/gpt-4o-mini').inputPerMillion).toBe(0.15);
    expect(resolveModelPricing('anthropic/claude-3-7-sonnet-20250219').inputPerMillion).toBe(3.0);
    expect(resolveModelPricing('claude-3-5-haiku-latest').inputPerMillion).toBe(0.8);
    expect(resolveModelPricing('unknown-custom-model').inputPerMillion).toBe(0.1);
  });

  it('calculates fresh input, cached input discount, output cost, and USD/JPY conversion accurately', () => {
    const breakdown = calculateTokenCost({
      model: 'gemini-4-argon',
      rawPromptTokens: 1_000_000,
      cachedPromptTokens: 800_000,
      completionTokens: 100_000,
    });

    // Fresh input: 200,000 * $1.25 / 1M = $0.25
    // Cached input: 800,000 * $0.3125 / 1M = $0.25
    // Output: 100,000 * $5.00 / 1M = $0.50
    // Total USD = $1.00
    expect(breakdown.freshInputTokens).toBe(200_000);
    expect(breakdown.cachedInputTokens).toBe(800_000);
    expect(breakdown.inputCostUsd).toBeCloseTo(0.5, 5);
    expect(breakdown.outputCostUsd).toBeCloseTo(0.5, 5);
    expect(breakdown.totalCostUsd).toBeCloseTo(1.0, 5);
    expect(breakdown.totalCostJpy).toBeCloseTo(1.0 * USD_TO_JPY_RATE, 2);

    // Saved USD: 800,000 * ($1.25 - $0.3125) / 1M = $0.75
    expect(breakdown.savedCostUsd).toBeCloseTo(0.75, 5);
    expect(breakdown.savedCostJpy).toBeCloseTo(0.75 * USD_TO_JPY_RATE, 2);
  });
});

describe('ReactAgent $2.00 Cost Cap Circuit Breaker', () => {
  it('defaults maxCostUsd to $2.00 and stops execution immediately when session cost reaches the cap', async () => {
    expect(DEFAULT_COST_CAP_USD).toBe(2.0);

    let turnCount = 0;
    const expensiveProvider: ILLMProvider = {
      id: 'expensive-mock',
      name: 'Expensive Mock Provider',
      supportsTools: true,
      supportsVision: false,
      supportsStreaming: true,
      async chat(): Promise<ChatResponse> {
        return { message: { role: 'assistant', content: 'ok' } };
      },
      async *streamChat(): AsyncGenerator<StreamDelta, void, unknown> {
        turnCount++;
        yield {
          type: 'tool_call',
          toolCall: {
            id: `call-${turnCount}`,
            name: 'list_dir',
            arguments: { path: '.' },
          },
        };
        // Using claude-3-7-sonnet ($3/1M input, $15/1M output):
        // 500,000 input ($1.50) + 50,000 output ($0.75) = $2.25 USD on Turn 1 (> $2.00 cap)
        yield {
          type: 'usage',
          usage: {
            promptTokens: 500_000,
            billedPromptTokens: 500_000,
            rawPromptTokens: 500_000,
            cachedPromptTokens: 0,
            contextWindowTokens: 50_000,
            completionTokens: 50_000,
            totalTokens: 550_000,
          },
        };
        yield { type: 'done', finishReason: 'tool_calls' };
      },
      async countTokens(): Promise<number> {
        return 1000;
      },
    };

    const agent = new ReactAgent({
      model: 'claude-3-7-sonnet',
      provider: expensiveProvider,
      enableStreaming: true,
      maxTurns: 10,
      // Default maxCostUsd = 2.00
    });

    const vfs = new VirtualFS();
    const events = [];
    for await (const event of agent.execute('Run a task', null, vfs)) {
      events.push(event);
    }

    // Should stop after Turn 1 because $2.25 >= $2.00
    expect(turnCount).toBe(1);

    const usageEvents = events.filter((e) => e.type === 'USAGE');
    expect(usageEvents.length).toBeGreaterThanOrEqual(1);
    expect(usageEvents[0].payload.estimatedCostUsd).toBeCloseTo(2.25, 4);

    const completeEvent = events.find((e) => e.type === 'COMPLETE');
    expect(completeEvent).toBeDefined();
    expect(completeEvent!.payload.costCapReached).toBe(true);
    expect(completeEvent!.payload.summary).toContain('累計費用が上限');
  });
});
