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

export class CommandRegistry {
  private commands: Map<string, CommandDefinition> = new Map();

  constructor() {
    this.register(modelCommand);
    this.register(effortCommand);
    this.register(planCommand);
    this.register(clearCommand);
    this.register(exportCommand);
    this.register(helpCommand);
    this.register(skillsCommand);
    this.register(costCommand);
    this.register(keyCommand);
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

    // Case 1: User is typing the slash command itself (e.g., "/", "/m", "/model")
    if (!hasSpace) {
      const prefix = trimmedLeading.toLowerCase();
      const all = this.getAllCommands();
      return all
        .filter((cmd) => `/${cmd.name.toLowerCase()}`.startsWith(prefix))
        .map((cmd) => {
          // If the command takes arguments (model, effort, plan, export, skills, key), add trailing space to hint sub-arg completion
          const takesArgs = ['model', 'effort', 'plan', 'export', 'skills', 'key'].includes(cmd.name);
          return {
            text: takesArgs ? `/${cmd.name} ` : `/${cmd.name}`,
            display: `/${cmd.name}`,
            description: cmd.description,
          };
        });
    }

    // Case 2: User typed command name followed by a space (e.g., "/model ", "/effort low", "/skills enable ")
    const cmdName = parts[0]?.toLowerCase();
    const command = this.getCommand(cmdName);
    if (command && command.getSuggestions) {
      return command.getSuggestions(input, ctx);
    }

    return [];
  }
}

export const commandRegistry = new CommandRegistry();
