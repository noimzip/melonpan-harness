import { ReactAgent } from './react-agent.js';
import { SkillManager } from './skills/skill-manager.js';
import {
  AgentEvent,
  ClientCommand,
  IAgentRuntime,
  IFileSystem,
  MelonpanCoreOptions,
  PermissionDecision,
  RunExecutionOptions,
  SessionStateSnapshot,
  ToolMiddleware,
} from './types.js';
import { VirtualFS } from './vfs/virtual-fs.js';
import { LocalDiskFS } from './vfs/local-disk-fs.js';
import { AgentSession } from './session/agent-session.js';
import {
  createPermissionMiddleware,
  createSafetyGuardMiddleware,
} from './permissions/index.js';
import {
  createQualityGateMiddleware,
  createRepetitiveCallGuardMiddleware,
} from './safety/index.js';
import { ProviderRegistry } from './providers/index.js';
import {
  LlmSummaryCompactionStrategy,
  ToolOutputPruningStrategy,
} from './session/context-strategy.js';
import { resolveModelContextWindow } from './pricing/model-pricing.js';

/**
 * MelonpanCore - Agent Skills標準仕様準拠・モジュラーReAct自律エージェントハーネス (Core-M1 〜 Core-M4)
 *
 * 1. Pluggable Ports & Adapters:
 *    - `IFileSystem` (`VirtualFS` / `InMemoryVFS` / `LocalDiskFS`)
 *    - `ITool` & `ToolRegistry` + `ToolMiddleware` & `IPermissionPolicy`
 *    - `IPromptComposer` (Domain-Agnostic Sections)
 *    - `ISkillLoader` & `SkillManager` (Progressive Disclosure + `activate_skill`)
 *    - `ISubagentSpawner` / `SubagentRunner` (Clean-Room Scoped ReAct + Hierarchical Events)
 *    - `ISessionStore` & `AgentSession` + `IContextStrategy` (Pruning & Compaction)
 *    - `ILLMProvider` & `ProviderRegistry` (Delta Streaming + `AbortSignal` Cancellation)
 * 2. Transport-Agnostic Runtime Contract (`IAgentRuntime` / `AgentEventBus` / `seq` Replay Buffer)
 */
export class MelonpanCore implements IAgentRuntime {
  private skillManager: SkillManager;
  private agent: ReactAgent;
  private vfs: IFileSystem;
  private session: AgentSession;
  private providerRegistry: ProviderRegistry;

  constructor(options: MelonpanCoreOptions = {}) {
    const maxContextTokens =
      options.maxContextTokens ??
      resolveModelContextWindow(options.model ?? 'gemini-3.8-flash');
    const sharedStrategies =
      options.contextStrategies ?? [
        new ToolOutputPruningStrategy({ preservePrefixCache: true }),
        new LlmSummaryCompactionStrategy({ maxContextTokens }),
      ];

    this.session = new AgentSession({
      mode: options.mode ?? 'act',
      model: options.model ?? 'gemini-3.8-flash',
      thinkingLevel: options.thinkingLevel ?? 'high',
      maxContextTokens: options.maxContextTokens,
      workspaceDir: options.workspaceDir,
      fs: options.vfs,
      store: options.sessionStore,
      contextStrategies: sharedStrategies,
      onRunPrompt: (prompt, runOpts) =>
        this.run(prompt, {
          mode: runOpts?.mode,
          signal: runOpts?.signal,
        }),
    });

    this.vfs = options.vfs ?? (this.session as any).vfs;
    this.skillManager =
      options.skillManager ??
      new SkillManager({
        skillsDir: options.skillsDir,
        fs: this.vfs,
      });

    this.providerRegistry = new ProviderRegistry();
    if (options.provider) {
      this.providerRegistry.registerProvider(options.provider);
    }

    // ミドルウェアパイプライン構築 (#23, #59)
    const middlewares: ToolMiddleware[] = [
      createSafetyGuardMiddleware(),
      createRepetitiveCallGuardMiddleware(),
      createQualityGateMiddleware(),
    ];
    if (options.permissionPolicy) {
      middlewares.push(
        createPermissionMiddleware(
          options.permissionPolicy,
          this.session.getPermissionCoordinator()
        )
      );
    }
    if (options.middlewares && options.middlewares.length > 0) {
      middlewares.push(...options.middlewares);
    }

    this.agent = new ReactAgent({
      apiKey: options.apiKey,
      model: options.model ?? 'gemini-3.8-flash',
      thinkingLevel: options.thinkingLevel ?? 'high',
      maxTurns: options.maxTurns,
      simulate: options.simulate,
      mode: options.mode,
      agentsDir: options.agentsDir,
      tools: options.tools,
      middlewares,
      promptComposer: options.promptComposer,
      subagentSpawner: options.subagentSpawner,
      commandExecutor: options.commandExecutor,
      webProvider: options.webProvider,
      skillManager: this.skillManager,
      contextStrategies: sharedStrategies,
      provider: options.provider,
      enableStreaming: options.enableStreaming,
      maxContextTokens: options.maxContextTokens,
      cacheManager: options.cacheManager,
      maxCostUsd: options.maxCostUsd,
    });
  }

