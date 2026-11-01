import type { FunctionDeclaration } from '@google/genai';

/**
 * @melonpan/core 共通型定義 & モジュラーインターフェース契約 (Core-M1 〜 Core-M4)
 * Agent Skills標準仕様 (agentskills.io) & ReAct自律エージェント対応
 */

// ----------------------------------------------------
// 1. Agent Skills Standard Specification (agentskills.io)
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

export interface ISkillLoader {
  loadAllMetadata(customDir?: string): Promise<SkillMetadata[]>;
  loadSkillBody(meta: SkillMetadata): Promise<string>;
}

// ----------------------------------------------------
// 2. File System Port & Diff Contracts (#20, #2, #3, #10)
// ----------------------------------------------------

export interface FileDiffResult {
  success: boolean;
  error?: string;
  diffSummary?: string;
  unifiedDiff?: string;
  addedLines?: number;
  removedLines?: number;
}

export interface ReadFileOptions {
  startLine?: number;
  endLine?: number;
}

export interface ListFilesOptions {
  pattern?: string;
  ignore?: string[];
}

export interface IFileSystem {
  readFile(path: string, options?: ReadFileOptions): Promise<string | undefined> | string | undefined;
  writeFile(path: string, content: string): Promise<void> | void;
  editFile(path: string, search: string, replace: string): Promise<FileDiffResult> | FileDiffResult;
  deleteFile(path: string): Promise<boolean> | boolean;
  exists(path: string): Promise<boolean> | boolean;
  listFiles(dirPath?: string, options?: ListFilesOptions): Promise<string[]> | string[];
  getSnapshot?(): Record<string, string>;
}

// ----------------------------------------------------
// 3. Command & Web Provider Ports (#22)
// ----------------------------------------------------

export interface CommandExecuteOptions {
  cwd?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  env?: Record<string, string>;
}

export interface CommandExecutionResult {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  timedOut?: boolean;
  aborted?: boolean;
  truncated?: boolean;
}

export interface ICommandExecutor {
  execute(command: string, options?: CommandExecuteOptions): Promise<CommandExecutionResult>;
}

export interface WebSearchResultItem {
  title: string;
  url: string;
  snippet: string;
}

export interface WebFetchResult {
  url: string;
  title?: string;
  content: string;
  contentType?: string;
  status: number;
  truncated?: boolean;
}

export interface IWebProvider {
  search(query: string, options?: { maxResults?: number; signal?: AbortSignal }): Promise<WebSearchResultItem[]>;
  fetchUrl(url: string, options?: { maxChars?: number; signal?: AbortSignal }): Promise<WebFetchResult>;
}

// ----------------------------------------------------
// 4. Permissions & Middleware Ports (#23)
// ----------------------------------------------------

export type ToolCategory =
  | 'read'
  | 'write'
  | 'execute'
  | 'network'
  | 'subagent'
  | 'skill'
  | 'control';

export type PermissionRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type PermissionEvaluation = 'allow' | 'ask' | 'deny';

export type PermissionDecision = 'allow' | 'always_allow' | 'deny';

export interface PermissionRequest {
  requestId: string;
  toolName: string;
  category: ToolCategory;
  args: Record<string, unknown>;
  riskLevel: PermissionRiskLevel;
  reason?: string;
}

export interface IPermissionPolicy {
  evaluate(req: PermissionRequest): Promise<PermissionEvaluation> | PermissionEvaluation;
  recordUserDecision(req: PermissionRequest, decision: PermissionDecision): void;
}

// ----------------------------------------------------
// 5. Subagent Spawner Port (#25, #12, #13)
// ----------------------------------------------------

export interface SubagentDefinition {
  name: string;
  description: string;
  role?: string;
  instruction: string;
  allowedTools?: string[];
  readonly?: boolean;
}

export interface SubagentSpawnOptions {
  agentType: string;
  taskPrompt: string;
  filePath?: string;
  files?: string[];
  fileContext?: string;
  parentCallId?: string;
  subagentId?: string;
  signal?: AbortSignal;
  onEvent?: (event: AgentEvent) => void;
}

