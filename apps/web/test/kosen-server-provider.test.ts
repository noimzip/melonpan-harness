import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleGenerationProxy, handleProviderModels } from '../../../supabase/functions/kosen-ai-proxy/generation-proxy';

vi.mock('../src/modules/kosen/supabase', () => ({
  getSupabaseCredentials: () => ({ url: 'https://project.supabase.test', anonKey: 'public-anon' }),
  getSupabaseClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'staff-token' } } }) } }),
}));
import { createServerGenerationProvider } from '../src/modules/kosen/server-provider';

const req = () => new Request('https://project.supabase.test/functions/v1/kosen-ai-proxy', { method: 'POST' });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('staff-only provider proxy', () => {
  it('blocks unauthenticated and unsupported requests before reading a key or calling upstream', async () => {
    const deps = { isStaffRequest: vi.fn().mockResolvedValue(false), resolveServerApiKey: vi.fn(), fetch: vi.fn() };
    expect((await handleGenerationProxy(req(), { provider: 'openrouter', request: { model: 'a', messages: [] } }, deps)).status).toBe(403);
    deps.isStaffRequest.mockResolvedValue(true);
    expect((await handleGenerationProxy(req(), { provider: 'untrusted', request: { model: 'a', messages: [] } }, deps)).status).toBe(400);
    expect(deps.resolveServerApiKey).not.toHaveBeenCalled();
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['openrouter', 'https://openrouter.ai/api/v1/chat/completions'],
    ['surplus', 'https://api.surplusintelligence.ai/v1/chat/completions'],
  ] as const)('forwards %s tool requests with only its server-side key', async (provider, url) => {
    const upstream = vi.fn().mockResolvedValue(json({ choices: [{ message: { content: 'ok' } }] }));
    const deps = { isStaffRequest: vi.fn().mockResolvedValue(true), resolveServerApiKey: vi.fn().mockResolvedValue('provider-secret'), fetch: upstream };
    const body = { model: 'model-a', messages: [{ role: 'user', content: 'hello' }], tools: [{ type: 'function' }] };
    const res = await handleGenerationProxy(req(), { provider, request: body }, deps);
    expect(res.status).toBe(200);
    expect(deps.resolveServerApiKey).toHaveBeenCalledWith(provider);
    expect(upstream).toHaveBeenCalledWith(url, expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer provider-secret' }), body: JSON.stringify(body) }));
    expect(await res.text()).not.toContain('provider-secret');
  });

  it('preserves Gemini tool signatures on their parts and propagates upstream errors safely', async () => {
    const upstream = vi.fn().mockResolvedValueOnce(json({ candidates: [] })).mockResolvedValueOnce(json({ secret: 'do-not-echo' }, 401));
    const deps = { isStaffRequest: vi.fn().mockResolvedValue(true), resolveServerApiKey: vi.fn().mockResolvedValue('secret'), fetch: upstream };
    const request = { model: 'gemini-x', contents: [{ role: 'model', parts: [{ thoughtSignature: 'sig', thought_signature: 'sig', functionCall: { name: 'write_file', args: {}, thoughtSignature: 'sig', thought_signature: 'sig' } }] }], config: { systemInstruction: 'system', tools: [{ functionDeclarations: [] }] } };
    await handleGenerationProxy(req(), { provider: 'gemini', request }, deps);
    const [url, init] = upstream.mock.calls[0];
    expect(url).toContain('/models/gemini-x:generateContent');
    const body = JSON.parse(init.body);
    expect(body.contents[0].parts[0]).toEqual({ thoughtSignature: 'sig', functionCall: { name: 'write_file', args: {} } });
    expect(body.systemInstruction.parts[0].text).toBe('system');
    const response = await handleGenerationProxy(req(), { provider: 'gemini', request }, deps);
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain('do-not-echo');
  });

  it('discovers models through the correct fixed provider endpoint', async () => {
    const upstream = vi.fn().mockResolvedValue(json({ data: [{ id: 'model-a' }] }));
    const deps = { isStaffRequest: vi.fn().mockResolvedValue(true), resolveServerApiKey: vi.fn().mockResolvedValue('secret'), fetch: upstream };
    const res = await handleProviderModels(req(), 'surplus', deps);
    expect(upstream).toHaveBeenCalledWith('https://api.surplusintelligence.ai/v1/models', expect.objectContaining({ headers: { Authorization: 'Bearer secret' } }));
    expect(await res.json()).toEqual({ data: [{ id: 'model-a' }] });
  });
});

describe('kiosk provider adapter', () => {
  it.each(['openrouter', 'surplus'] as const)('sends %s conversations and tool definitions to the server and handles tool calls', async provider => {
    const fetchMock = vi.fn().mockResolvedValue(json({ choices: [{ message: { tool_calls: [{ id: 'call-1', function: { name: 'write_file', arguments: '{"path":"index.html"}' } }] } }], usage: { prompt_tokens: 12, completion_tokens: 3 } }));
    vi.stubGlobal('fetch', fetchMock);
    const chunks = [];
    for await (const chunk of createServerGenerationProvider(provider).streamChat({ model: 'model-a', messages: [{ role: 'user', parts: [{ text: 'create game' }] }], tools: [{ name: 'write_file', parameters: { type: 'OBJECT', properties: { path: { type: 'STRING' } } } }] } as any)) chunks.push(chunk);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.action).toBe('generate_provider');
    expect(body.payload.provider).toBe(provider);
    expect(body.payload.request.messages[0].content).toBe('create game');
    expect(body.payload.request.tools[0].function.name).toBe('write_file');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer staff-token');
    expect(chunks).toContainEqual(expect.objectContaining({ type: 'tool_call', toolCall: expect.objectContaining({ name: 'write_file', args: { path: 'index.html' } }) }));
  });

  it('sends Gemini requests through the server and retains returned tool signatures', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ candidates: [{ content: { parts: [{ thoughtSignature: 'signature', functionCall: { name: 'write_file', args: { path: 'index.html' } } }] } }] }));
    vi.stubGlobal('fetch', fetchMock);
    const chunks = [];
    for await (const chunk of createServerGenerationProvider('gemini').streamChat({ model: 'gemini-x', messages: [{ role: 'user', parts: [{ text: 'create' }] }] } as any)) chunks.push(chunk);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).payload.provider).toBe('gemini');
    expect(chunks).toContainEqual(expect.objectContaining({ type: 'tool_call', toolCall: expect.objectContaining({ name: 'write_file', thoughtSignature: 'signature' }) }));
  });
});

