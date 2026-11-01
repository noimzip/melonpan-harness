import { CommandDefinition, CommandContext, CommandSuggestion } from '../types.js';

/**
 * 10. /goal コマンドハンドラー
 *
 * フル自律目標達成モード (Goal Autonomous Pursuit Mode)
 * - サブエージェント（researcher, code-reviewer）を解禁
 * - Act -> Test -> Audit の自律ループを徹底的に回して目標を達成
 */
export const goalCommand: CommandDefinition = {
  name: 'goal',
  syntax: '/goal <objective>',
  description:
    'Execute autonomous goal pursuit (enables specialized subagents, deep implementation, testing, & audit)',
  aliases: ['g'],

  async execute(args: string[], ctx: CommandContext): Promise<void> {
    const objective = args.join(' ').trim();
    if (!objective) {
      ctx.setMode('goal');
      ctx.logActivity('🎯 Switched to [Goal Mode]. Subagents (researcher, code-reviewer) are now enabled.');
      ctx.logThought(
        'Goal Mode is active. Specialized subagents and multi-perspective audits are unlocked for subsequent prompts.'
      );
      return;
    }

    ctx.setMode('goal');
    ctx.logActivity(`🎯 Initiating autonomous goal pursuit: "${objective}"`);
    ctx.executePrompt(objective, 'goal');
  },

  getSuggestions(currentInput: string, _ctx: CommandContext): CommandSuggestion[] {
    const query = currentInput.replace(/^\/goal\s*/i, '').trim().toLowerCase();
    const presets = [
      {
        text: '/goal Build complete cyber block breaker arcade game with particle effects',
        display: '/goal [arcade game]',
        description: 'Autonomous end-to-end game creation with subagent review & testing',
      },
      {
        text: '/goal Implement responsive touch controls and audio synthesized sound effects',
        display: '/goal [touch & audio]',
        description: 'Multi-device responsive controls with Web Audio polish',
      },
      {
        text: '/goal Audit performance and eliminate garbage collection bottlenecks in animation loop',
        display: '/goal [audit & optimize]',
        description: 'Deep audit and 60fps performance optimization',
      },
    ];

    if (!query) {
      return presets;
    }

    return presets.filter(
      (p) =>
        p.text.toLowerCase().includes(query) ||
        p.description.toLowerCase().includes(query)
    );
  },
};