export interface SubagentRunResult {
  subagentId: string;
  agentType: string;
  output: string;
  durationMs: number;
  turns: number;
  usage?: TokenUsage;
}

export interface ISubagentSpawner {
  run(
    agentType: string,
    taskPrompt: string,
    fileContextOrOptions?: string | Partial<SubagentSpawnOptions>
  ): Promise<string>;
  spawn?(options: SubagentSpawnOptions): Promise<SubagentRunResult>;
  getLastUsage(): TokenUsage | undefined;
}

// ----------------------------------------------------
// 6. Tool & ToolRegistry Ports (#50, #21, #22)
// ----------------------------------------------------

export interface ToolExecutionContext {
  fs: IFileSystem;
  commandExecutor?: ICommandExecutor;
  webProvider?: IWebProvider;
  subagentSpawner?: ISubagentSpawner;
  skillManager?: any;
  signal?: AbortSignal;
  callId?: string;
  subagentId?: string;
  parentCallId?: string;
  emit: (event: AgentEvent) => void;
  requestPermission?: (req: Omit<PermissionRequest, 'requestId'>) => Promise<PermissionDecision>;
}

export interface ToolExecutionResult {
  output: string;
  isError?: boolean;
  isTaskComplete?: boolean;
  completionSummary?: string;
  metadata?: Record<string, unknown>;
}

export interface ITool<TArgs = Record<string, any>> {
  readonly name: string;
  readonly category: ToolCategory;
  readonly declaration: FunctionDeclaration;
  readonly riskLevel?: PermissionRiskLevel;
  execute(args: TArgs, ctx: ToolExecutionContext): Promise<ToolExecutionResult>;
}

export interface ToolMiddlewareContext {
  tool: ITool;
  args: Record<string, any>;
  executionContext: ToolExecutionContext;
}

export type ToolMiddlewareNext = () => Promise<ToolExecutionResult>;

export type ToolMiddleware = (
  ctx: ToolMiddlewareContext,
  next: ToolMiddlewareNext
) => Promise<ToolExecutionResult>;

// ----------------------------------------------------
// 7. Prompt Composer Port (#51)
// ----------------------------------------------------

export interface PromptBuildContext {
  mode: 'plan' | 'act' | 'auto' | string;
  activeSkill?: LoadedSkill;
  availableSkills?: SkillMetadata[];
  availableTools?: ITool[];
  workspaceRoot?: string;
  customInstructions?: string;
}

export interface PromptSection {
  readonly id: string;
  readonly priority: number;
  render(ctx: PromptBuildContext): string | undefined;
}

export interface IPromptComposer {
  addSection(section: PromptSection): void;
  removeSection(id: string): boolean;
  compose(ctx: PromptBuildContext): string;
}

// ----------------------------------------------------
// 8. Token Usage & Context Compaction Ports (#17, #26, #11)
// ----------------------------------------------------

export interface TokenUsage {
  /** 累計課金対象入力トークン (Cumulative Billed Input Tokens across turns) */
  promptTokens: number;
  /** 累計課金対象出力トークン (Cumulative Billed Output Tokens across turns) */
  completionTokens: number;
  /** 累計課金対象合計トークン (Total Billed Tokens) */
  totalTokens: number;
  /** 明示的な累計課金トークン別名 (#17) */
  billedPromptTokens?: number;
  billedCompletionTokens?: number;
  billedTotalTokens?: number;
  /** 現在ターンのコンテキストウィンドウ使用サイズ (#17: Current Context Window Tokens) */
  contextWindowTokens?: number;
  /** コンテキストウィンドウ最大容量に対する使用率 (0.0 - 1.0) */
  contextWindowUtilization?: number;
  /** モデルの最大コンテキストウィンドウ上限 */
  maxContextWindowTokens?: number;
}

