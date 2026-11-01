export interface WebToolCall {
  id: string;
  name: string;
  args: Record<string, any>;
  result?: any;
  status: 'running' | 'success' | 'error' | 'denied';
  diff?: {
    path?: string;
    oldContent?: string;
    newContent?: string;
    unifiedDiff?: string;
  };
  durationMs?: number;
  stdout?: string;
  stderr?: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  thought?: string;
  isStreaming?: boolean;
  toolCalls?: WebToolCall[];
  timestamp: number;
}

export interface PlanTask {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export interface PlanState {
  rawMarkdown: string;
  status: 'draft' | 'pending_review' | 'approved' | 'rejected';
  tasks: PlanTask[];
  feedback?: string;
}

export interface PermissionRequest {
  id: string;
  toolName: string;
  args: Record<string, any>;
  category: 'read' | 'write' | 'command' | 'web';
  details: string;
  diffPreview?: string;
  commandString?: string;
  filePath?: string;
  resolve: (decision: 'allow_once' | 'always_allow' | 'deny') => void;
}

export interface SubagentTrace {
  id: string;
  agentName: string;
  role: string;
  taskPrompt: string;
  thoughts: string[];
  toolCalls: WebToolCall[];
  verdict?: 'PASS' | 'WARN' | 'FAIL' | string;
  report?: string;
  tokens: {
    input: number;
    output: number;
    total: number;
  };
  durationMs: number;
  status: 'running' | 'completed' | 'failed';
}

export interface SkillInfo {
  name: string;
  description: string;
  enabled: boolean;
  metadata?: Record<string, any>;
  body?: string;
}

export interface ContextMetrics {
  billedInputTokens: number;
  billedOutputTokens: number;
  cachedTokens: number;
  totalTokens: number;
  contextWindowLimit: number;
  currentContextTokens: number;
  prunedChars: number;
  compactionCount: number;
  compactionLogs: string[];
}

export interface Session {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  mode: 'auto' | 'plan' | 'act';
  messages: Message[];
  files: Record<string, string>;
  activeFile: string;
  plan?: PlanState;
  subagents: SubagentTrace[];
  metrics: ContextMetrics;
}

export type ProviderType =
  | 'gemini'
  | 'openai'
  | 'anthropic'
  | 'openrouter'
  | 'orcarouter'
  | 'groq'
  | 'bridge';

export interface ProviderConfig {
  provider: ProviderType;
  model: string;
  apiKey: string;
  baseUrl: string;
  thinkingEffort: 'minimal' | 'low' | 'medium' | 'high';
  bridgeUrl: string;
}

export interface CommandSuggestion {
  text: string;
  display: string;
  description: string;
}

export interface PermissionPolicyConfig {
  read: 'allow' | 'ask' | 'deny';
  write: 'allow' | 'ask' | 'deny';
  command: 'allow' | 'ask' | 'deny';
  web: 'allow' | 'ask' | 'deny';
}
