import {
  ILLMProvider,
  GeminiProvider,
  OpenAICompatibleProvider,
  OpenRouterProvider,
  OrcaRouterProvider,
  GroqProvider,
  SurplusProvider,
  DEFAULT_MODEL_PRICING,
  USD_TO_JPY_RATE as CORE_USD_TO_JPY_RATE,
  fetchDiscoveredModels,
  DiscoveredModel,
  ProviderApiKeys,
  registerModelContextWindow,
  resolveModelContextWindow,
} from '@melonpan/core';
import { ProviderType } from '../types';

export interface ModelCatalogItem {
  id: string;
  provider: ProviderType;
  label: string;
  description: string;
  isFree?: boolean;
  contextLength?: number;
}

export const ALL_SUPPORTED_MODELS: ModelCatalogItem[] = [
  // Google Gemini
  {
    id: 'gemini-3.8-flash',
    provider: 'gemini',
    label: 'gemini-3.8-flash',
    description: 'Flagship high-speed multimodality & reasoning (Google, default)',
  },
  {
    id: 'gemini-4-argon',
    provider: 'gemini',
    label: 'gemini-4-argon',
    description: 'Next-generation frontier reasoning model (Google)',
  },
  {
    id: 'gemini-3.5-flash-lite',
    provider: 'gemini',
    label: 'gemini-3.5-flash-lite',
    description: 'Ultra-lightweight & fast response model (Google)',
  },
  {
    id: 'gemma-4-31b-it',
    provider: 'gemini',
    label: 'gemma-4-31b-it',
    description: 'Open weights 31B instruction-tuned model (Google)',
  },
  // OpenAI
  {
    id: 'gpt-4o',
    provider: 'openai',
    label: 'gpt-4o',
    description: 'OpenAI flagship multimodal intelligence model',
  },
  {
    id: 'gpt-4o-mini',
    provider: 'openai',
    label: 'gpt-4o-mini',
    description: 'Fast, cost-efficient small model (OpenAI)',
  },
  {
    id: 'o3-mini',
    provider: 'openai',
    label: 'o3-mini',
    description: 'High-reasoning math and coding model (OpenAI)',
  },
  // Anthropic
  {
    id: 'claude-3-7-sonnet',
    provider: 'anthropic',
    label: 'claude-3-7-sonnet',
    description: 'Hybrid reasoning and coding model (Anthropic)',
  },
  {
    id: 'claude-3-5-haiku',
    provider: 'anthropic',
    label: 'claude-3-5-haiku',
    description: 'Lightning-fast concise model (Anthropic)',
  },
  // OpenRouter (Free tier prioritized)
  {
    id: 'meta-llama/llama-3.2-3b-instruct:free',
    provider: 'openrouter',
    label: 'meta-llama/llama-3.2-3b-instruct:free',
    description: 'Lightweight open instruction model (OpenRouter Free)',
    isFree: true,
  },
  {
    id: 'deepseek/deepseek-r1:free',
    provider: 'openrouter',
    label: 'deepseek/deepseek-r1:free',
    description: 'State-of-the-art reasoning model (OpenRouter Free)',
    isFree: true,
  },
  // Groq
  {
    id: 'llama-3.3-70b-versatile',
    provider: 'groq',
    label: 'llama-3.3-70b-versatile',
    description: 'Ultra-low latency inference on LPU (Groq)',
  },
  // Surplus Intelligence
  {
    id: 'surplus/deepseek/deepseek-chat',
    provider: 'surplus',
    label: 'surplus/deepseek/deepseek-chat',
    description: 'DeepSeek Chat on Surplus Intelligence decentralized market',
    isFree: false,
  },
  {
    id: 'surplus/claude-3-5-sonnet',
    provider: 'surplus',
    label: 'surplus/claude-3-5-sonnet',
    description: 'Claude 3.5 Sonnet on Surplus Intelligence decentralized market',
    isFree: false,
  },
];

export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

export const USD_TO_JPY_RATE = CORE_USD_TO_JPY_RATE;

export const MODEL_PRICING: Record<string, ModelPricing> = Object.fromEntries(
  Object.entries(DEFAULT_MODEL_PRICING).map(([id, spec]) => [
    id,
    {
      inputPerMillion: spec.inputPerMillion,
      outputPerMillion: spec.outputPerMillion,
    },
  ])
);

// 動的にAPIから取得されたモデルのWeb側キャッシュ
let webDynamicModels: ModelCatalogItem[] = [];

export function setWebDynamicModels(models: ModelCatalogItem[]): void {
  webDynamicModels = models;
  for (const m of models) {
    if (m.contextLength && m.contextLength > 0) {
      registerModelContextWindow(m.id, m.contextLength);
    }
  }
}

export function getWebDynamicModels(): ModelCatalogItem[] {
  return webDynamicModels;
}

export function clearWebDynamicModels(): void {
  webDynamicModels = [];
}

/**
 * 指定プロバイダー（または全体）で利用可能なモデル一覧を取得する
 * 1. APIキー設定により動的に取得されたモデルが存在する場合、それを優先
 * 2. 無料モデル (isFree === true) を最上位に配置し、残りは既定順序を維持
 * 3. 動的モデルがない場合は静的定義モデルにフォールバック
 */
