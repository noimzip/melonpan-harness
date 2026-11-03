import {
  ILLMProvider,
  GeminiProvider,
  OpenAICompatibleProvider,
  OpenRouterProvider,
  OrcaRouterProvider,
  GroqProvider,
  DEFAULT_MODEL_PRICING,
  USD_TO_JPY_RATE as CORE_USD_TO_JPY_RATE,
} from '@melonpan/core';
import { ProviderType } from '../types';

export interface ModelCatalogItem {
  id: string;
  provider: ProviderType;
  label: string;
  description: string;
  isFree?: boolean;
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
