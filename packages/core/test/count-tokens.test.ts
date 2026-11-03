import { describe, it, expect, vi } from 'vitest';
import {
  GeminiProvider,
  OpenAICompatibleProvider,
  countOpenAITokensWithTiktoken,
  estimateMessagesTokens,
  estimateTextTokens,
  type LLMMessage,
} from '../src/index.js';

describe('Multi-Provider Official Tokenizers (Gemini, Claude, OpenAI) & CJK Fallback', () => {
  const sampleMessages: LLMMessage[] = [
    {
      role: 'user',
      parts: [{ text: 'サイバーパンクな3Dシューティングゲームを作成してください。' }],
    },
    {
      role: 'model',
      parts: [
        {
          functionCall: {
            id: 'call_1',
            name: 'write_file',
            args: { path: 'index.html', content: '<!DOCTYPE html><html><body>Game</body></html>' },
          },
        },
      ],
    },
  ];

  it('1. GeminiProvider.countTokens invokes official ai.models.countTokens and returns exact server token count', async () => {
    const countTokensSpy = vi.fn(async () => ({
      totalTokens: 142,
    }));

    const mockAiClient = {
      models: {
        countTokens: countTokensSpy,
      },
    };

    const gemini = new GeminiProvider({
      apiKey: 'test-gemini-key',
      aiClient: mockAiClient,
      defaultModel: 'gemini-3.8-flash',
    });

    const count = await gemini.countTokens(
      sampleMessages,
      'You are an autonomous game engine agent.',
      'gemini-3.8-flash'
    );

    expect(count).toBe(142);
    expect(countTokensSpy).toHaveBeenCalledTimes(1);
    expect(countTokensSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-3.8-flash',
        config: { systemInstruction: 'You are an autonomous game engine agent.' },
      })
    );
  });

  it('2. Anthropic / Claude countTokens invokes official POST /v1/messages/count_tokens and parses input_tokens', async () => {
    const mockFetch = vi.fn(async (url: string, init: any) => {
      expect(url).toBe('https://api.anthropic.com/v1/messages/count_tokens');
      expect(init.method).toBe('POST');
      expect(init.headers['x-api-key']).toBe('sk-ant-test-key');
      expect(init.headers['anthropic-version']).toBe('2023-06-01');
      const body = JSON.parse(init.body);
      expect(body.model).toBe('claude-3-7-sonnet');
      expect(body.system).toBe('System prompt for Claude');
      return {
        ok: true,
        status: 200,
        json: async () => ({ input_tokens: 2095 }),
      } as any;
    });

    const anthropicProvider = new OpenAICompatibleProvider({
      id: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      apiKey: 'sk-ant-test-key',
      fetchImpl: mockFetch as any,
    });

    const tokens = await anthropicProvider.countTokens(
      sampleMessages,
      'System prompt for Claude',
      'claude-3-7-sonnet'
    );

    expect(tokens).toBe(2095);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it(
    '3. OpenAI GPT countTokens uses js-tiktoken (o200k_base / cl100k_base) for accurate zero-latency BPE counting',
    async () => {
      const openAiProvider = new OpenAICompatibleProvider({
        id: 'openai',
        apiKey: 'sk-openai-test',
      });

      const tokens4o = await openAiProvider.countTokens(
        sampleMessages,
        'You are a helpful coding assistant.',
        'gpt-4o'
      );
      const directTiktoken = countOpenAITokensWithTiktoken(
        sampleMessages,
        'You are a helpful coding assistant.',
        'gpt-4o'
      );

      expect(tokens4o).toBe(directTiktoken);
      expect(tokens4o).toBeGreaterThan(25);

      // Also test cl100k_base model (gpt-4-turbo)
      const tokensTurbo = await openAiProvider.countTokens(
        sampleMessages,
        'You are a helpful coding assistant.',
        'gpt-4-turbo'
      );
      expect(tokensTurbo).toBeGreaterThan(25);
    },
    20000
  );

  it('4. Fallback estimator accurately accounts for CJK (~1.5 tokens/char) vs ASCII code (~0.35 tokens/char)', async () => {
    const japaneseText = 'あいうえおかきくけこさしすせそたちつてと'; // 20 CJK chars -> ~30 tokens
    const asciiCode = 'const x = 100; const y = 200;'; // 29 ASCII chars -> ~11 tokens

    const jpTokens = estimateTextTokens(japaneseText);
    const codeTokens = estimateTextTokens(asciiCode);

    expect(jpTokens).toBe(30); // 20 * 1.5
    expect(codeTokens).toBe(11); // ceil(29 * 0.35 = 10.15)

    // Verify offline fallback when API fails
    const offlineGemini = new GeminiProvider({
      apiKey: 'test-key',
      aiClient: {
        models: {
          countTokens: vi.fn(async () => {
            throw new Error('Network offline');
          }),
        },
      },
    });

    const fallbackCount = await offlineGemini.countTokens([
      { role: 'user', parts: [{ text: japaneseText }] },
    ]);
    expect(fallbackCount).toBe(30);
    expect(estimateMessagesTokens([{ role: 'user', parts: [{ text: japaneseText }] }])).toBe(30);
  });
});