export function getAvailableModels(provider?: ProviderType): ModelCatalogItem[] {
  if (webDynamicModels.length > 0) {
    const filtered = provider
      ? webDynamicModels.filter((m) => m.provider === provider)
      : webDynamicModels;
    if (filtered.length > 0) {
      const free = filtered.filter((m) => Boolean(m.isFree));
      const nonFree = filtered.filter((m) => !m.isFree);
      return [...free, ...nonFree];
    }
  }

  const staticFiltered = provider
    ? ALL_SUPPORTED_MODELS.filter((m) => m.provider === provider)
    : ALL_SUPPORTED_MODELS;
  const free = staticFiltered.filter((m) => Boolean(m.isFree));
  const nonFree = staticFiltered.filter((m) => !m.isFree);
  return [...free, ...nonFree];
}

/**
 * 設定済みAPIキーを持つプロバイダーからモデルおよびコンテキスト長をAPI経由で動的取得する
 */
export async function loadWebDiscoveredModels(options?: {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  baseUrls?: Record<string, string | undefined>;
}): Promise<ModelCatalogItem[]> {
  const stored = getStoredApiKeys();
  const keys: ProviderApiKeys = {};
  if (stored.gemini) keys.gemini = stored.gemini;
  if (stored.openai) keys.openai = stored.openai;
  if (stored.anthropic) keys.anthropic = stored.anthropic;
  if (stored.openrouter) keys.openrouter = stored.openrouter;
  if (stored.orcarouter) keys.orcarouter = stored.orcarouter;
  if (stored.groq) keys.groq = stored.groq;
  if (stored.surplus) keys.surplus = stored.surplus;

  if (Object.keys(keys).length === 0) {
    clearWebDynamicModels();
    return [];
  }

  try {
    const discovered = await fetchDiscoveredModels(keys, {
      fetchImpl: options?.fetchImpl,
      timeoutMs: options?.timeoutMs ?? 5000,
      baseUrls: options?.baseUrls,
    });

    const items: ModelCatalogItem[] = discovered.map((m) => ({
      id: m.id,
      provider: m.provider as ProviderType,
      label: m.name || m.id,
      description: m.description || m.name || '',
      isFree: m.isFree,
      contextLength: m.contextLength,
    }));

    setWebDynamicModels(items);
    return items;
  } catch (err) {
    console.error('Failed to load dynamic models in Web:', err);
    return webDynamicModels;
  }
}

const API_KEYS_STORAGE_KEY = 'melonpan_web_api_keys_v1';

export function getStoredApiKeys(): Record<string, string> {
  try {
    const raw = localStorage.getItem(API_KEYS_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function saveStoredApiKey(provider: string, key: string): void {
  try {
    const existing = getStoredApiKeys();
    if (key.trim()) {
      existing[provider.toLowerCase()] = key.trim();
    } else {
      delete existing[provider.toLowerCase()];
    }
    localStorage.setItem(API_KEYS_STORAGE_KEY, JSON.stringify(existing));
  } catch (e) {
    console.error('Failed to save API key:', e);
  }
}

export function clearAllStoredApiKeys(): void {
  try {
    localStorage.removeItem(API_KEYS_STORAGE_KEY);
  } catch {}
}

export function maskApiKey(key?: string): string {
  if (!key) return '(not set)';
  const trimmed = key.trim();
  if (trimmed.length <= 8) return '****';
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`;
}

export function createProviderInstance(
  providerId: string,
  modelName: string,
  apiKey?: string,
  baseUrl?: string
): ILLMProvider | undefined {
  const effectiveKey = apiKey || getStoredApiKeys()[providerId.toLowerCase()] || '';

  if (providerId === 'surplus' || modelName.startsWith('surplus/')) {
    return new SurplusProvider({
      apiKey: effectiveKey,
      baseUrl: baseUrl || undefined,
    });
  }
  if (providerId === 'openrouter' || modelName.startsWith('openrouter/')) {
    return new OpenRouterProvider({
      apiKey: effectiveKey,
      baseUrl: baseUrl || 'https://openrouter.ai/api/v1',
    });
  }
  if (providerId === 'orcarouter' || modelName.startsWith('orcarouter/')) {
    return new OrcaRouterProvider({
      apiKey: effectiveKey,
      baseUrl: baseUrl || 'https://api.orcarouter.ai/v1',
    });
  }
  if (
    providerId === 'groq' ||
    modelName.startsWith('groq/') ||
    modelName.startsWith('llama-') ||
    modelName.startsWith('mixtral-')
  ) {
    return new GroqProvider({
      apiKey: effectiveKey,
      baseUrl: baseUrl || 'https://api.groq.com/openai/v1',
    });
  }
  if (
    providerId === 'openai' ||
    modelName.startsWith('gpt-') ||
    modelName.startsWith('o1-') ||
    modelName.startsWith('o3-') ||
    modelName.startsWith('chatgpt-')
  ) {
    return new OpenAICompatibleProvider({
      id: 'openai',
      baseUrl: baseUrl || 'https://api.openai.com/v1',
      apiKey: effectiveKey,
    });
  }
  if (providerId === 'anthropic' || modelName.startsWith('claude-')) {
    return new OpenAICompatibleProvider({
      id: 'anthropic',
      baseUrl: baseUrl || 'https://api.anthropic.com/v1',
      apiKey: effectiveKey,
    });
  }
  if (providerId === 'gemini' || modelName.startsWith('gemini') || modelName.startsWith('gemma')) {
    return new GeminiProvider({
      apiKey: effectiveKey,
      useStreamingApi: true,
    });
  }
  return undefined;
}
