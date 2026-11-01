import { AVAILABLE_MODELS } from '@melonpan/core';
import { CommandDefinition, CommandSuggestion } from '../types.js';

export interface ModelCatalogItem {
  id: string;
  provider:
    | 'gemini'
    | 'openai'
    | 'anthropic'
    | 'openrouter'
    | 'orcarouter'
    | 'groq'
    | 'local'
    | string;
  label: string;
  description: string;
  isFree?: boolean;
}

const MODEL_DESCRIPTIONS: Record<string, string> = {
  'gemini-3.5-flash-lite': 'Ultra-lightweight and fastest response model',
  'gemini-3.8-flash': 'Flagship high-speed multimodality & reasoning (default)',
  'gemini-4-argon': 'Next-generation frontier reasoning model',
  'gemma-4-31b-it': 'Open weights 31B instruction-tuned model',
};

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
  // OpenAI & Local LLM
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
  // OpenRouter (Free tier models prioritized)
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
  {
    id: 'google/gemini-2.0-flash-exp:free',
    provider: 'openrouter',
    label: 'google/gemini-2.0-flash-exp:free',
    description: 'Experimental next-gen Gemini (OpenRouter Free)',
    isFree: true,
  },
  // OrcaRouter (Free tier models prioritized)
  {
    id: 'orcarouter/deepseek/deepseek-v4-flash-free',
    provider: 'orcarouter',
    label: 'orcarouter/deepseek/deepseek-v4-flash-free',
    description: 'High-speed reasoning model (OrcaRouter Free)',
    isFree: true,
  },
  {
    id: 'orcarouter/deepseek/deepseek-chat',
    provider: 'orcarouter',
    label: 'orcarouter/deepseek/deepseek-chat',
    description: 'General intelligence model (OrcaRouter)',
    isFree: false,
  },
  // Groq
  {
    id: 'llama-3.3-70b-versatile',
    provider: 'groq',
    label: 'llama-3.3-70b-versatile',
    description: 'Ultra-fast LPU inference (Groq)',
  },
  {
    id: 'llama-3.1-8b-instant',
    provider: 'groq',
    label: 'llama-3.1-8b-instant',
    description: 'Instant speed lightweight model (Groq)',
  },
  {
    id: 'mixtral-8x7b-32768',
    provider: 'groq',
    label: 'mixtral-8x7b-32768',
    description: 'High-throughput MoE model (Groq)',
  },
];

// 動的にAPIから取得されたモデルのキャッシュ
let dynamicDiscoveredModels: ModelCatalogItem[] = [];

export function setDynamicDiscoveredModels(models: ModelCatalogItem[]): void {
  dynamicDiscoveredModels = models;
}

export function getDynamicDiscoveredModels(): ModelCatalogItem[] {
  return dynamicDiscoveredModels;
}

export const modelCommand: CommandDefinition = {
  name: 'model',
  syntax: '/model [name]',
  description:
    'マルチプロバイダー対応モデルの表示・切り替え (Gemini, OpenAI, Anthropic, OpenRouter, OrcaRouter, Groq)',
  execute: (args, ctx) => {
    const targetModel = args[0]?.trim();

    if (!targetModel) {
      ctx.logActivity(`Active Model: ${ctx.model}`);
      if (ctx.openPicker) {
        ctx.openPicker('model');
      }
      return;
    }

    // 1. 動的取得済みモデルから検索
    const foundDynamic = dynamicDiscoveredModels.find(
      (m) => m.id.toLowerCase() === targetModel.toLowerCase()
    );
    if (foundDynamic) {
      ctx.setModel(foundDynamic.id);
      if (ctx.setProvider) {
        ctx.setProvider(foundDynamic.provider);
      }
      ctx.logActivity(`Model switched to ${foundDynamic.id}`);
      ctx.logThought(`✔ Active model changed to: ${foundDynamic.id} (${foundDynamic.provider})`);
      return;
    }

    // 2. 標準 Gemini モデルの照合
    const matchedAvailable = AVAILABLE_MODELS.find(
      (m) => m.toLowerCase() === targetModel.toLowerCase()
    );

    if (matchedAvailable) {
      ctx.setModel(matchedAvailable);
      if (ctx.setProvider) {
        ctx.setProvider('gemini');
      }
      ctx.logActivity(`Model switched to ${matchedAvailable}`);
      ctx.logThought(`✔ Active model changed to: ${matchedAvailable}`);
      return;
    }

    // 3. 全静的サポートモデルからの照合
    const found = ALL_SUPPORTED_MODELS.find(
      (m) => m.id.toLowerCase() === targetModel.toLowerCase()
    );

    if (found) {
      ctx.setModel(found.id);
      if (ctx.setProvider) {
        ctx.setProvider(found.provider);
      }
      ctx.logActivity(`Model switched to ${found.id}`);
      ctx.logThought(`✔ Active model changed to: ${found.id} (${found.provider})`);
      return;
    }

    // 4. 接頭辞ベースのルーティング推論
    let inferredProvider = 'custom';
    if (targetModel.startsWith('openrouter/')) {
      inferredProvider = 'openrouter';
    } else if (targetModel.startsWith('orcarouter/')) {
      inferredProvider = 'orcarouter';
    } else if (targetModel.startsWith('groq/')) {
      inferredProvider = 'groq';
    } else if (
      targetModel.startsWith('gpt-') ||
      targetModel.startsWith('o1-') ||
      targetModel.startsWith('o3-') ||
      targetModel.startsWith('chatgpt-')
    ) {
      inferredProvider = 'openai';
    } else if (targetModel.startsWith('claude-')) {
      inferredProvider = 'anthropic';
    } else if (targetModel.startsWith('gemini') || targetModel.startsWith('gemma')) {
      inferredProvider = 'gemini';
    }

    ctx.setModel(targetModel);
    if (ctx.setProvider && inferredProvider !== 'custom') {
      ctx.setProvider(inferredProvider);
    }
    ctx.logActivity(`Model switched to: ${targetModel}`);
    ctx.logThought(`✔ Active model changed to: ${targetModel} (${inferredProvider})`);
  },
  getSuggestions: (input) => {
    const prefix = '/model ';
    if (!input.startsWith(prefix)) return [];
    const query = input.slice(prefix.length).trim().toLowerCase();

    // Default to the 4 standard Gemini models for empty query
    if (!query) {
      return AVAILABLE_MODELS.map((m) => ({
        text: `/model ${m}`,
        display: m,
        description: MODEL_DESCRIPTIONS[m] || 'AI Model',
      }));
    }

    // 候補リストの作成 (動的取得モデル + 静的モデル)
    const combinedModels: ModelCatalogItem[] = [
      ...dynamicDiscoveredModels,
      ...ALL_SUPPORTED_MODELS.filter(
        (s) => !dynamicDiscoveredModels.some((d) => d.id === s.id)
      ),
    ];

    // クエリでフィルタリングし、無料モデルを最上位にソート (要件: 無料のモデルには右端に free と記述し、最上位に表示)
    const matched = combinedModels.filter(
      (m) =>
        m.id.toLowerCase().includes(query) ||
        m.provider.toLowerCase().includes(query) ||
        (m.isFree && 'free'.includes(query))
    );

    const freeList = matched.filter((m) => m.isFree);
    const nonFreeList = matched.filter((m) => !m.isFree);
    const sorted = [...freeList, ...nonFreeList];

    return sorted.map((m) => ({
      text: `/model ${m.id}`,
      display: m.id,
      description: `[${m.provider}]${m.isFree ? ' [free]' : ''} ${m.description}`,
    }));
  },
};

