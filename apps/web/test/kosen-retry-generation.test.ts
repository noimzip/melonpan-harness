import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ get: vi.fn(), start: vi.fn() }));
vi.mock('../src/services/provider-factory.js', () => ({ getStoredApiKeys: () => ({}) }));
vi.mock('../src/modules/kosen/supabase.js', () => ({ getKosenSession: mocks.get }));
vi.mock('../src/modules/kosen/kosen-runner.js', () => ({ startKosenGeneration: mocks.start }));
import { retryKosenGeneration } from '../src/modules/kosen/retry-generation.js';
import type { ModelTierConfig } from '../src/modules/kosen/types.js';
const config: ModelTierConfig = { tier: 'fast', label: 'Retry', description: '', provider: 'surplus', model: ' gpt-6.1-terra ', thinkingEffort: 'high' };
const source = { id: 'old', status: 'failed', model_tier: 'ultra', age_group: 'over13', prompt: 'original prompt', toppings: ['boss'], is_public: false, game_title: 'Original' };
beforeEach(() => { vi.resetAllMocks(); mocks.get.mockResolvedValue(source); mocks.start.mockResolvedValue({ id: 'new' }); });
describe('admin regeneration', () => {
  it('preserves the original request and uses overridden model settings in a new session', async () => {
    expect(await retryKosenGeneration('old', config)).toEqual({ id: 'new' });
    expect(mocks.start).toHaveBeenCalledWith({ ageGroup: 'over13', prompt: 'original prompt', toppings: ['boss'], isPublic: false, gameTitle: 'Original', tierConfig: { ...config, tier: 'ultra', model: 'gpt-6.1-terra' } });
    expect(source.status).toBe('failed');
  });
  it.each(['running', 'completed', 'pending'])('refuses a session whose latest status is %s', async status => {
    mocks.get.mockResolvedValue({ ...source, status });
    await expect(retryKosenGeneration('old', config)).rejects.toThrow('失敗または中断');
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it('allows cancelled sessions and refuses missing sessions', async () => {
    mocks.get.mockResolvedValueOnce(null);
    await expect(retryKosenGeneration('old', config)).rejects.toThrow('見つかりません');
    mocks.get.mockResolvedValueOnce({ ...source, status: 'cancelled' });
    await expect(retryKosenGeneration('old', config)).resolves.toEqual({ id: 'new' });
  });
  it('prevents duplicate starts and releases the lock on failure', async () => {
    let reject!: (reason: Error) => void;
    mocks.start.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    const first = retryKosenGeneration('old', config);
    await vi.waitFor(() => expect(mocks.start).toHaveBeenCalledTimes(1));
    await expect(retryKosenGeneration('old', config)).rejects.toThrow('開始処理中');
    reject(new Error('offline'));
    await expect(first).rejects.toThrow('offline');
    await expect(retryKosenGeneration('old', config)).resolves.toEqual({ id: 'new' });
  });
  it('refuses an unconfigured client provider instead of running a simulation', async () => {
    await expect(retryKosenGeneration('old', { ...config, provider: 'groq' })).rejects.toThrow('API キー');
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it('rejects blank model names before starting', async () => {
    await expect(retryKosenGeneration('old', { ...config, model: '  ' })).rejects.toThrow('モデル名');
    expect(mocks.start).not.toHaveBeenCalled();
  });
});
