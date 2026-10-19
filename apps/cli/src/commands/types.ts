import { VirtualFS, SkillManager } from '@melonpan/core';

export interface SessionUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface CommandContext {
  // Model & Effort
  model: string;
  setModel: (model: string) => void;
  effort: string;
  setEffort: (effort: string) => void;

  // API Key & Simulation
  apiKey?: string;
  setApiKey?: (key: string) => void;
  isSimulate?: boolean;
  setSimulate?: (simulate: boolean) => void;

  // Mode & Execution
  mode: 'plan' | 'act' | 'auto';
  setMode: (mode: 'plan' | 'act' | 'auto') => void;
  executePrompt: (prompt: string, overrideMode?: 'plan' | 'act' | 'auto') => void;

  // Session & UI
  clearSession: () => void;
  logActivity: (message: string) => void;
  logThought: (message: string) => void;
  openPicker?: (type: 'model' | 'effort') => void;

  // VFS & Skills
  vfs: VirtualFS;
  skillManager: SkillManager;

  // Token usage & Cost tracking
  sessionUsage: SessionUsage;
}

export interface CommandSuggestion {
  text: string; // The completion replacement string, e.g. "/model gemini-4-argon"
  display: string; // Display label in suggestion list
  description: string; // Brief description of what this option does
}

export interface CommandDefinition {
  name: string;
  aliases?: string[];
  syntax: string;
  description: string;
  execute: (args: string[], ctx: CommandContext) => Promise<void> | void;
  getSuggestions?: (currentInput: string, ctx: CommandContext) => CommandSuggestion[];
}