describe('server-backed ReAct execution', () => {
  it('writes the generated HTML through the real runtime and returns tool results on the next turn', async () => {
    const { AgentRuntime } = await import('../src/services/agent-runtime');
    const { createInitialSession } = await import('../src/services/session-storage');
    const calls: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init: RequestInit) => {
      calls.push(JSON.parse(String(init.body)));
      const tool = calls.length === 1
        ? { name: 'write_file', arguments: JSON.stringify({ path: 'index.html', content: '<html>real runtime</html>' }) }
        : { name: 'complete_task', arguments: JSON.stringify({ summary: 'complete' }) };
      return json({ choices: [{ message: { tool_calls: [{ id: `call-${calls.length}`, type: 'function', function: tool }] } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
    }));
    const runtime = new AgentRuntime();
    runtime.setPermissionPolicy({ read: 'allow', write: 'allow', command: 'allow', web: 'allow' });
    const onFileChange = vi.fn();
    await runtime.executeTurn('Create a game', createInitialSession('test', 'model-a'), {
      provider: 'openrouter', model: 'model-a', apiKey: '', baseUrl: '', bridgeUrl: '', thinkingEffort: 'low',
    }, {
      onMessageUpdate: () => {}, onToolCallUpdate: () => {}, onFileChange,
      onPlanUpdate: () => {}, onSubagentUpdate: () => {}, onPermissionRequest: r => r.resolve('always_allow'), onMetricsUpdate: () => {},
    }, createServerGenerationProvider('openrouter'), true);
    expect(onFileChange).toHaveBeenCalledWith('index.html', '<html>real runtime</html>');
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls[1].payload.request.messages.some((message: any) => message.role === 'tool' && message.content.includes('Successfully wrote'))).toBe(true);
  }, 15000);
});
