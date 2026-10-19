import { CommandDefinition, CommandSuggestion } from '../types.js';

export const skillsCommand: CommandDefinition = {
  name: 'skills',
  syntax: '/skills [list | enable <name> | disable <name>]',
  description: 'Agent Skills の一覧確認および有効化・無効化の切り替え',
  execute: (args, ctx) => {
    const sub = args[0]?.toLowerCase();
    const skillName = args[1]?.trim();

    if (!sub || sub === 'list') {
      const skills = ctx.skillManager.getSkillsStatus();
      ctx.logActivity(`Loaded ${skills.length} skills.`);
      ctx.logThought(`📦 Registered Agent Skills (${skills.length}):`);
      for (const s of skills) {
        const badge = s.enabled ? '🟢 [ENABLED] ' : '🔴 [DISABLED]';
        ctx.logThought(`  ${badge} ${s.name}: ${s.description.slice(0, 60)}...`);
      }
      return;
    }

    if (sub === 'enable') {
      if (!skillName) {
        ctx.logActivity('Usage: /skills enable <name>');
        return;
      }
      const ok = ctx.skillManager.enableSkill(skillName);
      if (ok) {
        ctx.logActivity(`Skill "${skillName}" enabled.`);
        ctx.logThought(`🟢 Enabled skill: ${skillName}`);
      } else {
        ctx.logActivity(`Skill "${skillName}" not found.`);
      }
      return;
    }

    if (sub === 'disable') {
      if (!skillName) {
        ctx.logActivity('Usage: /skills disable <name>');
        return;
      }
      const ok = ctx.skillManager.disableSkill(skillName);
      if (ok) {
        ctx.logActivity(`Skill "${skillName}" disabled.`);
        ctx.logThought(`🔴 Disabled skill: ${skillName}`);
      } else {
        ctx.logActivity(`Skill "${skillName}" not found.`);
      }
      return;
    }

    ctx.logActivity(`Unknown subcommand "${sub}". Use: /skills [list | enable <name> | disable <name>]`);
  },
  getSuggestions: (input, ctx) => {
    const prefix = '/skills ';
    if (!input.startsWith(prefix)) return [];
    const remainder = input.slice(prefix.length).trimStart();

    // Suggest subcommands
    if (!remainder.includes(' ')) {
      const subs = [
        { text: '/skills list', display: 'list', description: '全スキルの一覧と状態を表示' },
        { text: '/skills enable ', display: 'enable <name>', description: '指定スキルを有効化' },
        { text: '/skills disable ', display: 'disable <name>', description: '指定スキルを無効化' },
      ];
      return subs.filter((s) => s.display.startsWith(remainder.toLowerCase()));
    }

    // Subcommand argument suggestions (skill names)
    if (remainder.startsWith('enable ') || remainder.startsWith('disable ')) {
      const parts = remainder.split(/\s+/);
      const action = parts[0];
      const query = (parts[1] || '').toLowerCase();
      const skills = ctx.skillManager.getIndexedSkills();

      return skills
        .filter((s) => s.name.toLowerCase().includes(query))
        .map((s) => ({
          text: `/skills ${action} ${s.name}`,
          display: s.name,
          description: s.description.slice(0, 50) + '...',
        }));
    }

    return [];
  },
};
