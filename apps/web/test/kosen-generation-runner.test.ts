import { beforeEach, describe, expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({ execute: vi.fn(), createProvider: vi.fn((id: string) => ({ id })), update: vi.fn(), event: vi.fn(), publish: vi.fn() }));
vi.mock('../src/services/agent-runtime', () => ({ AgentRuntime: class { setPermissionPolicy() {} cancelCurrentTask() {} executeTurn(...args: unknown[]) { return f.execute(...args); } } }));
vi.mock('../src/services/provider-factory', () => ({ getStoredApiKeys: () => ({}) }));
vi.mock('../src/modules/kosen/server-provider', () => ({ createServerGenerationProvider: f.createProvider }));
vi.mock('../src/modules/kosen/supabase', () => ({
  fetchExhibitionSettings: async () => ({ statusExpireMinutes: 5 }),
  createKosenSession: async () => ({ id: 'session-test' }),
  appendKosenEvent: f.event,
  updateKosenSession: f.update,
  publishKosenGame: f.publish,
}));
vi.mock('../src/modules/kosen/toppings-service', () => ({
  generateGameSummaryAndTitle: async () => ({ title: 'Game', description: 'Description' }),
  buildInteractiveFallbackGameHtml: () => '<html>fallback</html>',
}));
import { startKosenGeneration } from '../src/modules/kosen/kosen-runner';

beforeEach(() => { vi.clearAllMocks(); f.update.mockResolvedValue(undefined); f.event.mockResolvedValue(undefined); f.publish.mockResolvedValue(undefined); });
const params = (provider: 'openrouter' | 'surplus' | 'gemini') => ({
  ageGroup: 'over13' as const, prompt: 'game', toppings: [], isPublic: false,
  tierConfig: { tier: 'fast' as const, label: 'Fast', provider, model: 'game-model', thinkingEffort: 'low' as const, description: '' },
});

describe('kiosk server-backed generation', () => {
  it.each(['openrouter', 'surplus', 'gemini'] as const)('runs the selected %s provider and publishes its actual HTML', async provider => {
    f.execute.mockImplementation(async (_prompt, _session, config, callbacks, customProvider) => {
      expect(config.provider).toBe(provider);
      expect(customProvider.id).toBe(provider);
      callbacks.onFileChange('index.html', '<html>generated</html>');
    });
    await startKosenGeneration(params(provider));
    await vi.waitFor(() => expect(f.publish).toHaveBeenCalled());
    expect(f.publish).toHaveBeenCalledWith(expect.objectContaining({ htmlContent: '<html>generated</html>' }));
    expect(f.update).toHaveBeenCalledWith('session-test', expect.objectContaining({ status: 'completed' }));
  });

  it('marks provider errors as failures instead of publishing a fallback game', async () => {
    f.execute.mockRejectedValue(new Error('provider unavailable'));
    await startKosenGeneration(params('surplus'));
    await vi.waitFor(() => expect(f.update).toHaveBeenCalledWith('session-test', expect.objectContaining({ status: 'failed', error_message: 'provider unavailable' })));
    expect(f.publish).not.toHaveBeenCalled();
  });
});
