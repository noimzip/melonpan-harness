import { AgentEvent, SerializedError } from '../types.js';

/**
 * Error インスタンスまたは任意のエラー値を JSON シリアライズ安全な形式に変換する (#52)
 */
export function serializeError(err: unknown): SerializedError {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      code: (err as any).code ? String((err as any).code) : undefined,
      stack: err.stack,
    };
  }
  if (typeof err === 'object' && err !== null) {
    const obj = err as Record<string, any>;
    return {
      name: typeof obj.name === 'string' ? obj.name : 'Error',
      message: typeof obj.message === 'string' ? obj.message : JSON.stringify(obj),
      code: typeof obj.code === 'string' ? obj.code : undefined,
      stack: typeof obj.stack === 'string' ? obj.stack : undefined,
    };
  }
  return {
    name: 'Error',
    message: String(err),
  };
}

/**
 * AgentEvent を JSON シリアライズ可能かつ単調増加 `seq` / `sessionId` 付きに正規化する (#52)
 */
export function toSerializableEvent<T>(
  event: AgentEvent<T>,
  seq: number,
  sessionId?: string
): AgentEvent<T> {
  const normalized: AgentEvent<any> = {
    ...event,
    seq: event.seq ?? seq,
    sessionId: event.sessionId ?? sessionId,
  };

  if (normalized.type === 'ERROR' && normalized.payload) {
    const rawErr = normalized.payload.error;
    const serialized = serializeError(rawErr);
    normalized.payload = {
      ...normalized.payload,
      error: typeof rawErr === 'string' ? rawErr : serialized.message,
      serializedError: normalized.payload.serializedError ?? serialized,
    };
  }

  return normalized as AgentEvent<T>;
}

export interface AgentEventBusOptions {
  sessionId?: string;
  maxReplayBufferSize?: number;
}

/**
 * マルチクライアント購読 & リプレイバッファ対応のイベントバス (#52, #53)
 * - 単調増加するシーケンス番号 `seq` (1, 2, 3...) を自動採番
 * - リモートクライアントの再接続用リングバッファ (`getEventsSince(lastSeq)`)
 */
export class AgentEventBus {
  private listeners: Set<(event: AgentEvent) => void> = new Set();
  private replayBuffer: AgentEvent[] = [];
  private maxReplayBufferSize: number;
  private seqCounter: number = 0;
  private sessionId: string;

  constructor(options: AgentEventBusOptions = {}) {
    this.sessionId = options.sessionId || `session-${Date.now().toString(36)}`;
    this.maxReplayBufferSize = options.maxReplayBufferSize ?? 1000;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  getLastSeq(): number {
    return this.seqCounter;
  }

  /**
   * イベントに `seq` と `sessionId` を付与し、バッファへ記録した上で全リスナーへ配信する
   */
  emit<T = any>(event: AgentEvent<T>): AgentEvent<T> {
    this.seqCounter++;
    const enriched: AgentEvent<T> = {
      ...event,
      seq: event.seq ?? this.seqCounter,
      sessionId: event.sessionId ?? this.sessionId,
      timestamp: event.timestamp ?? Date.now(),
    };

    if (enriched.type === 'ERROR' && enriched.payload) {
      const payloadAny = enriched.payload as any;
      if (!payloadAny.serializedError) {
        payloadAny.serializedError = serializeError(payloadAny.error);
      }
    }

    this.replayBuffer.push(enriched);
    if (this.replayBuffer.length > this.maxReplayBufferSize) {
      this.replayBuffer.shift();
    }

    for (const listener of this.listeners) {
      try {
        listener(enriched);
      } catch {
        // 個別リスナーの例外で他の購読者を止めない
      }
    }

    return enriched;
  }

  /**
   * イベントストリームを購読する（解除関数を返却）
   */
  subscribe(listener: (event: AgentEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 指定された `lastSeq` より後の全イベントを取得する (Issue #53: 再接続リプレイ用)
   */
  getEventsSince(lastSeq: number = 0): AgentEvent[] {
    return this.replayBuffer.filter((e) => (e.seq ?? 0) > lastSeq);
  }

  /**
   * バッファ内の全イベントを JSON シリアライズ可能な配列として取得する (#52)
   */
  getSerializableEventsSince(lastSeq: number = 0): AgentEvent[] {
    return this.getEventsSince(lastSeq).map((e) =>
      toSerializableEvent(e, e.seq ?? 0, this.sessionId)
    );
  }

  /**
   * バッファをクリアする
   */
  clearBuffer(): void {
    this.replayBuffer = [];
  }
}
