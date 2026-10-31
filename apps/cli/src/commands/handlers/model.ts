import { AVAILABLE_MODELS } from '@melonpan/core';
import { CommandDefinition, CommandSuggestion } from '../types.js';

export interface ModelCatalogItem {
  id: string;
  provider: 'gemini' | 'openai' | 'anthropic' | 'local';
  label: string;
  description: string;
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
];

export const modelCommand: CommandDefinition = {
  name: 'model',
  syntax: '/model [name]',
  description: 'マルチプロバイダー対応モデルの表示・切り替え (Gemini, OpenAI, Anthropic, Local)',
  execute: (args, ctx) => {
    const targetModel = args[0]?.trim();

    if (!targetModel) {
      ctx.logActivity(`Active Model: ${ctx.model}`);
      if (ctx.openPicker) {
        ctx.openPicker('model');
      }
      return;
    }

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
    } else {
      ctx.setModel(targetModel);
      ctx.logActivity(`Model switched to custom: ${targetModel}`);
      ctx.logThought(`✔ Active model changed to custom model: ${targetModel}`);
    }
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

    // Incremental matching against all supported models across all providers
    return ALL_SUPPORTED_MODELS.filter(
      (m) => m.id.toLowerCase().includes(query) || m.provider.toLowerCase().includes(query)
    ).map((m) => ({
      text: `/model ${m.id}`,
      display: m.id,
      description: `[${m.provider}] ${m.description}`,
    }));
  },
};
