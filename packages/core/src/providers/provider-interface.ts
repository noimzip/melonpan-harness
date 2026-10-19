import { TokenUsage } from '../types.js';

export interface ProviderToolCall {
  id: string;
  name: string;
  args: Record<string, any>;
}

export interface ProviderMessageResponse {
  text?: string;
  toolCalls?: ProviderToolCall[];
  usage?: TokenUsage;
}

export interface ProviderToolResult {
  callId: string;
  name: string;
  output: string;
  isError?: boolean;
}

export interface ProviderSessionOptions {
  model: string;
  systemInstruction: string;
  thinkingLevel?: string;
}

export interface PruneHistoryResult {
  prunedCallsCount: number;
  savedCharsCount: number;
}

export interface ProviderSession {
  /**
   * ユーザープロンプトまたは前ターンのツール結果を送信し、LLM応答を取得
   */
  sendMessage(
    input: string | ProviderToolResult[]
  ): Promise<ProviderMessageResponse>;

  /**
   * 会話履歴の巨大コード引数をマスクして Context Pruning を実行
   */
  pruneHistory?(thresholdChars?: number): PruneHistoryResult;
}

export interface ModelProvider {
  createSession(options: ProviderSessionOptions): ProviderSession;
}
