import { VirtualFS, SkillManager, IFileSystem, MelonpanCore } from '@melonpan/core';

export interface SessionUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  billedPromptTokens?: number;
  rawPromptTokens?: number;
  cachedPromptTokens?: number;
  contextWindowTokens?: number;
  maxContextTokens?: number;
  savedTokens?: number;
}

export interface CommandContext {
  // Model & Provider & Effort
  model: string;
  setModel: (model: string) => void;
  provider?: string;
  setProvider?: (provider: string) => void;
  effort: string;
  setEffort: (effort: string) => void;

  // API Key & Simulation
  apiKey?: string;
  setApiKey?: (key: string) => void;
  isSimulate?: boolean;
  setSimulate?: (simulate: boolean) => void;
  refreshModels?: () => Promise<void>;

  // Mode & Execution
  mode: 'plan' | 'act' | 'auto' | 'goal';
  setMode: (mode: 'plan' | 'act' | 'auto' | 'goal') => void;
  executePrompt: (prompt: string, overrideMode?: 'plan' | 'act' | 'auto' | 'goal') => void;

  // Session & UI
  clearSession: () => void;
  logActivity: (message: string) => void;
  logThought: (message: string) => void;
  openPicker?: (type: 'model' | 'effort' | 'key') => void;

  // VFS & Skills & Runtime Core
  vfs: VirtualFS | IFileSystem;
  skillManager: SkillManager;
  core?: MelonpanCore;
  fsMode?: 'vfs' | 'disk';

  // Token usage & Cost tracking
  sessionUsage: SessionUsage;

  // Permission & Compaction (#33, #35)
  permissionPolicy?: any;
  compactSession?: (instructions?: string) => Promise<void>;
  cancelTask?: () => void;
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
