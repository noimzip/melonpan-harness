import { describe, it, expect } from 'vitest';
import {
  OpenRouterProvider,
  OrcaRouterProvider,
  GroqProvider,
  SurplusProvider,
  OpenAICompatibleProvider,
  ProviderRegistry,
  fetchOpenRouterModels,
  fetchOrcaRouterModels,
  fetchGroqModels,
  fetchSurplusModels,
  fetchDiscoveredModels,
  sortModelsWithFreeOnTop,
  DiscoveredModel,
} from '../src/providers/index.js';

describe('Providers Routing and Discovery (Core)', () => {
  describe('Provider Instantiation & Headers', () => {
    it('creates OpenRouterProvider with correct headers and default baseUrl', () => {
      const p = new OpenRouterProvider({ apiKey: 'sk-or-test' });
      expect(p.id).toBe('openrouter');
      expect((p as any).baseUrl).toBe('https://openrouter.ai/api/v1');
      expect((p as any).apiKey).toBe('sk-or-test');
      expect((p as any).extraHeaders['HTTP-Referer']).toBe('https://github.com/noimzip/melonpan-harness');
      expect((p as any).extraHeaders['X-Title']).toBe('Melonpan Harness');
    });

    it('creates OrcaRouterProvider with correct default baseUrl', () => {
      const p = new OrcaRouterProvider({ apiKey: 'sk-orca-test' });
      expect(p.id).toBe('orcarouter');
      expect((p as any).baseUrl).toBe('https://api.orcarouter.ai/v1');
      expect((p as any).apiKey).toBe('sk-orca-test');
    });

    it('creates GroqProvider with correct default baseUrl', () => {
      const p = new GroqProvider({ apiKey: 'gsk-test' });
      expect(p.id).toBe('groq');
      expect((p as any).baseUrl).toBe('https://api.groq.com/openai/v1');
      expect((p as any).apiKey).toBe('gsk-test');
    });

    it('creates SurplusProvider with default baseUrl, minDiscount routing, and apiKey', () => {
      const p1 = new SurplusProvider({ apiKey: 'inf_test_key_123' });
      expect(p1.id).toBe('surplus');
      expect((p1 as any).baseUrl).toBe('https://api.surplusintelligence.ai/v1');
      expect((p1 as any).apiKey).toBe('inf_test_key_123');

      const p2 = new SurplusProvider({ apiKey: 'inf_test_key_456', minDiscount: 30 });
      expect((p2 as any).baseUrl).toBe('https://api.surplusintelligence.ai/min30/v1');

      const p3 = new SurplusProvider({ baseUrl: 'https://custom.surplus.example/v1' });
      expect((p3 as any).baseUrl).toBe('https://custom.surplus.example/v1');
    });

    it('registers openrouter, orcarouter, groq, and surplus in ProviderRegistry by default', () => {
      const registry = new ProviderRegistry();
      expect(registry.listProviders()).toContain('openrouter');
      expect(registry.listProviders()).toContain('orcarouter');
      expect(registry.listProviders()).toContain('groq');
      expect(registry.listProviders()).toContain('surplus');
      expect(registry.getProvider('openrouter')).toBeInstanceOf(OpenRouterProvider);
      expect(registry.getProvider('orcarouter')).toBeInstanceOf(OrcaRouterProvider);
      expect(registry.getProvider('groq')).toBeInstanceOf(GroqProvider);
      expect(registry.getProvider('surplus')).toBeInstanceOf(SurplusProvider);
    });
  });

  describe('Model Discovery APIs & Free Model Priority', () => {
    it('fetches OpenRouter models and marks free models accurately', async () => {
      const mockFetch = async () =>
        new Response(
          JSON.stringify({
            data: [
              {
                id: 'openai/gpt-4o',
                name: 'GPT-4o',
                description: 'Frontier OpenAI model',
                pricing: { prompt: '0.0000025', completion: '0.00001' },
              },
              {
                id: 'meta-llama/llama-3.2-3b-instruct:free',
                name: 'Llama 3.2 3B (free)',
                description: 'Free Meta model',
                pricing: { prompt: '0', completion: '0' },
              },
              {
                id: 'deepseek/deepseek-r1:free',
                name: 'DeepSeek R1 Free',
                description: 'Free Reasoning model',
                pricing: { prompt: '0', completion: '0' },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );

      const models = await fetchOpenRouterModels('test-key', { fetchImpl: mockFetch as any });
      expect(models.length).toBe(3);
      expect(models[0].isFree).toBe(false);
      expect(models[1].isFree).toBe(true);
      expect(models[2].isFree).toBe(true);
    });

    it('sortModelsWithFreeOnTop puts free models first while maintaining default order for rest', () => {
      const input: DiscoveredModel[] = [
        { id: 'm1', provider: 'test', isFree: false },
        { id: 'm2', provider: 'test', isFree: true },
        { id: 'm3', provider: 'test', isFree: false },
        { id: 'm4', provider: 'test', isFree: true },
        { id: 'm5', provider: 'test', isFree: false },
      ];

      const sorted = sortModelsWithFreeOnTop(input);
      expect(sorted.map((m) => m.id)).toEqual(['m2', 'm4', 'm1', 'm3', 'm5']);
    });

    it('does not display any models when no API key is provided (Requirement: APIキーが設定されるまではモデルリストに表示しない)', async () => {
      const models = await fetchDiscoveredModels({});
      expect(models).toEqual([]);
    });

    it('fetches Surplus models, respects custom minDiscount, and detects free models', async () => {
      let requestedUrl = '';
      let authHeader = '';
      const mockFetch = async (url: string | URL | Request, init?: RequestInit) => {
        requestedUrl = String(url);
        authHeader = String(init?.headers && (init.headers as any)['Authorization']);
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 'deepseek/deepseek-chat',
                name: 'DeepSeek Chat',
                owned_by: 'deepseek',
                context_window: 64000,
              },
              {
                id: 'deepseek/deepseek-r1-free',
                name: 'DeepSeek R1 Free',
                owned_by: 'deepseek',
                context_window: 64000,
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const models = await fetchSurplusModels('inf_test_key_xyz', {
        minDiscount: 40,
        fetchImpl: mockFetch as any,
      });

      expect(requestedUrl).toBe('https://api.surplusintelligence.ai/min40/v1/models');
      expect(authHeader).toBe('Bearer inf_test_key_xyz');
      expect(models.length).toBe(2);
      expect(models[0].provider).toBe('surplus');
      expect(models[0].isFree).toBe(false);
      expect(models[1].isFree).toBe(true);
    });

    it('fetches only from providers whose API key is configured', async () => {
      const requestedUrls: string[] = [];
      const mockFetch = async (url: string | URL | Request) => {
        requestedUrls.push(String(url));
        return new Response(
          JSON.stringify({
            data: [
              { id: 'orcarouter/deepseek/deepseek-v4-flash-free', name: 'DeepSeek V4 Free' },
              { id: 'orcarouter/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet' },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      // Only OrcaRouter key is set
      const models = await fetchDiscoveredModels(
        { orcarouter: 'sk-orca-test' },
        { fetchImpl: mockFetch as any }
      );

      expect(requestedUrls.length).toBe(1);
      expect(requestedUrls[0]).toContain('api.orcarouter.ai');
      expect(models.length).toBe(2);
      // Free model must be at top!
      expect(models[0].id).toBe('orcarouter/deepseek/deepseek-v4-flash-free');
      expect(models[0].isFree).toBe(true);
      expect(models[1].id).toBe('orcarouter/claude-3.5-sonnet');
      expect(models[1].isFree).toBe(false);
    });

    it('fetches concurrently when multiple provider API keys are configured (OrcaRouter and Surplus)', async () => {
      const requestedUrls: string[] = [];
      const mockFetch = async (url: string | URL | Request) => {
        requestedUrls.push(String(url));
        if (String(url).includes('surplusintelligence.ai')) {
          return new Response(
            JSON.stringify({
              data: [
                { id: 'deepseek/deepseek-chat', name: 'DeepSeek Chat' },
                { id: 'deepseek/free-model', name: 'Free Model' },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(
          JSON.stringify({
            data: [
              { id: 'orcarouter/deepseek/deepseek-v4-flash-free', name: 'DeepSeek V4 Free' },
              { id: 'orcarouter/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet' },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const models = await fetchDiscoveredModels(
        { orcarouter: 'sk-orca-test', surplus: 'inf_test_key_123' },
        { fetchImpl: mockFetch as any }
      );

      expect(requestedUrls.length).toBe(2);
      expect(requestedUrls.some((u) => u.includes('api.orcarouter.ai'))).toBe(true);
      expect(requestedUrls.some((u) => u.includes('api.surplusintelligence.ai'))).toBe(true);
      expect(models.length).toBe(4);
    });

    it('SurplusProvider streamChat strips surplus/ prefix from request.model before sending payload', async () => {
      let interceptedPayload: any = null;
      const mockFetch = async (url: string | URL | Request, init?: RequestInit) => {
        interceptedPayload = JSON.parse(String(init?.body || '{}'));
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: 'Surplus response' } }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const surplus = new SurplusProvider({
        apiKey: 'inf_test_key',
        fetchImpl: mockFetch as any,
      });

      const chunks: any[] = [];
      for await (const chunk of surplus.streamChat({
        model: 'surplus/deepseek/deepseek-chat',
        messages: [{ role: 'user', parts: [{ text: 'Hello' }] }],
      })) {
        chunks.push(chunk);
      }

      expect(interceptedPayload).not.toBeNull();
      expect(interceptedPayload.model).toBe('deepseek/deepseek-chat');
      expect(interceptedPayload.stream).toBe(true);
      expect(chunks.some((c) => c.type === 'text_delta' && c.delta === 'Surplus response')).toBe(true);
    });

    it('respects SURPLUS_MIN_DISCOUNT environment variable in SurplusProvider and fetchSurplusModels', async () => {
      process.env.SURPLUS_MIN_DISCOUNT = '25';
      try {
        const p = new SurplusProvider({ apiKey: 'inf_test_key' });
        expect((p as any).baseUrl).toBe('https://api.surplusintelligence.ai/min25/v1');

        let requestedUrl = '';
        const mockFetch = async (url: string | URL | Request) => {
          requestedUrl = String(url);
          return new Response(JSON.stringify({ data: [] }), { status: 200 });
        };
        await fetchSurplusModels('inf_test_key', { fetchImpl: mockFetch as any });
        expect(requestedUrl).toBe('https://api.surplusintelligence.ai/min25/v1/models');
      } finally {
        delete process.env.SURPLUS_MIN_DISCOUNT;
      }
    });

    it('SurplusProvider countTokens does not attempt Anthropic API call for claude models', async () => {
      const calledUrls: string[] = [];
      const mockFetch = async (url: string | URL | Request) => {
        calledUrls.push(String(url));
        return new Response('{}', { status: 200 });
      };

      const surplus = new SurplusProvider({
        apiKey: 'inf_test_key',
        fetchImpl: mockFetch as any,
      });

      const count = await surplus.countTokens(
        [{ role: 'user', parts: [{ text: 'Hello world token estimation' }] }],
        undefined,
        'surplus/claude-3-5-sonnet'
      );

      expect(calledUrls.length).toBe(0);
      expect(count).toBeGreaterThan(0);
    });

    it('preserves system role for Surplus / gateway models and uses developer role only for direct OpenAI', async () => {
      let interceptedPayload: any = null;
      const mockFetch = async (_url: string | URL | Request, init?: RequestInit) => {
        interceptedPayload = JSON.parse(String(init?.body || '{}'));
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: 'OK' } }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      const surplus = new SurplusProvider({
        apiKey: 'inf_test_key',
        fetchImpl: mockFetch as any,
      });

      // 1. Surplus: gpt-6.1-terra must retain role: "system" because Surplus rejects "developer"
      for await (const _ of surplus.streamChat({
        model: 'surplus/gpt-6.1-terra',
        systemInstruction: 'You are an autonomous coding agent.',
        messages: [{ role: 'user', parts: [{ text: 'Hello' }] }],
      })) {}

      expect(interceptedPayload.messages[0].role).toBe('system');
      expect(interceptedPayload.messages[0].content).toBe('You are an autonomous coding agent.');

      // 2. Direct OpenAI (id: 'openai'): reasoning models use role: "developer"
      const directOpenAI = new OpenAICompatibleProvider({
        id: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        fetchImpl: mockFetch as any,
      });

      for await (const _ of directOpenAI.streamChat({
        model: 'openai/o1-mini',
        systemInstruction: 'You are an autonomous coding agent.',
        messages: [{ role: 'user', parts: [{ text: 'Hello' }] }],
      })) {}

      expect(interceptedPayload.messages[0].role).toBe('developer');
      expect(interceptedPayload.messages[0].content).toBe('You are an autonomous coding agent.');
    });
  });
});
