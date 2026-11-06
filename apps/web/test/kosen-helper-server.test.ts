import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ create: vi.fn(), proxy: vi.fn() }));
vi.mock('../src/modules/kosen/server-provider', () => ({ createServerGenerationProvider: mocks.create }));
vi.mock('../src/modules/kosen/supabase', () => ({ invokeKosenAiProxy: mocks.proxy, fetchExhibitionSettings: vi.fn() }));
vi.mock('../src/services/provider-factory', () => ({ getStoredApiKeys: () => ({}), createProviderInstance: vi.fn() }));
import { expandPromptWithAI, generateToppingsForPrompt } from '../src/modules/kosen/toppings-service';

describe('configured server-backed helper models', () => {
  it.each(['surplus', 'openrouter'] as const)('uses %s and its configured model for toppings and expansion', async provider => {
    mocks.create.mockReset(); mocks.proxy.mockReset();
    const stream = vi.fn().mockImplementation(async function* (request) {
      expect(request.model).toBe('chosen-model');
      yield { type: 'text_delta', delta: request.systemInstruction.includes('トッピング')
        ? '[{"emoji":"🎮","text":"ボス戦"}]'
        : '[{"title":"one","expandedPrompt":"one"},{"title":"two","expandedPrompt":"two"}]' };
    });
    mocks.create.mockReturnValue({ streamChat: stream });
    const toppings = await generateToppingsForPrompt('game', 10, { provider, model: 'chosen-model' });
    const expansions = await expandPromptWithAI('game', { provider, model: 'chosen-model' });
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(mocks.create).toHaveBeenCalledWith(provider);
    expect(mocks.proxy).not.toHaveBeenCalled();
    expect(toppings[0].text).toBe('ボス戦');
    expect(expansions.map(item => item.title)).toEqual(['one', 'two']);
  });
});
