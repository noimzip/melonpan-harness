import { AVAILABLE_MODELS } from '@melonpan/core';
import { CommandDefinition, CommandSuggestion } from '../types.js';

const MODEL_DESCRIPTIONS: Record<string, string> = {
  'gemini-3.5-flash-lite': 'Google: Ultra-lightweight and fastest response model',
  'gemini-3.8-flash': 'Google: Flagship high-speed multimodality & reasoning (default)',
  'gemini-4-argon': 'Google: Next-generation frontier reasoning model',
  'gemma-4-31b-it': 'Google: Open weights 31B instruction-tuned model',
  'opencode/beam-free': 'OpenCode: Ultra-fast coding model (Free tier)',
  'opencode/deepseek-v4.1-flash-free': 'OpenCode: High-performance open reasoning model (Free tier)',
  'opencode/space-bunny-free': 'OpenCode: Creative agent & code generation model (Free tier)',
  'opencode/mimo-v2.6-flash-free': 'OpenCode: Multilingual lightning coding model (Free tier)',
};

export const modelCommand: CommandDefinition = {
  name: 'model',
  syntax: '/model [name]',
  description: '利用可能なモデルの表示・切り替え (Gemini / OpenCode)',
  execute: (args, ctx) => {
    const targetModel = args[0]?.trim();

    if (!targetModel) {
      const isOpencode = ctx.model.startsWith('opencode/');
      const provider = isOpencode ? 'OpenCode' : 'Gemini';
      ctx.logActivity(`Active Model: ${ctx.model} (${provider})`);
      if (ctx.openPicker) {
        ctx.openPicker('model');
      }
      return;
    }

    const matched = AVAILABLE_MODELS.find(
      (m) => m.toLowerCase() === targetModel.toLowerCase()
    );

    if (matched) {
      const isOpencode = matched.startsWith('opencode/');
      const provider = isOpencode ? 'OpenCode' : 'Gemini';
      ctx.setModel(matched);
      ctx.logActivity(`Model switched to ${matched} (${provider})`);
      ctx.logThought(`✔ Active model changed to: [${provider}: ${matched}]`);
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
