import { CommandDefinition } from '../types.js';

export const planCommand: CommandDefinition = {
  name: 'plan',
  syntax: '/plan [prompt]',
  description: 'Plan Mode のトグル切り替え、または指定プロンプトで Plan Mode 即時実行',
  execute: (args, ctx) => {
    const prompt = args.join(' ').trim();

    if (prompt.length > 0) {
      // Prompt provided: execute directly in Plan Mode
      ctx.logActivity(`Executing prompt in Plan Mode: "${prompt}"`);
      ctx.executePrompt(prompt, 'plan');
      return;
    }

    // Toggle Plan Mode ON / OFF
    if (ctx.mode === 'plan') {
      ctx.setMode('auto');
      ctx.logActivity('Plan Mode toggled OFF (Switched to AUTO mode)');
      ctx.logThought('💡 Mode switched to AUTO (Plan -> Act -> Audit)');
    } else {
      ctx.setMode('plan');
      ctx.logActivity('Plan Mode toggled ON (Switched to PLAN mode)');
      ctx.logThought('💡 Mode switched to PLAN (Requirements analysis & plan.md generation only)');
    }
  },
  getSuggestions: (input) => {
    const prefix = '/plan ';
    if (!input.startsWith(prefix)) return [];
    return [
      {
        text: '/plan ',
        display: '<prompt>',
        description: '指定したプロンプトで計画書作成フェーズを即時実行',
      },
    ];
  },
};
