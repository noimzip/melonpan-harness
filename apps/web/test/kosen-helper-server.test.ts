import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ create: vi.fn(), proxy: vi.fn(), getStoredApiKeys: vi.fn(() => ({})), createLocalProvider: vi.fn() }));
vi.mock('../src/modules/kosen/server-provider', () => ({ createServerGenerationProvider: mocks.create }));
vi.mock('../src/modules/kosen/supabase', () => ({ invokeKosenAiProxy: mocks.proxy, fetchExhibitionSettings: vi.fn() }));
vi.mock('../src/services/provider-factory', () => ({ getStoredApiKeys: mocks.getStoredApiKeys, createProviderInstance: mocks.createLocalProvider }));
import { expandPromptWithAI, generateToppingsForPrompt } from '../src/modules/kosen/toppings-service';

describe('configured server-backed helper models', () => {
  it.each(['surplus', 'openrouter'] as const)('uses %s and its configured model for toppings and expansion', async provider => {
    mocks.create.mockReset(); mocks.proxy.mockReset(); mocks.createLocalProvider.mockReset();
    mocks.getStoredApiKeys.mockReturnValue({});
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

  it.each(['gemini', 'surplus', 'openrouter'] as const)('prioritizes locally stored API key over cloud proxy for %s', async provider => {
    mocks.create.mockReset(); mocks.proxy.mockReset(); mocks.createLocalProvider.mockReset();
    mocks.getStoredApiKeys.mockReturnValue({ [provider]: 'local-secret-key' });
    const stream = vi.fn().mockImplementation(async function* (request) {
      expect(request.model).toBe('local-model');
      yield { type: 'text_delta', delta: request.systemInstruction.includes('トッピング')
        ? '[{"emoji":"🔥","text":"ローカルギミック"}]'
        : '[{"title":"local1","expandedPrompt":"local1"},{"title":"local2","expandedPrompt":"local2"}]' };
    });
    mocks.createLocalProvider.mockReturnValue({ streamChat: stream });
    const toppings = await generateToppingsForPrompt('game', 10, { provider, model: 'local-model' });
    const expansions = await expandPromptWithAI('game', { provider, model: 'local-model' });
    expect(mocks.createLocalProvider).toHaveBeenCalledWith(provider, 'local-model', 'local-secret-key');
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.proxy).not.toHaveBeenCalled();
    expect(toppings[0].text).toBe('ローカルギミック');
    expect(expansions.map(item => item.title)).toEqual(['local1', 'local2']);
  });
});
