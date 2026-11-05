import { GoogleGenAI } from '@google/genai';

export interface DiscoveredModel {
  id: string;
  name?: string;
  provider: 'gemini' | 'openai' | 'anthropic' | 'openrouter' | 'orcarouter' | 'groq' | 'surplus' | string;
  description?: string;
  isFree?: boolean;
  contextLength?: number;
  raw?: any;
}

export interface ProviderApiKeys {
  gemini?: string;
  openai?: string;
  anthropic?: string;
  openrouter?: string;
  orcarouter?: string;
  groq?: string;
  surplus?: string;
}

export interface ModelDiscoveryOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  baseUrls?: {
    gemini?: string;
    openai?: string;
    anthropic?: string;
    openrouter?: string;
    orcarouter?: string;
    groq?: string;
    surplus?: string;
  };
  surplusMinDiscount?: number;
}

/**
 * OpenRouter: GET /api/v1/models
 * 無料モデル判定:
 * - ID末尾が :free または -free
 * - pricing.prompt === "0" かつ pricing.completion === "0"
 */
export async function fetchOpenRouterModels(
  apiKey: string,
  options: { baseUrl?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {}
): Promise<DiscoveredModel[]> {
  if (!apiKey) return [];
  const fetchFn = options.fetchImpl || fetch;
  const baseUrl = (options.baseUrl || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs || 5000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchFn(`${baseUrl}/models`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/noimzip/melonpan-harness',
        'X-Title': 'Melonpan Harness',
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      return [];
    }

    const data: any = await res.json();
    const list: any[] = Array.isArray(data?.data) ? data.data : [];

    return list.map((item) => {
      const promptPrice = item?.pricing?.prompt !== undefined ? String(item.pricing.prompt) : '';
      const completionPrice =
        item?.pricing?.completion !== undefined ? String(item.pricing.completion) : '';
      const isPriceZero =
        (promptPrice === '0' || Number(promptPrice) === 0) &&
        (completionPrice === '0' || Number(completionPrice) === 0) &&
        promptPrice !== '';

      const isFree = Boolean(
        item.id?.endsWith(':free') ||
          item.id?.endsWith('-free') ||
          item.id?.includes('/free') ||
          isPriceZero
      );

      return {
        id: item.id,
        name: item.name || item.id,
        provider: 'openrouter',
        description: item.description || item.name || 'OpenRouter model',
        isFree,
        contextLength: item.context_length,
        raw: item,
      };
    });
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * OrcaRouter: GET /api/v1/models (OpenAI互換)
 * 無料モデル判定:
 * - IDに free が含まれる
 * - pricing が 0
 */
export async function fetchOrcaRouterModels(
  apiKey: string,
  options: { baseUrl?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {}
): Promise<DiscoveredModel[]> {
  if (!apiKey) return [];
  const fetchFn = options.fetchImpl || fetch;
  const baseUrl = (options.baseUrl || 'https://api.orcarouter.ai/v1').replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs || 5000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchFn(`${baseUrl}/models`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      return [];
    }

    const data: any = await res.json();
    const list: any[] = Array.isArray(data?.data) ? data.data : [];

    return list.map((item) => {
      const promptPrice = item?.pricing?.prompt !== undefined ? String(item.pricing.prompt) : '';
      const completionPrice =
        item?.pricing?.completion !== undefined ? String(item.pricing.completion) : '';
      const isPriceZero =
        (promptPrice === '0' || Number(promptPrice) === 0) &&
        (completionPrice === '0' || Number(completionPrice) === 0) &&
        promptPrice !== '';

      const isFree = Boolean(
        item.id?.toLowerCase().includes('free') || isPriceZero
      );

      return {
        id: item.id,
        name: item.name || item.id,
        provider: 'orcarouter',
        description: item.description || 'OrcaRouter AI gateway model',
        isFree,
        contextLength: item.context_window || item.context_length,
        raw: item,
      };
    });
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Groq: GET /openai/v1/models (OpenAI互換)
 */
export async function fetchGroqModels(
  apiKey: string,
  options: { baseUrl?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {}
): Promise<DiscoveredModel[]> {
  if (!apiKey) return [];
  const fetchFn = options.fetchImpl || fetch;
  const baseUrl = (options.baseUrl || 'https://api.groq.com/openai/v1').replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs || 5000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchFn(`${baseUrl}/models`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      return [];
    }

    const data: any = await res.json();
    const list: any[] = Array.isArray(data?.data) ? data.data : [];

    return list
      .filter((item) => item.active !== false)
      .map((item) => {
        const isFree = Boolean(item.id?.toLowerCase().includes('free'));
        return {
          id: item.id,
          name: item.id,
          provider: 'groq',
          description: item.owned_by ? `Groq LPU (${item.owned_by})` : 'Groq LPU accelerated model',
          isFree,
          contextLength: item.context_window,
          raw: item,
        };
      });
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Surplus Intelligence: GET /v1/models (OpenAI互換)
 */
export async function fetchSurplusModels(
  apiKey: string,
  options: { baseUrl?: string; fetchImpl?: typeof fetch; timeoutMs?: number; minDiscount?: number } = {}
): Promise<DiscoveredModel[]> {
  if (!apiKey) return [];
  const fetchFn = options.fetchImpl || fetch;
  const envMinDiscount =
    typeof (globalThis as any).process !== 'undefined' &&
    (globalThis as any).process.env?.SURPLUS_MIN_DISCOUNT
      ? Number((globalThis as any).process.env.SURPLUS_MIN_DISCOUNT)
      : undefined;
  const minDiscount = options.minDiscount ?? envMinDiscount;
  const defaultBase = minDiscount
    ? `https://api.surplusintelligence.ai/min${minDiscount}/v1`
    : 'https://api.surplusintelligence.ai/v1';
  const baseUrl = (options.baseUrl || defaultBase).replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs || 5000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchFn(`${baseUrl}/models`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      return [];
    }

    const data: any = await res.json();
    const list: any[] = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];

    return list.map((item) => {
      const isFree = Boolean(
        item.id?.toLowerCase().includes('free') ||
        (item.pricing?.prompt === 0 && item.pricing?.completion === 0)
      );
      return {
        id: item.id,
        name: item.name || item.id,
        provider: 'surplus',
        description:
          item.description ||
          (item.owned_by ? `Surplus Intelligence (${item.owned_by})` : 'Surplus Intelligence model'),
        isFree,
        contextLength: item.context_window || item.context_length,
        raw: item,
      };
    });
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * OpenAI: GET /v1/models
 */
export async function fetchOpenAIModels(
  apiKey: string,
  options: { baseUrl?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {}
): Promise<DiscoveredModel[]> {
  if (!apiKey) return [];
  const fetchFn = options.fetchImpl || fetch;
  const baseUrl = (options.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs || 5000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchFn(`${baseUrl}/models`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      return [];
    }

    const data: any = await res.json();
    const list: any[] = Array.isArray(data?.data) ? data.data : [];

    // チャット推論対応モデル (gpt-*, o1-*, o3-*, o4-*, chatgpt-*) を優先しつつ、返却された全モデルを保持 (そのまま表示)
    const isChatModel = (id: string) =>
      id.startsWith('gpt-') ||
      id.startsWith('o1') ||
      id.startsWith('o3') ||
      id.startsWith('o4') ||
      id.startsWith('chatgpt');

    const chatModels = list.filter((m) => isChatModel(m.id || ''));
    const otherModels = list.filter((m) => !isChatModel(m.id || ''));
    const targetList = [...chatModels, ...otherModels];

    return targetList.map((item) => ({
      id: item.id,
      name: item.id,
      provider: 'openai',
      description: 'OpenAI frontier intelligence model',
      isFree: false,
      raw: item,
    }));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Anthropic: GET /v1/models
 */
export async function fetchAnthropicModels(
  apiKey: string,
  options: { baseUrl?: string; fetchImpl?: typeof fetch; timeoutMs?: number } = {}
): Promise<DiscoveredModel[]> {
  if (!apiKey) return [];
  const fetchFn = options.fetchImpl || fetch;
  const baseUrl = (options.baseUrl || 'https://api.anthropic.com/v1').replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs || 5000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchFn(`${baseUrl}/models`, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      return [];
    }

    const data: any = await res.json();
    const list: any[] = Array.isArray(data?.data) ? data.data : [];

    return list.map((item) => ({
      id: item.id,
      name: item.display_name || item.id,
      provider: 'anthropic',
      description: 'Anthropic Claude reasoning model',
      isFree: false,
      raw: item,
    }));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Google Gemini: GET https://generativelanguage.googleapis.com/v1beta/models?key=...
 */
export async function fetchGeminiModels(
  apiKey: string,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}
): Promise<DiscoveredModel[]> {
  if (!apiKey) return [];
  const fetchFn = options.fetchImpl || fetch;
  const timeoutMs = options.timeoutMs || 5000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchFn(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
      }
    );

    if (!res.ok) {
      return [];
    }

    const data: any = await res.json();
    const list: any[] = Array.isArray(data?.models) ? data.models : [];

    return list
      .filter((m) => {
        const methods: string[] = m.supportedGenerationMethods || [];
        return (
          methods.includes('generateContent') ||
          m.name?.includes('gemini') ||
          m.name?.includes('gemma')
        );
      })
      .map((item) => {
        const cleanId = (item.name || '').replace(/^models\//, '');
        const isFree = Boolean(cleanId.toLowerCase().includes('free'));
        return {
          id: cleanId,
          name: item.displayName || cleanId,
          provider: 'gemini',
          description: item.description || 'Google Gemini model',
          isFree,
          contextLength: item.inputTokenLimit,
          raw: item,
        };
      });
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 無料モデルをリストの最上位に配置し、残りはAPI返却の既定順序を維持するソーター
 * 要件: 「無料のモデルには右端に free と記述し、各種モデルリストの最上位に表示して残りは既定の順番で表示して」
 */
export function sortModelsWithFreeOnTop(models: DiscoveredModel[]): DiscoveredModel[] {
  const free = models.filter((m) => Boolean(m.isFree));
  const nonFree = models.filter((m) => !m.isFree);
  return [...free, ...nonFree];
}

/**
 * APIキーが設定されたプロバイダーからのみモデルを取得・統合するメインディスカバリー関数
 * 要件:
 * 1. 「APIキーが設定されるまではモデルリストに表示する必要はない」
 * 2. 「各種APIから取得できたモデルをそのまま表示してほしい」
 * 3. 「無料のモデルには右端に free と記述し、各種モデルリストの最上位に表示して残りは既定の順番で表示して」
 */
export async function fetchDiscoveredModels(
  apiKeys: ProviderApiKeys,
  options: ModelDiscoveryOptions = {}
): Promise<DiscoveredModel[]> {
  const fetchPromises: Promise<DiscoveredModel[]>[] = [];

  // 各プロバイダーについて、APIキーが設定されている場合のみリクエストを行う
  if (apiKeys.openrouter) {
    fetchPromises.push(
      fetchOpenRouterModels(apiKeys.openrouter, {
        baseUrl: options.baseUrls?.openrouter,
        fetchImpl: options.fetchImpl,
        timeoutMs: options.timeoutMs,
      }).then(sortModelsWithFreeOnTop)
    );
  }

  if (apiKeys.orcarouter) {
    fetchPromises.push(
      fetchOrcaRouterModels(apiKeys.orcarouter, {
        baseUrl: options.baseUrls?.orcarouter,
        fetchImpl: options.fetchImpl,
        timeoutMs: options.timeoutMs,
      }).then(sortModelsWithFreeOnTop)
    );
  }

  if (apiKeys.groq) {
    fetchPromises.push(
      fetchGroqModels(apiKeys.groq, {
        baseUrl: options.baseUrls?.groq,
        fetchImpl: options.fetchImpl,
        timeoutMs: options.timeoutMs,
      }).then(sortModelsWithFreeOnTop)
    );
  }

  if (apiKeys.surplus) {
    fetchPromises.push(
      fetchSurplusModels(apiKeys.surplus, {
        baseUrl: options.baseUrls?.surplus,
        minDiscount: options.surplusMinDiscount,
        fetchImpl: options.fetchImpl,
        timeoutMs: options.timeoutMs,
      }).then(sortModelsWithFreeOnTop)
    );
  }

  if (apiKeys.gemini) {
    fetchPromises.push(
      fetchGeminiModels(apiKeys.gemini, {
        fetchImpl: options.fetchImpl,
        timeoutMs: options.timeoutMs,
      }).then(sortModelsWithFreeOnTop)
    );
  }

  if (apiKeys.openai) {
    fetchPromises.push(
      fetchOpenAIModels(apiKeys.openai, {
        baseUrl: options.baseUrls?.openai,
        fetchImpl: options.fetchImpl,
        timeoutMs: options.timeoutMs,
      }).then(sortModelsWithFreeOnTop)
    );
  }

  if (apiKeys.anthropic) {
    fetchPromises.push(
      fetchAnthropicModels(apiKeys.anthropic, {
        baseUrl: options.baseUrls?.anthropic,
        fetchImpl: options.fetchImpl,
        timeoutMs: options.timeoutMs,
      }).then(sortModelsWithFreeOnTop)
    );
  }

  const results = await Promise.allSettled(fetchPromises);
  const allModels: DiscoveredModel[] = [];

  for (const r of results) {
    if (r.status === 'fulfilled') {
      allModels.push(...r.value);
    }
  }

  return allModels;
}
