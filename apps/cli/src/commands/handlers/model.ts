import { AVAILABLE_MODELS } from '@melonpan/core';
import { CommandDefinition, CommandSuggestion } from '../types.js';

const MODEL_DESCRIPTIONS: Record<string, string> = {
  'gemini-3.5-flash-lite': 'Ultra-lightweight and fastest response model',
  'gemini-3.8-flash': 'Flagship high-speed multimodality & reasoning (default)',
  'gemini-4-argon': 'Next-generation frontier reasoning model',
  'gemma-4-31b-it': 'Open weights 31B instruction-tuned model',
};

export const modelCommand: CommandDefinition = {
  name: 'model',
  syntax: '/model [name]',
  description: '利用可能なモデルの表示・切り替え (gemini-3.8-flash 等)',
  execute: (args, ctx) => {
    const targetModel = args[0]?.trim();

    if (!targetModel) {
      ctx.logActivity(`Active Model: ${ctx.model}`);
      if (ctx.openPicker) {
        ctx.openPicker('model');
      }
      return;
    }

    const matched = AVAILABLE_MODELS.find(
      (m) => m.toLowerCase() === targetModel.toLowerCase()
    );

    if (matched) {
      ctx.setModel(matched);
      ctx.logActivity(`Model switched to ${matched}`);
      ctx.logThought(`✔ Active model changed to: ${matched}`);
    } else {
      ctx.logActivity(
        `Unknown model "${targetModel}". Available models: ${AVAILABLE_MODELS.join(', ')}`
      );
    }
  },
  getSuggestions: (input) => {
    const prefix = '/model ';
    if (!input.startsWith(prefix)) return [];
    const query = input.slice(prefix.length).trim().toLowerCase();

    return AVAILABLE_MODELS.filter((m) => m.toLowerCase().includes(query)).map(
      (m) => ({
        text: `/model ${m}`,
        display: m,
        description: MODEL_DESCRIPTIONS[m] || 'AI Model',
      })
    );
  },
};
