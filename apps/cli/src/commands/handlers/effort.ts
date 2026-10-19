import { THINKING_LEVELS } from '@melonpan/core';
import { CommandDefinition } from '../types.js';

const EFFORT_DESCRIPTIONS: Record<string, string> = {
  minimal: 'Minimal thinking tokens (fastest execution)',
  low: 'Low reasoning effort (concise thoughts)',
  medium: 'Medium reasoning effort (balanced exploration)',
  high: 'High reasoning effort (deep architectural reasoning, default)',
};

export const effortCommand: CommandDefinition = {
  name: 'effort',
  syntax: '/effort [level]',
  description: '推論レベル (Thinking Level) の深さを制御 (minimal, low, medium, high)',
  execute: (args, ctx) => {
    const targetLevel = args[0]?.trim();

    if (!targetLevel) {
      ctx.logActivity(`Active Thinking Level (Effort): ${ctx.effort}`);
      if (ctx.openPicker) {
        ctx.openPicker('effort');
      }
      return;
    }

    const matched = THINKING_LEVELS.find(
      (l) => l.toLowerCase() === targetLevel.toLowerCase()
    );

    if (matched) {
      ctx.setEffort(matched);
      ctx.logActivity(`Thinking level switched to ${matched}`);
      ctx.logThought(`✔ Thinking level (effort) changed to: ${matched}`);
    } else {
      ctx.logActivity(
        `Unknown effort level "${targetLevel}". Available: ${THINKING_LEVELS.join(', ')}`
      );
    }
  },
  getSuggestions: (input) => {
    const prefix = '/effort ';
    if (!input.startsWith(prefix)) return [];
    const query = input.slice(prefix.length).trim().toLowerCase();

    return THINKING_LEVELS.filter((l) => l.toLowerCase().includes(query)).map(
      (l) => ({
        text: `/effort ${l}`,
        display: l,
        description: EFFORT_DESCRIPTIONS[l] || 'Thinking level',
      })
    );
  },
};
