import { CommandDefinition } from '../types.js';
import { modelCommand } from './model.js';

export const boostCommand: CommandDefinition = {
  name: 'boost',
  aliases: ['model'],
  syntax: '/boost [name]',
  description:
    '各種API (OpenRouter, OrcaRouter, Groq, Surplus, Gemini, OpenAI, Anthropic) モデルの表示・検索・切り替え (/model 同等)',
  execute: (args, ctx) => modelCommand.execute(args, ctx),
  getSuggestions: (input, ctx) => modelCommand.getSuggestions?.(input, ctx) || [],
};
