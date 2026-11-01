import { describe, it, expect } from 'vitest';
import {
  OpenRouterProvider,
  OrcaRouterProvider,
  GroqProvider,
  ProviderRegistry,
  fetchOpenRouterModels,
  fetchOrcaRouterModels,
  fetchGroqModels,
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

    it('registers openrouter, orcarouter, and groq in ProviderRegistry by default', () => {
      const registry = new ProviderRegistry();
      expect(registry.listProviders()).toContain('openrouter');
      expect(registry.listProviders()).toContain('orcarouter');
      expect(registry.listProviders()).toContain('groq');
      expect(registry.getProvider('openrouter')).toBeInstanceOf(OpenRouterProvider);
      expect(registry.getProvider('orcarouter')).toBeInstanceOf(OrcaRouterProvider);
      expect(registry.getProvider('groq')).toBeInstanceOf(GroqProvider);
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
  });
});
