import { CommandDefinition, CommandSuggestion } from '../types.js';

interface SubagentMeta {
  name: string;
  description: string;
  tools: string[];
  readonly: boolean;
}

const DEFAULT_AGENTS: SubagentMeta[] = [
  {
    name: 'coder',
    description: 'Focused implementation worker capable of editing and writing code',
    tools: ['read_file', 'list_files', 'grep_search', 'write_file', 'edit_file', 'run_command', 'complete_task'],
    readonly: false,
  },
  {
    name: 'researcher',
    description: 'Read-only research and exploration subagent for files and web',
    tools: ['read_file', 'list_files', 'grep_search', 'web_search', 'fetch_url', 'complete_task'],
    readonly: true,
  },
  {
    name: 'code-reviewer',
    description: 'Read-only code auditor and quality reviewer',
    tools: ['read_file', 'list_files', 'grep_search', 'complete_task'],
    readonly: true,
  },
];

export const agentsCommand: CommandDefinition = {
  name: 'agents',
  syntax: '/agents [name]',
  description: '利用可能なサブエージェント（agents/*.md）と許可ツール一覧を表示',
  execute: (args, ctx) => {
    const targetName = args[0]?.trim().toLowerCase();

    if (targetName) {
      const found = DEFAULT_AGENTS.find((a) => a.name.toLowerCase() === targetName);
      if (found) {
        const lines = [
          `🤖 Subagent Specification: [${found.name}]`,
          `  • Description  : ${found.description}`,
          `  • Access Mode  : ${found.readonly ? 'Read-Only (Isolated)' : 'Read-Write (Workspace)'}`,
          `  • Allowed Tools: ${found.tools.join(', ')}`,
        ];
        ctx.logActivity(`Subagent: ${found.name}`);
        for (const line of lines) {
          ctx.logThought(line);
        }
      } else {
        ctx.logActivity(`Unknown subagent "${targetName}". Available: ${DEFAULT_AGENTS.map((a) => a.name).join(', ')}`);
      }
      return;
    }

    const lines = [
      '🤖 Registered Clean-Room Subagents (agents/*.md):',
      ...DEFAULT_AGENTS.map(
        (a) => `  • [${a.name}] ${a.description} (${a.readonly ? 'read-only' : 'read-write'})`
      ),
      '  ───────────────────────────────────────────',
      '  • Usage: /agents <name> for detailed allowed tools and permissions',
    ];

    ctx.logActivity(`Registered Subagents: ${DEFAULT_AGENTS.length} agents`);
    for (const line of lines) {
      ctx.logThought(line);
    }
  },
  getSuggestions: (input) => {
    const prefix = '/agents ';
    if (!input.startsWith(prefix)) return [];
    const query = input.slice(prefix.length).trim().toLowerCase();

    return DEFAULT_AGENTS.filter((a) => a.name.includes(query)).map((a) => ({
      text: `/agents ${a.name}`,
      display: a.name,
      description: a.description,
    }));
  },
};
