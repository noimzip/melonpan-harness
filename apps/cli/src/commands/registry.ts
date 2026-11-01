import { CommandDefinition, CommandContext, CommandSuggestion } from './types.js';
import { modelCommand } from './handlers/model.js';
import { effortCommand } from './handlers/effort.js';
import { planCommand } from './handlers/plan.js';
import { clearCommand } from './handlers/clear.js';
import { exportCommand } from './handlers/export.js';
import { helpCommand } from './handlers/help.js';
import { skillsCommand } from './handlers/skills.js';
import { costCommand } from './handlers/cost.js';
import { keyCommand } from './handlers/key.js';
import { permissionsCommand } from './handlers/permissions.js';
import { agentsCommand } from './handlers/agents.js';
import { compactCommand } from './handlers/compact.js';
import { goalCommand } from './handlers/goal.js';

export class CommandRegistry {
  private commands: Map<string, CommandDefinition> = new Map();

  constructor(includeExtended = false) {
    this.register(modelCommand);
    this.register(effortCommand);
    this.register(planCommand);
    this.register(goalCommand);
    this.register(clearCommand);
    this.register(exportCommand);
    this.register(helpCommand);
    this.register(skillsCommand);
    this.register(costCommand);
    this.register(keyCommand);

    if (includeExtended) {
      this.register(permissionsCommand);
      this.register(agentsCommand);
      this.register(compactCommand);
    }
  }

  register(command: CommandDefinition): void {
    this.commands.set(command.name.toLowerCase(), command);
    if (command.aliases) {
      for (const alias of command.aliases) {
        this.commands.set(alias.toLowerCase(), command);
      }
    }
  }

  getCommand(name: string): CommandDefinition | undefined {
    return this.commands.get(name.toLowerCase());
  }

  getAllCommands(): CommandDefinition[] {
    const unique = new Set<CommandDefinition>(this.commands.values());
    return Array.from(unique);
  }

  /**
   * Dispatches command if rawInput starts with '/'.
   * Returns true if treated as a slash command (preventing core ReAct agent execution).
   */
  async executeCommand(rawInput: string, ctx: CommandContext): Promise<boolean> {
    const trimmed = rawInput.trim();
    if (!trimmed.startsWith('/')) {
      return false;
    }

    const withoutSlash = trimmed.slice(1);
    const parts = withoutSlash.split(/\s+/);
    const commandName = parts[0]?.toLowerCase();
    const args = parts.slice(1);

    if (!commandName) {
      return true;
    }

    const command = this.getCommand(commandName);
    if (!command) {
      ctx.logActivity(`Unknown command "/${commandName}". Type /help for available commands.`);
      ctx.logThought(`❓ Unknown command: "/${commandName}". Type /help to see available commands.`);
      return true;
    }

    try {
      await command.execute(args, ctx);
    } catch (err: any) {
      ctx.logActivity(`Error executing /${commandName}: ${err.message}`);
      ctx.logThought(`❌ Error executing /${commandName}: ${err.message}`);
    }

    return true;
  }

  /**
   * Computes autocomplete suggestions based on the current input string.
   */
  getAutocompleteSuggestions(input: string, ctx: CommandContext): CommandSuggestion[] {
    if (!input.startsWith('/')) {
      return [];
    }

    const trimmedLeading = input.trimStart();
    const parts = trimmedLeading.slice(1).split(/\s+/);
    const hasSpace = trimmedLeading.includes(' ');

    // Case 1: User is typing the slash command itself (e.g., "/", "/m", "/model", "/b", "/boost")
    if (!hasSpace) {
      const prefix = trimmedLeading.toLowerCase();
      const all = this.getAllCommands();
      const takesArgsCommands = new Set([
        'model',
        'boost',
        'effort',
        'plan',
        'export',
        'skills',
        'key',
        'permissions',
        'agents',
        'compact',
      ]);

      const results: CommandSuggestion[] = [];
      const seen = new Set<string>();

      for (const cmd of all) {
        const cmdName = cmd.name.toLowerCase();
        if (`/${cmdName}`.startsWith(prefix)) {
          const takesArgs = takesArgsCommands.has(cmdName);
          results.push({
            text: takesArgs ? `/${cmd.name} ` : `/${cmd.name}`,
            display: `/${cmd.name}`,
            description: cmd.description,
          });
          seen.add(cmdName);
        }

        // When user types beyond "/" (e.g., "/b", "/boost"), also check aliases
        if (prefix !== '/' && cmd.aliases) {
          for (const alias of cmd.aliases) {
            const aliasLower = alias.toLowerCase();
            if (`/${aliasLower}`.startsWith(prefix) && !seen.has(aliasLower)) {
              const takesArgs = takesArgsCommands.has(aliasLower) || takesArgsCommands.has(cmdName);
              results.push({
                text: takesArgs ? `/${alias} ` : `/${alias}`,
                display: `/${alias}`,
                description: `(${cmd.name}) ${cmd.description}`,
              });
              seen.add(aliasLower);
            }
          }
        }
      }

      return results;
    }

    // Case 2: User typed command name followed by a space (e.g., "/model ", "/effort low", "/permissions auto")
    const cmdName = parts[0]?.toLowerCase();
    const command = this.getCommand(cmdName);
    if (command && command.getSuggestions) {
      return command.getSuggestions(input, ctx);
    }

    return [];
  }
}

export const commandRegistry = new CommandRegistry(false);
export const extendedCommandRegistry = new CommandRegistry(true);
