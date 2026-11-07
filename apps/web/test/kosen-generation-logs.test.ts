import { describe, it, expect, vi } from 'vitest';
import { safeLog, recordLog } from '../../../supabase/functions/kosen-ai-proxy/generation-logs';
import { handleGenerationProxy } from '../../../supabase/functions/kosen-ai-proxy/generation-proxy';
describe('private generation diagnostics', () => {
  it('retains marketplace diagnosis and removes secrets and arbitrary fields', () => {
    const entry = safeLog({ event: 'provider_error', details: { code: 'minimum_discount_not_met', message: 'Minimum 90%, best 87.5% secret-value', request_id: 'request-1', prompt: 'private', api_key: 'secret-value' }, request: { messages: ['private'] } }, 'secret-value');
    expect(entry.details).toEqual({ code: 'minimum_discount_not_met', message: 'Minimum 90%, best 87.5% [REDACTED]', request_id: 'request-1' });
    expect(JSON.stringify(entry)).not.toContain('private');
  });
  it('records the upstream reason without exposing it in the public response', async () => {
    const record = vi.fn();
    const response = await handleGenerationProxy(new Request('https://test'), { provider: 'surplus', sessionId: 'session-1', request: { model: 'claude-haiku-5.5', messages: [] } }, {
      isStaffRequest: async () => true, resolveServerApiKey: async () => 'secret-value', recordLog: record,
      fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'minimum_discount_not_met', message: 'Minimum 90%, best 87.5%' }, request_id: 'req-1' }), { status: 404 })),
    });
    expect(record.mock.calls[0][0]).toMatchObject({ session_id: 'session-1', details: { http_status: 404, code: 'minimum_discount_not_met', request_id: 'req-1' } });
    expect(await response.text()).not.toContain('87.5');
  });
  it('refuses unauthenticated requests before recording or fetching', async () => {
    const fetch = vi.fn(); const record = vi.fn();
    const response = await handleGenerationProxy(new Request('https://test'), {}, { isStaffRequest: async () => false, resolveServerApiKey: async () => '', fetch, recordLog: record });
    expect(response.status).toBe(403); expect(fetch).not.toHaveBeenCalled(); expect(record).not.toHaveBeenCalled();
  });
  it('does not propagate persistence failures', async () => {
    await expect(recordLog({ from() { throw new Error('offline'); } }, {})).resolves.toBeUndefined();
  });
});
