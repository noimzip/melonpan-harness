/**
 * @melonpan/core 共通型定義
 * Agent Skills標準仕様 (agentskills.io) & ReAct自律エージェント対応
 */

// ----------------------------------------------------
// Agent Skills Standard Specification (agentskills.io)
// ----------------------------------------------------

export interface SkillFrontmatter {
  /** 一意なスキル識別子 (英小文字、数字、ハイフンのみ、最大64文字、親ディレクトリ名と一致) */
  name: string;
  /** スキルの機能概要およびエージェントが利用すべき条件 (必須、最大1024文字) */
  description: string;
  /** ライセンス名 (任意) */
  license?: string;
  /** 動作要件・互換性情報 (任意) */
  compatibility?: string;
  /** 任意のキーバリューメタデータ (任意) */
  metadata?: Record<string, string>;
  /** 許可されたツール一覧 (任意) */
  'allowed-tools'?: string;
}

export interface SkillMetadata {
  name: string;
  description: string;
  skillDir: string;
  filePath: string;
  frontmatter: SkillFrontmatter;
}

export interface LoadedSkill extends SkillMetadata {
  /** SKILL.md の Markdown本文（エージェントへの詳細指示・規約） */
  instruction: string;
}

// ----------------------------------------------------
// Agent Events (ストリーミング駆動型ライフサイクル)
// ----------------------------------------------------

export type AgentEventType =
  | 'SKILL_INDEXED'       // 起動時の全スキルメタデータ軽量インデックス完了
  | 'SKILL_LOADED'        // 該当スキルの本文遅延ロード完了 (Progressive Disclosure)
  | 'PLAN_STARTED'        // 計画策定フェーズの開始 (Plan Mode)
  | 'PLAN_CREATED'        // 計画書の生成完了 (VFS: plan.md)
  | 'THOUGHT'             // エージェントの思考・推論ステップ (Thought)
  | 'TOOL_CALL'           // ツール実行要求 (Action)
  | 'SUBAGENT_DISPATCHED' // サブエージェントへの委譲開始 (Clean-Room Isolation)
  | 'SUBAGENT_COMPLETED'  // サブエージェントの処理完了と報告受領
  | 'TOOL_RESULT'         // ツール実行結果 (Observation)
  | 'FILE_CHANGED'        // VFS上のファイル変更 (write, edit)
  | 'COMPLETE'            // タスク完了宣言と全成果物VFS
  | 'ERROR';              // エラー

export interface SkillIndexedPayload {
  skills: Array<{ name: string; description: string; path: string }>;
  count: number;
}

export interface SkillLoadedPayload {
  name: string;
  description: string;
  filePath: string;
  instructionPreview: string;
}

export interface PlanStartedPayload {
  mode: 'plan' | 'auto';
  prompt: string;
}

export interface PlanCreatedPayload {
  plan: string;
  path: string;
}

export interface ThoughtPayload {
  thought: string;
}

export interface ToolCallPayload {
  name: string;
  args: Record<string, any>;
  callId?: string;
}

export interface SubagentDispatchedPayload {
  agentType: 'researcher' | 'code-reviewer' | string;
  taskPrompt: string;
  callId?: string;
}

export interface SubagentCompletedPayload {
  agentType: 'researcher' | 'code-reviewer' | string;
  result: string;
  durationMs: number;
  callId?: string;
}

export interface ToolResultPayload {
  name: string;
  result: string;
  isError?: boolean;
  callId?: string;
}

export interface FileChangedPayload {
  path: string;
  action: 'write' | 'edit';
  size: number;
  diffSummary?: string;
}

export interface CompletePayload {
  summary: string;
  files: Record<string, string>;
  turns: number;
  durationMs: number;
}

export interface ErrorPayload {
  error: Error | string;
  phase: 'indexing' | 'resolution' | 'react_loop' | 'subagent' | 'execution';
}

export interface AgentEvent<T = any> {
  type: AgentEventType;
  payload: T;
  timestamp: number;
}

export type SkillIndexedEvent = AgentEvent<SkillIndexedPayload> & { type: 'SKILL_INDEXED' };
export type SkillLoadedEvent = AgentEvent<SkillLoadedPayload> & { type: 'SKILL_LOADED' };
export type PlanStartedEvent = AgentEvent<PlanStartedPayload> & { type: 'PLAN_STARTED' };
export type PlanCreatedEvent = AgentEvent<PlanCreatedPayload> & { type: 'PLAN_CREATED' };
export type ThoughtEvent = AgentEvent<ThoughtPayload> & { type: 'THOUGHT' };
export type ToolCallEvent = AgentEvent<ToolCallPayload> & { type: 'TOOL_CALL' };
export type SubagentDispatchedEvent = AgentEvent<SubagentDispatchedPayload> & {
  type: 'SUBAGENT_DISPATCHED';
};
export type SubagentCompletedEvent = AgentEvent<SubagentCompletedPayload> & {
  type: 'SUBAGENT_COMPLETED';
};
export type ToolResultEvent = AgentEvent<ToolResultPayload> & { type: 'TOOL_RESULT' };
export type FileChangedEvent = AgentEvent<FileChangedPayload> & { type: 'FILE_CHANGED' };
export type CompleteEvent = AgentEvent<CompletePayload> & { type: 'COMPLETE' };
export type ErrorEvent = AgentEvent<ErrorPayload> & { type: 'ERROR' };

export type MelonpanEvent =
  | SkillIndexedEvent
  | SkillLoadedEvent
  | PlanStartedEvent
  | PlanCreatedEvent
  | ThoughtEvent
  | ToolCallEvent
  | SubagentDispatchedEvent
  | SubagentCompletedEvent
  | ToolResultEvent
  | FileChangedEvent
  | CompleteEvent
  | ErrorEvent;

// ----------------------------------------------------
// ReAct Tools Arguments
// ----------------------------------------------------

export interface WriteFileArgs {
  path: string;
  content: string;
}

export interface EditFileArgs {
  path: string;
  search: string;
  replace: string;
}

export interface CompleteTaskArgs {
  summary: string;
}

export interface DispatchSubagentArgs {
  agent_type: 'researcher' | 'code-reviewer' | string;
  task_prompt: string;
}

// ----------------------------------------------------
// Models & Thinking Levels
// ----------------------------------------------------

export const AVAILABLE_MODELS = [
  'gemma-4-31b-it',
  'gemini-4-argon',
  'gemini-3.8-flash',
  'gemini-3.5-flash-lite',
] as const;

export type AvailableModel = (typeof AVAILABLE_MODELS)[number];

export const THINKING_LEVELS = [
  'minimal',
  'low',
  'medium',
  'high',
] as const;

export type ThinkingLevelOption = (typeof THINKING_LEVELS)[number];

// ----------------------------------------------------
// MelonpanCore Configuration Options
// ----------------------------------------------------

export interface MelonpanCoreOptions {
  apiKey?: string;
  model?: AvailableModel | string; // デフォルト: 'gemini-3.8-flash'
  thinkingLevel?: ThinkingLevelOption | string; // デフォルト: 'high'
  skillsDir?: string; // デフォルト: パッケージ内の skills/ ディレクトリ
  agentsDir?: string; // デフォルト: パッケージ内の agents/ ディレクトリ
  maxTurns?: number; // デフォルト: 10
  simulate?: boolean; // テスト・オフライン用の確定型ReActシミュレーション
  mode?: 'plan' | 'act' | 'auto'; // デフォルト: 'act'
  vfs?: any; // VirtualFS (再利用・事前ロード用)
}

