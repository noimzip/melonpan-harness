import {
  ActiveSubagentState,
  AgentEvent,
  ClientCommand,
  ContextCompactionResult,
  IAgentRuntime,
  IContextStrategy,
  IFileSystem,
  ISessionStore,
  LLMMessage,
  PermissionDecision,
  PermissionRequestedPayload,
  PlanCreatedPayload,
  SerializedSessionData,
  SessionStateSnapshot,
  TokenUsage,
} from '../types.js';
import { AgentEventBus } from '../runtime/event-bus.js';
import { PermissionCoordinator } from '../permissions/index.js';
import { VirtualFS } from '../vfs/virtual-fs.js';
import {
  createDetailedTokenUsage,
  estimateMessagesTokens,
  LlmSummaryCompactionStrategy,
  ToolOutputPruningStrategy,
} from './context-strategy.js';
import { InMemorySessionStore } from './session-store.js';

export interface AgentSessionOptions {
  sessionId?: string;
  mode?: 'plan' | 'act' | 'auto' | string;
  model?: string;
  thinkingLevel?: string;
  maxContextTokens?: number;
  fs?: IFileSystem;
  store?: ISessionStore;
  contextStrategies?: IContextStrategy[];
  eventBus?: AgentEventBus;
  permissionCoordinator?: PermissionCoordinator;
  onRunPrompt?: (
    prompt: string,
    options?: { mode?: 'plan' | 'act' | 'auto'; signal?: AbortSignal }
  ) => AsyncGenerator<AgentEvent, void, unknown>;
}

/**
 * マルチターン対話・状態スナップショット・リプレイバッファ・双方向クライアントコマンドを統合管理する `AgentSession` (Issues #26, #52, #53, #17)
 */
export class AgentSession implements IAgentRuntime {
  readonly sessionId: string;
  private createdAt: number;
  private updatedAt: number;
  private status: SessionStateSnapshot['status'] = 'idle';
  private mode: 'plan' | 'act' | 'auto' | string;
  private model: string;
  private thinkingLevel: string;
  private maxContextTokens: number;
  private turns: number = 0;

  private messages: LLMMessage[] = [];
  private vfs: IFileSystem;
  private store: ISessionStore;
  private contextStrategies: IContextStrategy[];
  private eventBus: AgentEventBus;
  private permissionCoordinator: PermissionCoordinator;
  private activeAbortController?: AbortController;

  private pendingPermission?: PermissionRequestedPayload;
  private pendingPlan?: PlanCreatedPayload;
  private activeSubagents: Map<string, ActiveSubagentState> = new Map();

  private billedPromptTokens: number = 0;
  private billedCompletionTokens: number = 0;
  private cachedPromptTokens: number = 0;
  private currentContextTokens: number = 0;

  private onRunPrompt?: AgentSessionOptions['onRunPrompt'];

