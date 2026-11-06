import { GeminiProvider, OpenAICompatibleProvider, type ILLMProvider } from '@melonpan/core';
import { getSupabaseClient, getSupabaseCredentials, type ServerKeyProvider } from './supabase';

/** Forward one provider request without ever exposing a provider credential to the kiosk. */
export async function requestServerGeneration(
  provider: ServerKeyProvider,
  request: unknown,
  signal?: AbortSignal,
  action: 'generate_provider' | 'list_provider_models' = 'generate_provider',
): Promise<Response> {
  const { url, anonKey } = getSupabaseCredentials();
  const { data: { session } } = await getSupabaseClient().auth.getSession();
  const staffToken = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('kosen_staff_token') : null;
  if (!session?.access_token && !staffToken) throw new Error('ゲーム生成にはスタッフの認証が必要です。');
  return fetch(`${url}/functions/v1/kosen-ai-proxy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: anonKey, Authorization: `Bearer ${session?.access_token || anonKey}`, ...(staffToken ? { 'x-kosen-staff-token': staffToken } : {}) },
    body: JSON.stringify({ action, payload: { provider, request } }),
    signal,
  });
}

export function createServerGenerationProvider(provider: ServerKeyProvider): ILLMProvider {
  if (provider === 'gemini') {
    return {
      id: 'gemini',
      async *streamChat(request, signal) {
        const gemini = new GeminiProvider({
          enableContextCache: false,
          aiClient: { models: { generateContent: async (body: unknown) => {
            const response = await requestServerGeneration(provider, body, signal);
            if (!response.ok) throw new Error(`サーバー側の生成に失敗しました (${response.status})。`);
            return response.json();
          } } },
        });
        yield* gemini.streamChat(request, signal);
      },
    };
  }
  return new OpenAICompatibleProvider({
    id: provider,
    apiKey: '',
    enablePromptCaching: false,
    fetchImpl: async (_url, init) => requestServerGeneration(provider, JSON.parse(String(init?.body)), init?.signal ?? undefined),
  });
}
