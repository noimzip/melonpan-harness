import { CommandDefinition, CommandSuggestion } from '../types.js';

export const permissionsCommand: CommandDefinition = {
  name: 'permissions',
  aliases: ['perm', 'policy'],
  syntax: '/permissions [auto|ask|strict]',
  description: 'ツール実行権限モードの確認・切り替え (auto / ask / strict)',
  execute: (args, ctx) => {
    const targetMode = args[0]?.trim().toLowerCase();

    if (!targetMode) {
      const policy = ctx.permissionPolicy;
      const allowedTools = policy?.getAlwaysAllowedTools?.() || [];
      const modeStr = (policy as any)?._mode || 'ask';

      const lines = [
        '🛡️ Permission Policy Status:',
        `  • Mode               : ${modeStr.toUpperCase()}`,
        `  • Always Allowed     : ${allowedTools.length > 0 ? allowedTools.join(', ') : '(none)'}`,
        '  • Available Modes    : auto (allow all safe), ask (prompt on write/exec), strict (deny dangerous)',
      ];

      ctx.logActivity(`Permission Policy: ${modeStr}`);
      for (const line of lines) {
        ctx.logThought(line);
      }
      return;
    }

    if (targetMode === 'auto' || targetMode === 'ask' || targetMode === 'strict') {
      const policy = ctx.permissionPolicy;
      if (policy) {
        (policy as any)._mode = targetMode;
        if (targetMode === 'auto') {
          policy.setCategoryRule?.('execute', 'allow');
          policy.setCategoryRule?.('write', 'allow');
          policy.setCategoryRule?.('network', 'allow');
        } else if (targetMode === 'ask') {
          policy.setCategoryRule?.('execute', 'ask');
          policy.setCategoryRule?.('write', 'ask');
          policy.setCategoryRule?.('network', 'ask');
        } else if (targetMode === 'strict') {
          policy.setCategoryRule?.('execute', 'deny');
          policy.setCategoryRule?.('write', 'ask');
          policy.setCategoryRule?.('network', 'ask');
        }
      }

      ctx.logActivity(`Permission mode set to "${targetMode}"`);
      ctx.logThought(`✔ Tool permission policy changed to: ${targetMode.toUpperCase()}`);
    } else {
      ctx.logActivity(`Unknown permission mode "${targetMode}". Valid options: auto, ask, strict`);
    }
  },
  getSuggestions: (input) => {
    const prefix = '/permissions ';
    if (!input.startsWith(prefix)) return [];
    const query = input.slice(prefix.length).trim().toLowerCase();

    const options = [
      {
        mode: 'ask',
        display: 'ask',
        description: 'Prompt interactive approval on execution and file write (default)',
      },
      {
        mode: 'auto',
        display: 'auto',
        description: 'Auto-allow non-destructive tools without prompting',
      },
      {
        mode: 'strict',
        display: 'strict',
        description: 'Block shell execution and prompt on file writes',
      },
    ];

    return options
      .filter((opt) => opt.mode.includes(query))
      .map((opt) => ({
        text: `/permissions ${opt.mode}`,
        display: opt.display,
        description: opt.description,
      }));
  },
};