  constructor(options: AgentSessionOptions = {}) {
    this.sessionId =
      options.sessionId || `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    this.createdAt = Date.now();
    this.updatedAt = this.createdAt;
    this.mode = options.mode || 'act';
    this.model = options.model || 'gemini-3.8-flash';
    this.thinkingLevel = options.thinkingLevel || 'high';
    this.maxContextTokens = options.maxContextTokens ?? 128000;

    this.vfs = options.fs ?? new VirtualFS();
    this.store = options.store ?? new InMemorySessionStore();
    this.contextStrategies = options.contextStrategies ?? [
      new ToolOutputPruningStrategy(),
      new LlmSummaryCompactionStrategy({ maxContextTokens: this.maxContextTokens }),
    ];
    this.eventBus =
      options.eventBus ?? new AgentEventBus({ sessionId: this.sessionId });
    this.permissionCoordinator =
      options.permissionCoordinator ?? new PermissionCoordinator();
    this.onRunPrompt = options.onRunPrompt;
  }

  getEventBus(): AgentEventBus {
    return this.eventBus;
  }

  getPermissionCoordinator(): PermissionCoordinator {
    return this.permissionCoordinator;
  }

  private normalizeSessionMessages(messages: LLMMessage[]): LLMMessage[] {
    return messages.map((msg) => {
      if (msg.role === 'model' && Array.isArray(msg.parts)) {
        let msgSig: string | undefined = undefined;
        for (const p of msg.parts) {
          const s =
            p.thoughtSignature ||
            p.thought_signature ||
            p.functionCall?.thoughtSignature ||
            p.functionCall?.thought_signature;
          if (typeof s === 'string' && s.length > 0) {
            msgSig = s;
            break;
          }
        }

        return {
          ...msg,
          parts: msg.parts.map((part) => {
            const sig =
              part.thoughtSignature ||
              part.thought_signature ||
              part.functionCall?.thoughtSignature ||
              part.functionCall?.thought_signature ||
              msgSig;
            return {
              ...part,
              ...(sig ? { thoughtSignature: sig, thought_signature: sig } : {}),
              ...(part.functionCall
                ? {
                    functionCall: {
                      ...part.functionCall,
                      ...(sig ? { thoughtSignature: sig, thought_signature: sig } : {}),
                    },
                  }
                : {}),
            };
          }),
        };
      }
      return msg;
    });
  }

  getMessages(): LLMMessage[] {
    return this.messages;
  }

  setMessages(messages: LLMMessage[]): void {
    this.messages = this.normalizeSessionMessages(messages);
    this.currentContextTokens = estimateMessagesTokens(this.messages);
    this.updatedAt = Date.now();
  }

  appendMessage(message: LLMMessage): void {
    const [norm] = this.normalizeSessionMessages([message]);
    this.messages.push(norm ?? message);
    this.currentContextTokens = estimateMessagesTokens(this.messages);
    this.updatedAt = Date.now();
  }

  getMode(): string {
    return this.mode;
  }

  setMode(mode: 'plan' | 'act' | 'auto' | string): void {
    this.mode = mode;
    this.updatedAt = Date.now();
  }

  getModel(): string {
    return this.model;
  }

  setModel(model: string, thinkingLevel?: string): void {
    this.model = model;
    if (thinkingLevel) {
      this.thinkingLevel = thinkingLevel;
    }
    this.updatedAt = Date.now();
  }

  /**
   * イベントをセッションバスへ記録・配信し、セッション状態スナップショットをリアルタイム更新する (#52, #53)
   */
  recordEvent<T = any>(event: AgentEvent<T>): AgentEvent<T> {
    this.updatedAt = Date.now();

    switch (event.type) {
      case 'TOOL_CALL':
        this.turns++;
        break;

      case 'PERMISSION_REQUESTED':
        this.status = 'waiting_permission';
        this.pendingPermission = event.payload as unknown as PermissionRequestedPayload;
        break;

      case 'PERMISSION_RESOLVED':
        if (this.status === 'waiting_permission') {
          this.status = 'running';
        }
        this.pendingPermission = undefined;
        break;

      case 'PLAN_CREATED':
        this.pendingPlan = event.payload as unknown as PlanCreatedPayload;
        break;

      case 'SUBAGENT_DISPATCHED': {
        const p = event.payload as any;
        const subId = p.subagentId || p.callId || `sub-${Date.now()}`;
        this.activeSubagents.set(subId, {
          subagentId: subId,
          agentType: p.agentType,
          taskPrompt: p.taskPrompt,
          parentCallId: p.callId,
          status: 'running',
          startedAt: event.timestamp || Date.now(),
        });
        break;
      }

      case 'SUBAGENT_COMPLETED': {
        const p = event.payload as any;
        const subId = p.subagentId || p.callId;
        if (subId && this.activeSubagents.has(subId)) {
          const existing = this.activeSubagents.get(subId)!;
          this.activeSubagents.set(subId, {
            ...existing,
            status: 'completed',
            completedAt: event.timestamp || Date.now(),
          });
        }
        break;
      }

      case 'USAGE': {
        const p = event.payload as any;
        if (p?.promptTokens !== undefined) {
          this.billedPromptTokens = Math.max(this.billedPromptTokens, p.promptTokens);
        }
        if (p?.completionTokens !== undefined) {
          this.billedCompletionTokens = Math.max(this.billedCompletionTokens, p.completionTokens);
        }
        if (p?.contextWindowTokens !== undefined) {
          this.currentContextTokens = p.contextWindowTokens;
        }
        if (p?.cachedPromptTokens !== undefined) {
          this.cachedPromptTokens = Math.max(this.cachedPromptTokens, p.cachedPromptTokens);
        }
        break;
      }

      case 'COMPLETE': {
        const p = event.payload as any;
        if (p?.usage) {
          this.billedPromptTokens = Math.max(this.billedPromptTokens, p.usage.promptTokens || 0);
          this.billedCompletionTokens = Math.max(this.billedCompletionTokens, p.usage.completionTokens || 0);
          if (p.usage.cachedPromptTokens !== undefined) {
            this.cachedPromptTokens = Math.max(this.cachedPromptTokens, p.usage.cachedPromptTokens);
          }
          if (p.usage.contextWindowTokens !== undefined) {
            this.currentContextTokens = p.usage.contextWindowTokens;
          }
        }
        this.status = this.mode === 'plan' ? 'confirming_plan' : 'completed';
        break;
      }

      case 'ERROR':
        this.status = 'error';
        break;
    }

    return this.eventBus.emit(event);
  }

  /**
   * 現在のトークン統計（累計課金 Billed Tokens vs 現在コンテキストウィンドウサイズ）を取得 (#17)
   */
  getUsage(): TokenUsage {
    const contextTokens =
      this.currentContextTokens > 0
        ? this.currentContextTokens
        : estimateMessagesTokens(this.messages);

    return createDetailedTokenUsage({
      billedPromptTokens: this.billedPromptTokens,
      billedCompletionTokens: this.billedCompletionTokens,
      cachedPromptTokens: this.cachedPromptTokens,
      contextWindowTokens: contextTokens,
      maxContextWindowTokens: this.maxContextTokens,
    });
  }

  /**
   * コンテキスト圧縮戦略 (`IContextStrategy`) を実行し、圧縮が発生した場合は `CONTEXT_COMPACTED` イベントを送出する (#26)
   */
  async compact(options?: { force?: boolean }): Promise<ContextCompactionResult> {
    let totalSaved = 0;
    const initialTokens = estimateMessagesTokens(this.messages);
    let currentTokens = initialTokens;
    let lastSummary: string | undefined;
    let anyCompacted = false;

    for (const strategy of this.contextStrategies) {
      const res = await strategy.apply(this.messages, {
        maxContextTokens: this.maxContextTokens,
        force: options?.force,
      });
      if (res.compacted) {
        anyCompacted = true;
        totalSaved += res.savedTokens;
        currentTokens = res.afterTokens;
        if (res.summary) {
          lastSummary = res.summary;
        }
        this.recordEvent({
          type: 'CONTEXT_COMPACTED',
          payload: {
            strategyId: strategy.id,
            beforeTokens: res.beforeTokens,
            afterTokens: res.afterTokens,
            savedTokens: res.savedTokens,
            reductionRatio: res.reductionRatio,
            summary: res.summary,
          },
          timestamp: Date.now(),
        });
      }
    }

    this.currentContextTokens = currentTokens;
    const reductionRatio =
      initialTokens > 0 ? Number((totalSaved / initialTokens).toFixed(4)) : 0;

    return {
      compacted: anyCompacted,
      beforeTokens: initialTokens,
      afterTokens: currentTokens,
      savedTokens: totalSaved,
      reductionRatio,
      summary: lastSummary,
    };
  }

  /**
   * クライアント再接続用の差分イベント取得 (#53)
   */
  getEventsSince(lastSeq: number = 0): AgentEvent[] {
    return this.eventBus.getSerializableEventsSince(lastSeq);
  }

  /**
   * クライアント再接続・状態同期用の即時スナップショット取得 (#53)
   */
  getStateSnapshot(): SessionStateSnapshot {
    const files =
      typeof this.vfs.getSnapshot === 'function'
        ? this.vfs.getSnapshot()
        : (this.vfs as any).getFiles?.() || {};

    return {
      sessionId: this.sessionId,
      status: this.status,
      mode: this.mode,
      model: this.model,
      thinkingLevel: this.thinkingLevel,
      lastSeq: this.eventBus.getLastSeq(),
      turns: this.turns,
      files,
      pendingPermission: this.pendingPermission,
      pendingPlan: this.pendingPlan,
      usage: this.getUsage(),
      activeSubagents: Array.from(this.activeSubagents.values()),
      updatedAt: this.updatedAt,
    };
  }

  /**
   * イベントストリーム購読 (#52)
   */
  subscribe(listener: (event: AgentEvent) => void): () => void {
    return this.eventBus.subscribe(listener);
  }

  /**
   * Permission 要求への応答 (#23, #52)
   */
  resolvePermission(requestId: string, decision: PermissionDecision): boolean {
    return this.permissionCoordinator.resolvePermission(requestId, decision);
  }

  /**
   * 実行中タスクの即時中断 (#27, #52)
   */
  abort(reason?: string): void {
    if (this.activeAbortController) {
      this.activeAbortController.abort(reason || 'User aborted execution');
    }
    if (this.status === 'running' || this.status === 'waiting_permission') {
      this.status = 'idle';
    }
  }

  /**
   * 双方向 `ClientCommand` ハンドラー (#52)
   */
  async sendCommand(command: ClientCommand): Promise<void> {
    switch (command.type) {
      case 'RUN_PROMPT': {
        if (command.mode) {
          this.mode = command.mode;
        }
        if (this.onRunPrompt) {
          this.status = 'running';
          this.activeAbortController = new AbortController();
          for await (const ev of this.onRunPrompt(command.prompt, {
            mode: command.mode,
            signal: this.activeAbortController.signal,
          })) {
            // onRunPrompt が内部で recordEvent していない場合はここで記録
            if (ev.seq === undefined) {
              this.recordEvent(ev);
            }
          }
        }
        break;
      }

      case 'CONFIRM_PLAN': {
        if (command.approved) {
          const planPrompt = command.feedback
            ? `Implement according to plan.md (${command.feedback})`
            : `Implement according to plan.md`;
          this.mode = 'act';
          this.pendingPlan = undefined;
          if (this.onRunPrompt) {
            this.status = 'running';
            this.activeAbortController = new AbortController();
            for await (const ev of this.onRunPrompt(planPrompt, {
              mode: 'act',
              signal: this.activeAbortController.signal,
            })) {
              if (ev.seq === undefined) {
                this.recordEvent(ev);
              }
            }
          }
        } else {
          await this.vfs.deleteFile('plan.md');
          this.pendingPlan = undefined;
          this.status = 'idle';
        }
        break;
      }

      case 'RESOLVE_PERMISSION': {
        this.resolvePermission(command.requestId, command.decision);
        break;
      }

      case 'ABORT_EXECUTION': {
        this.abort(command.reason);
        break;
      }

      case 'COMPACT_SESSION': {
        await this.compact({ force: true });
        break;
      }

      case 'SWITCH_MODEL': {
        this.setModel(command.model, command.thinkingLevel);
        break;
      }
    }
  }

  /**
   * セッション状態を `ISessionStore` に永続化する (#26)
   */
  async saveToStore(): Promise<SerializedSessionData> {
    const files =
      typeof this.vfs.getSnapshot === 'function'
        ? this.vfs.getSnapshot()
        : (this.vfs as any).getFiles?.() || {};

    const data: SerializedSessionData = {
      sessionId: this.sessionId,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      mode: this.mode,
      model: this.model,
      thinkingLevel: this.thinkingLevel,
      messages: this.messages,
      files,
      usage: this.getUsage(),
      events: this.getEventsSince(0),
    };

    await this.store.save(data);
    return data;
  }

  /**
   * `ISessionStore` から既存のセッションデータを復元する (#26)
   */
  async restoreFromStore(sessionId: string = this.sessionId): Promise<boolean> {
    const loaded = await this.store.load(sessionId);
    if (!loaded) {
      return false;
    }

    this.createdAt = loaded.createdAt;
    this.updatedAt = loaded.updatedAt;
    this.mode = loaded.mode;
    this.model = loaded.model;
    this.thinkingLevel = loaded.thinkingLevel;
    this.messages = this.normalizeSessionMessages(loaded.messages || []);
    this.billedPromptTokens = loaded.usage?.billedPromptTokens ?? loaded.usage?.promptTokens ?? 0;
    this.billedCompletionTokens =
      loaded.usage?.billedCompletionTokens ?? loaded.usage?.completionTokens ?? 0;
    this.currentContextTokens =
      loaded.usage?.contextWindowTokens ?? estimateMessagesTokens(this.messages);

    if (loaded.files) {
      for (const [fp, content] of Object.entries(loaded.files)) {
        await this.vfs.writeFile(fp, content);
      }
    }

    return true;
  }
}