export interface ContextCompactionResult {
  compacted: boolean;
  beforeTokens: number;
  afterTokens: number;
  savedTokens: number;
  reductionRatio: number;
  prunedCallsCount?: number;
  savedCharsCount?: number;
  summary?: string;
}

export interface IContextStrategy {
  readonly id: string;
  apply(history: any[], options?: { maxContextTokens?: number; force?: boolean }): Promise<ContextCompactionResult> | ContextCompactionResult;
}

// ----------------------------------------------------
// 9. LLM Provider Ports (#27, #4)
// ----------------------------------------------------

export interface LLMToolCall {
  id?: string;
  name: string;
  args: Record<string, any>;
  /**
   * Gemini 3 / 2.5 思考モードにおける推論整合性保持用署名 (thought_signature)
   * マルチターンでの functionCall 送信時に再送必須
   */
  thoughtSignature?: string;
  thought_signature?: string;
}

export interface LLMToolResponse {
  id?: string;
  name: string;
  response: Record<string, any>;
}

export interface LLMMessagePart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  thought_signature?: string;
  functionCall?: LLMToolCall;
  functionResponse?: LLMToolResponse;
}

export interface LLMMessage {
  role: 'user' | 'model' | 'system' | 'tool';
  parts: LLMMessagePart[];
}

export interface LLMChatRequest {
  model: string;
  systemInstruction?: string;
  messages: LLMMessage[];
  tools?: FunctionDeclaration[];
  thinkingLevel?: string;
  temperature?: number;
  maxOutputTokens?: number;
}

export type LLMStreamChunkType =
  | 'thought_delta'
  | 'text_delta'
  | 'tool_call_delta'
  | 'tool_call'
  | 'usage'
  | 'done';

