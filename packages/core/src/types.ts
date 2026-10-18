/**
 * @melonpan/core 共通型定義
 * クライアントとコア間のやり取りはすべてこのイベントストリームを通じて行われます。
 */

export type AgentEventType =
  | 'SKILL_LOADED' // スキルが動的ロードされた
  | 'THINKING'     // 思考・設計中
  | 'CODE_CHUNK'   // コードのストリーミング断片
  | 'VALIDATING'   // 構文チェック・検証中
  | 'REPAIRING'    // エラー検知による自己修復中
  | 'COMPLETE'     // 完了（成果物確定）
  | 'ERROR';       // 致命的エラー

export interface SkillPayload {
  id: string;
  name: string;
  description: string;
}

export interface ThinkingPayload {
  message: string;
}

export interface ValidatingPayload {
  attempt: number;
  message: string;
}

export interface RepairingPayload {
  attempt: number;
  errors: string[];
  instruction?: string;
}

export interface CompletePayload {
  html: string;
  attempts: number;
  durationMs: number;
}

export interface ErrorPayload {
  error: Error | string;
  phase?: 'resolution' | 'generation' | 'validation' | 'repair' | 'execution';
}

export interface AgentEvent<T = any> {
  type: AgentEventType;
  payload: T;
  timestamp: number;
}

export type SkillLoadedEvent = AgentEvent<SkillPayload> & { type: 'SKILL_LOADED' };
export type ThinkingEvent = AgentEvent<ThinkingPayload> & { type: 'THINKING' };
export type CodeChunkEvent = AgentEvent<string> & { type: 'CODE_CHUNK' };
export type ValidatingEvent = AgentEvent<ValidatingPayload> & { type: 'VALIDATING' };
export type RepairingEvent = AgentEvent<RepairingPayload> & { type: 'REPAIRING' };
export type CompleteEvent = AgentEvent<CompletePayload> & { type: 'COMPLETE' };
export type ErrorEvent = AgentEvent<ErrorPayload> & { type: 'ERROR' };

export type MelonpanEvent =
  | SkillLoadedEvent
  | ThinkingEvent
  | CodeChunkEvent
  | ValidatingEvent
  | RepairingEvent
  | CompleteEvent
  | ErrorEvent;

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  /** プロンプトまたはコンテキストに合致するか判定するルール */
  matches: (input: string) => boolean;
  /** 必要な瞬間にのみ取得する指示プロンプト（遅延ロード） */
  getInstruction: () => Promise<string>;
}

export interface GenerateStreamParams {
  systemInstruction: string;
  prompt: string;
  temperature?: number;
}

export interface LLMProvider {
  generateStream(params: GenerateStreamParams): AsyncIterable<string>;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  sanitizedHtml: string;
}

export interface HtmlValidatorInterface {
  extractHtml(raw: string): string;
  validate(rawOrHtml: string): ValidationResult;
}

export interface AgentLoopOptions {
  maxRepairs?: number;
  temperature?: number;
}

export interface MelonpanCoreOptions extends AgentLoopOptions {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  provider?: LLMProvider;
  validator?: HtmlValidatorInterface;
  skillManager?: any; // SkillManager instance
  disablePresets?: boolean;
}