  /**
   * ユーザー入力を受け取り、スキル動的解決・ReActループの全イベントストリーム（単調増加 `seq` 付き）を送出する
   */
  async *run(
    prompt: string,
    runOptions: RunExecutionOptions = {}
  ): AsyncGenerator<AgentEvent, void, unknown> {
    if (runOptions.mode) {
      this.agent.setMode(runOptions.mode);
      this.session.setMode(runOptions.mode);
    }

    // Issue #62: 新規 run 開始時にそれまでのセッション累計トークンをベースラインとして記録
    this.session.beginRunUsageTracking();

    // 1. スキルメタデータの軽量インデックス化
    const indexed = await this.skillManager.loadAllMetadata();
    yield this.session.recordEvent({
      type: 'SKILL_INDEXED',
      payload: {
        skills: indexed.map((s) => ({
          name: s.name,
          description: s.description,
          path: s.filePath,
        })),
        count: indexed.length,
      },
      timestamp: Date.now(),
    });

    // 2. プロンプトに応じたスキルの動的解決と本文ロード (Progressive Disclosure)
    const activeSkills =
      this.skillManager.getDefaultSkills().length > 0
        ? await this.skillManager.resolveSkills(prompt)
        : undefined;
    const skill =
      activeSkills && activeSkills.length > 0
        ? this.skillManager.combineLoadedSkills(activeSkills)
        : await this.skillManager.resolveAndLoad(prompt);
    if (skill) {
      yield this.session.recordEvent({
        type: 'SKILL_LOADED',
        payload: {
          name: skill.name,
          description: skill.description,
          filePath: skill.filePath,
          instructionPreview:
            skill.instruction.length > 150
              ? skill.instruction.slice(0, 150) + '...'
              : skill.instruction,
        },
        timestamp: Date.now(),
      });
    } else {
      yield this.session.recordEvent({
        type: 'THOUGHT',
        payload: {
          thought:
            'ℹ️ No matching or active skills found. Operating in General Autonomous Agent mode.',
        },
        timestamp: Date.now(),
      });
    }

    // 3. ReAct 自律ループの実行
    for await (const event of this.agent.execute(prompt, skill, this.vfs, {
      signal: runOptions.signal,
      activeSkills,
      availableSkills: this.skillManager.getEnabledSkills(),
      history: this.session.getMessages(),
    })) {
      yield this.session.recordEvent(event);
    }
  }

  /**
   * 仮想ファイルシステム内の全成果物（ファイルパス: 内容）を取得
   */
  getVirtualFiles(): Record<string, string> {
    if (typeof (this.vfs as any).getFiles === 'function') {
      return (this.vfs as any).getFiles();
    }
    if (typeof this.vfs.getSnapshot === 'function') {
      return this.vfs.getSnapshot();
    }
    return {};
  }

  /**
   * 仮想ファイルシステムインスタンスを取得
   */
  getVFS(): VirtualFS {
    return this.vfs as VirtualFS;
  }

  /**
   * IFileSystem アダプターを取得
   */
  getFileSystem(): IFileSystem {
    return this.vfs;
  }

  /**
   * スキルマネージャーインスタンスを取得
   */
  getSkillManager(): SkillManager {
    return this.skillManager;
  }

  /**
   * ReactAgent インスタンスを取得
   */
  getAgent(): ReactAgent {
    return this.agent;
  }

  /**
   * セッション管理インスタンス (`AgentSession`) を取得 (#26)
   */
  getSession(): AgentSession {
    return this.session;
  }

  /**
   * プロバイダーレジストリを取得 (#27)
   */
  getProviderRegistry(): ProviderRegistry {
    return this.providerRegistry;
  }

  /**
   * 双方向 ClientCommand を送信する (`IAgentRuntime` 契約 #52)
   */
  async sendCommand(command: ClientCommand): Promise<void> {
    if (command.type === 'SWITCH_MODEL') {
      this.agent.setModel(command.model, command.thinkingLevel);
      if (command.providerId) {
        const p = this.providerRegistry.getProvider(command.providerId);
        if (p) {
          this.agent.setProvider(p);
        }
      }
    }
    await this.session.sendCommand(command);
  }

  /**
   * イベントバスを購読する (`IAgentRuntime` 契約 #52)
   */
  subscribe(listener: (event: AgentEvent) => void): () => void {
    return this.session.subscribe(listener);
  }

  /**
   * 指定シーケンス番号以降のイベントを再取得する (`IAgentRuntime` 契約 #53)
   */
  getEventsSince(lastSeq: number = 0): AgentEvent[] {
    return this.session.getEventsSince(lastSeq);
  }

  /**
   * 現在のセッション状態スナップショットを取得する (`IAgentRuntime` 契約 #53)
   */
  getStateSnapshot(): SessionStateSnapshot {
    return this.session.getStateSnapshot();
  }

  /**
   * Permission 承認/拒否を解決する (#23)
   */
  resolvePermission(requestId: string, decision: PermissionDecision): boolean {
    return this.session.resolvePermission(requestId, decision);
  }
}

// 全型および各サブモジュールのエクスポート
export * from './types.js';
export * from './skills/index.js';
export * from './vfs/index.js';
export * from './tools/index.js';
export * from './subagents/index.js';
export * from './prompts/index.js';
export * from './runtime/index.js';
export * from './permissions/index.js';
export * from './session/index.js';
export * from './cache/index.js';
export * from './git/index.js';
export * from './safety/index.js';
export * from './providers/index.js';
export * from './pricing/index.js';
export * from './logging/index.js';
export * from './react-agent.js';