export interface LLMStreamChunk {
  type: LLMStreamChunkType;
  delta?: string;
  toolCall?: LLMToolCall;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface ILLMProvider {
  readonly id: string;
  streamChat(request: LLMChatRequest, signal?: AbortSignal): AsyncGenerator<LLMStreamChunk, void, unknown>;
  countTokens?(messages: LLMMessage[], systemInstruction?: string): Promise<number>;
}

// ----------------------------------------------------
// 10. Agent Events & Runtime Protocol (#52, #53)
// ----------------------------------------------------

export type AgentEventType =
  | 'SKILL_INDEXED'        // 起動時の全スキルメタデータ軽量インデックス完了
  | 'SKILL_LOADED'         // 該当スキルの本文遅延ロード完了 (Progressive Disclosure)
  | 'PLAN_STARTED'         // 計画策定フェーズの開始 (Plan Mode)
  | 'PLAN_CREATED'         // 計画書の生成完了 (VFS: plan.md)
  | 'THOUGHT'              // エージェントの思考・推論ステップ (Thought)
  | 'THOUGHT_DELTA'        // リアルタイム思考チャンク (#27)
  | 'TEXT_DELTA'           // リアルタイム回答テキストチャンク (#27)
  | 'TOOL_CALL_DELTA'      // リアルタイムツール呼び出しチャンク (#27)
  | 'TOOL_CALL'            // ツール実行要求 (Action)
  | 'PERMISSION_REQUESTED' // ツール実行権限の確認要求 (#23)
  | 'PERMISSION_RESOLVED'  // ツール実行権限の応答確定 (#23)
  | 'SUBAGENT_DISPATCHED'  // サブエージェントへの委譲開始 (Clean-Room Isolation)
  | 'SUBAGENT_COMPLETED'   // サブエージェントの処理完了と報告受領
  | 'TOOL_RESULT'          // ツール実行結果 (Observation)
  | 'FILE_CHANGED'         // FS上のファイル変更 (write, edit, delete)
  | 'CONTEXT_COMPACTED'    // コンテキスト圧縮・プルーニング完了 (#26)
  | 'COMPLETE'             // タスク完了宣言と全成果物VFS
  | 'ERROR';               // エラー

export interface SkillIndexedPayload {
  skills: Array<{ name: string; description: string; path: string }>;
  count: number;
}

export interface SkillLoadedPayload {
  name: string;
  description: string;
  filePath: string;
  instructionPreview: string;
  allowedTools?: string[];
}

export interface PlanStartedPayload {
  mode: 'plan' | 'auto' | string;
  prompt: string;
}

export interface PlanCreatedPayload {
  plan: string;
  path: string;
}

export interface ThoughtPayload {
  thought: string;
}

export interface ThoughtDeltaPayload {
  delta: string;
}

export interface TextDeltaPayload {
  delta: string;
}

export interface ToolCallDeltaPayload {
  callId?: string;
  name?: string;
  argsDelta: string;
}

export interface ToolCallPayload {
  name: string;
  args: Record<string, any>;
  callId?: string;
}

export interface PermissionRequestedPayload {
  requestId: string;
  toolName: string;
  category: ToolCategory;
  args: Record<string, unknown>;
  riskLevel: PermissionRiskLevel;
  reason?: string;
}

export interface PermissionResolvedPayload {
  requestId: string;
  toolName: string;
  decision: PermissionDecision;
}

export interface SubagentDispatchedPayload {
  agentType: 'researcher' | 'code-reviewer' | 'coder' | string;
  taskPrompt: string;
  callId?: string;
  subagentId?: string;
  filePath?: string;
  files?: string[];
}

export interface SubagentCompletedPayload {
  agentType: 'researcher' | 'code-reviewer' | 'coder' | string;
  result: string;
  durationMs: number;
  callId?: string;
  subagentId?: string;
  turns?: number;
  usage?: TokenUsage;
}

export interface ToolResultPayload {
  name: string;
  result: string;
  isError?: boolean;
  callId?: string;
  metadata?: Record<string, unknown>;
}

export interface FileChangedPayload {
  path: string;
  action: 'write' | 'edit' | 'delete';
  size: number;
  diffSummary?: string;
  unifiedDiff?: string;
  addedLines?: number;
  removedLines?: number;
}

export interface ContextCompactedPayload {
  strategyId: string;
  beforeTokens: number;
  afterTokens: number;
  savedTokens: number;
  reductionRatio: number;
  summary?: string;
}

export interface CompletePayload {
  summary: string;
  files: Record<string, string>;
  turns: number;
  durationMs: number;
  usage?: TokenUsage;
  aborted?: boolean;
}

export interface SerializedError {
  message: string;
  name?: string;
  code?: string;
  stack?: string;
}

export interface ErrorPayload {
  error: Error | string;
  serializedError?: SerializedError;
  phase: 'indexing' | 'resolution' | 'react_loop' | 'subagent' | 'execution' | 'permission' | 'session';
}

export interface AgentEvent<T = any> {
  type: AgentEventType;
  payload: T;
  timestamp: number;
  /** セッション内で単調増加するイベントシーケンス番号 (#52, #53) */
  seq?: number;
  /** セッション識別子 (#52, #26) */
  sessionId?: string;
  /** サブエージェントから中継された場合の識別子 (#25) */
  subagentId?: string;
  /** 親エージェントのツール呼び出しID (#25) */
  parentCallId?: string;
}

export type SkillIndexedEvent = AgentEvent<SkillIndexedPayload> & { type: 'SKILL_INDEXED' };
export type SkillLoadedEvent = AgentEvent<SkillLoadedPayload> & { type: 'SKILL_LOADED' };
export type PlanStartedEvent = AgentEvent<PlanStartedPayload> & { type: 'PLAN_STARTED' };
export type PlanCreatedEvent = AgentEvent<PlanCreatedPayload> & { type: 'PLAN_CREATED' };
export type ThoughtEvent = AgentEvent<ThoughtPayload> & { type: 'THOUGHT' };
export type ThoughtDeltaEvent = AgentEvent<ThoughtDeltaPayload> & { type: 'THOUGHT_DELTA' };
export type TextDeltaEvent = AgentEvent<TextDeltaPayload> & { type: 'TEXT_DELTA' };
export type ToolCallDeltaEvent = AgentEvent<ToolCallDeltaPayload> & { type: 'TOOL_CALL_DELTA' };
export type ToolCallEvent = AgentEvent<ToolCallPayload> & { type: 'TOOL_CALL' };
export type PermissionRequestedEvent = AgentEvent<PermissionRequestedPayload> & {
  type: 'PERMISSION_REQUESTED';
};
export type PermissionResolvedEvent = AgentEvent<PermissionResolvedPayload> & {
  type: 'PERMISSION_RESOLVED';
};
export type SubagentDispatchedEvent = AgentEvent<SubagentDispatchedPayload> & {
  type: 'SUBAGENT_DISPATCHED';
};
export type SubagentCompletedEvent = AgentEvent<SubagentCompletedPayload> & {
  type: 'SUBAGENT_COMPLETED';
};
export type ToolResultEvent = AgentEvent<ToolResultPayload> & { type: 'TOOL_RESULT' };
export type FileChangedEvent = AgentEvent<FileChangedPayload> & { type: 'FILE_CHANGED' };
export type ContextCompactedEvent = AgentEvent<ContextCompactedPayload> & {
  type: 'CONTEXT_COMPACTED';
};
export type CompleteEvent = AgentEvent<CompletePayload> & { type: 'COMPLETE' };
export type ErrorEvent = AgentEvent<ErrorPayload> & { type: 'ERROR' };

export type MelonpanEvent =
  | SkillIndexedEvent
  | SkillLoadedEvent
  | PlanStartedEvent
  | PlanCreatedEvent
  | ThoughtEvent
  | ThoughtDeltaEvent
  | TextDeltaEvent
  | ToolCallDeltaEvent
  | ToolCallEvent
  | PermissionRequestedEvent
  | PermissionResolvedEvent
  | SubagentDispatchedEvent
  | SubagentCompletedEvent
  | ToolResultEvent
  | FileChangedEvent
  | ContextCompactedEvent
  | CompleteEvent
  | ErrorEvent;

// ----------------------------------------------------
// 11. Client Commands & Session Snapshot (#52, #53, #26)
// ----------------------------------------------------

export type ClientCommand =
  | {
      type: 'RUN_PROMPT';
      prompt: string;
      mode?: 'plan' | 'act' | 'auto';
      sessionId?: string;
    }
  | {
      type: 'CONFIRM_PLAN';
      approved: boolean;
      feedback?: string;
      sessionId?: string;
    }
  | {
      type: 'RESOLVE_PERMISSION';
      requestId: string;
      decision: PermissionDecision;
      sessionId?: string;
    }
  | {
      type: 'ABORT_EXECUTION';
      reason?: string;
      sessionId?: string;
    }
  | {
      type: 'COMPACT_SESSION';
      sessionId?: string;
    }
  | {
      type: 'SWITCH_MODEL';
      model: string;
      thinkingLevel?: string;
      providerId?: string;
      sessionId?: string;
    };

export interface ActiveSubagentState {
  subagentId: string;
  agentType: string;
  taskPrompt: string;
  parentCallId?: string;
  status: 'running' | 'completed' | 'error';
  startedAt: number;
  completedAt?: number;
}

export interface SessionStateSnapshot {
  sessionId: string;
  status: 'idle' | 'running' | 'waiting_permission' | 'confirming_plan' | 'completed' | 'error';
  mode: 'plan' | 'act' | 'auto' | string;
  model: string;
  thinkingLevel: string;
  lastSeq: number;
  turns: number;
  files: Record<string, string>;
  pendingPermission?: PermissionRequestedPayload;
  pendingPlan?: PlanCreatedPayload;
  usage: TokenUsage;
  activeSubagents: ActiveSubagentState[];
  updatedAt: number;
}

export interface SerializedSessionData {
  sessionId: string;
  createdAt: number;
  updatedAt: number;
  mode: 'plan' | 'act' | 'auto' | string;
  model: string;
  thinkingLevel: string;
  messages: LLMMessage[];
  files: Record<string, string>;
  usage: TokenUsage;
  events?: AgentEvent[];
}

export interface ISessionStore {
  save(session: SerializedSessionData): Promise<void>;
  load(sessionId: string): Promise<SerializedSessionData | undefined>;
  list(): Promise<Array<{ sessionId: string; updatedAt: number; mode: string; model: string }>>;
  delete(sessionId: string): Promise<boolean>;
}

export interface IAgentRuntime {
  sendCommand(command: ClientCommand): Promise<void>;
  subscribe(listener: (event: AgentEvent) => void): () => void;
  getEventsSince(lastSeq: number): AgentEvent[];
  getStateSnapshot(): SessionStateSnapshot;
}

// ----------------------------------------------------
// 12. ReAct Tools Arguments
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

export interface ReadFileArgs {
  path: string;
  start_line?: number;
  end_line?: number;
}

export interface ListFilesArgs {
  path?: string;
  pattern?: string;
}

export interface GrepSearchArgs {
  query: string;
  path?: string;
  include_pattern?: string;
  is_regex?: boolean;
}

export interface RunCommandArgs {
  command: string;
  cwd?: string;
  timeout_ms?: number;
}

export interface WebSearchArgs {
  query: string;
  max_results?: number;
}

export interface FetchUrlArgs {
  url: string;
  max_chars?: number;
}

export interface ActivateSkillArgs {
  name: string;
}

export interface CompleteTaskArgs {
  summary: string;
}

export interface DispatchSubagentArgs {
  agent_type: 'researcher' | 'code-reviewer' | 'coder' | string;
  task_prompt: string;
  file_path?: string;
  files?: string[];
}

// ----------------------------------------------------
// 13. Models & Thinking Levels
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
// 14. MelonpanCore Configuration Options (#19, #50-#53)
// ----------------------------------------------------

export interface RunExecutionOptions {
  signal?: AbortSignal;
  mode?: 'plan' | 'act' | 'auto';
  sessionId?: string;
}

export interface MelonpanCoreOptions {
  apiKey?: string;
  model?: AvailableModel | string; // デフォルト: 'gemini-3.8-flash'
  thinkingLevel?: ThinkingLevelOption | string; // デフォルト: 'high'
  skillsDir?: string; // デフォルト: パッケージ内の skills/ ディレクトリ
  agentsDir?: string; // デフォルト: パッケージ内の agents/ ディレクトリ
  maxTurns?: number; // デフォルト: 100
  simulate?: boolean; // テスト・オフライン用の確定型ReActシミュレーション
  mode?: 'plan' | 'act' | 'auto'; // デフォルト: 'act'
  /** 仮想ファイルシステムまたは任意のIFileSystemアダプター */
  vfs?: IFileSystem;
  /** スキルマネージャーインスタンス */
  skillManager?: any;
  /** カスタムツールまたは追加ツールプラグイン (#50) */
  tools?: ITool[];
  /** ツール実行ミドルウェア (#23) */
  middlewares?: ToolMiddleware[];
  /** 権限ポリシーエンジン (#23) */
  permissionPolicy?: IPermissionPolicy;
  /** シェルコマンド実行アダプター (#22) */
  commandExecutor?: ICommandExecutor;
  /** Web検索・URL取得アダプター (#22) */
  webProvider?: IWebProvider;
  /** プロンプト合成器 (#51) */
  promptComposer?: IPromptComposer;
  /** サブエージェントスポナー (#25) */
  subagentSpawner?: ISubagentSpawner;
  /** コンテキスト圧縮戦略 (#26) */
  contextStrategies?: IContextStrategy[];
  /** セッション永続化ストア (#26) */
  sessionStore?: ISessionStore;
  /** LLMプロバイダーまたはプロバイダーID (#27) */
  provider?: ILLMProvider;
  /** リアルタイムデルタストリーミングを有効にするか (#27) */
  enableStreaming?: boolean;
  /** 最大コンテキストウィンドウサイズ (デフォルト: 128000) */
  maxContextTokens?: number;
}
