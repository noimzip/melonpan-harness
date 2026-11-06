import { describe, expect, it } from 'vitest';
import { fetchAnthropicModels, fetchDiscoveredModels, getAnthropicEfforts } from '../src/providers/discovery.js';

describe('model discovery capabilities and failures', () => {
  const effort = {
    low: { supported: true }, medium: { supported: false }, high: { supported: true },
    xhigh: { supported: false }, max: { supported: true },
  };
  it('extracts only explicit supported Anthropic levels', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ data: [{ id: 'claude-test', capabilities: { effort } }] }));
    const models = await fetchAnthropicModels('key', { fetchImpl: fetchImpl as typeof fetch, throwOnError: true });
    expect(models[0]?.supportedEfforts).toEqual(['low', 'high', 'max']);
    expect(getAnthropicEfforts({ capabilities: { effort: { low: { supported: true } } } })).toBeUndefined();
    expect(getAnthropicEfforts({})).toBeUndefined();
  });
  it('distinguishes empty responses from API, network, and malformed responses', async () => {
    const fetchResult = (response: Response) => (async () => response) as typeof fetch;
    expect(await fetchDiscoveredModels({ openai: 'key' }, { throwOnError: true, fetchImpl: fetchResult(new Response('{"data":[]}')) })).toEqual([]);
    await expect(fetchDiscoveredModels({ openai: 'key' }, { throwOnError: true, fetchImpl: fetchResult(new Response('', { status: 401 })) })).rejects.toThrow('HTTP 401');
    await expect(fetchDiscoveredModels({ openai: 'key' }, { throwOnError: true, fetchImpl: fetchResult(new Response('{}')) })).rejects.toThrow('Invalid model response');
    await expect(fetchDiscoveredModels({ openai: 'key' }, { throwOnError: true, fetchImpl: (async () => { throw new Error('offline'); }) as typeof fetch })).rejects.toThrow('offline');
  });
});
