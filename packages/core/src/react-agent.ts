import { GoogleGenAI } from '@google/genai';
import { SubagentRunner } from './subagents/subagent-runner.js';
import { ToolRegistry } from './tools/tool-registry.js';
import { createBuiltinTools } from './tools/builtin-tools.js';
import { PromptComposer } from './prompts/prompt-composer.js';
import { extractGeminiResponseParts } from './providers/index.js';
import {
  createDetailedTokenUsage,
  estimateMessagesTokens,
  LlmSummaryCompactionStrategy,
  pruneChatHistory,
  ToolOutputPruningStrategy,
  type PruneHistoryResult,
} from './session/context-strategy.js';
import {
  AgentEvent,
  AgentMode,
  ICommandExecutor,
  IContextStrategy,
  IFileSystem,
  ILLMProvider,
  IPermissionPolicy,
  IPromptComposer,
  ISubagentSpawner,
  ITool,
  IWebProvider,
  LLMMessage,
  LLMToolCall,
  LoadedSkill,
  SkillMetadata,
  ToolExecutionResult,
  ToolMiddleware,
} from './types.js';
import { VirtualFS } from './vfs/virtual-fs.js';
import { ContextCacheManager } from './cache/context-cache-manager.js';
import { createRepetitiveCallGuardMiddleware } from './safety/index.js';

export { pruneChatHistory, type PruneHistoryResult };

export interface ReactAgentOptions {
  apiKey?: string;
  model?: string;
  thinkingLevel?: string;
  maxTurns?: number;
  simulate?: boolean;
  mode?: 'plan' | 'act' | 'auto' | 'goal' | AgentMode;
  agentsDir?: string;
  /** カスタムツール一覧または追加ツールプラグイン (#50) */
  tools?: ITool[];
  /** カスタム ToolRegistry (#50) */
  toolRegistry?: ToolRegistry;
  /** ツール実行ミドルウェア (#23) */
  middlewares?: ToolMiddleware[];
  /** プロンプト合成器 (#51) */
  promptComposer?: IPromptComposer;
  /** サブエージェントスポナー (#25) */
  subagentSpawner?: ISubagentSpawner;
  /** コマンド実行アダプター (#22) */
  commandExecutor?: ICommandExecutor;
  /** Web検索・URL取得アダプター (#22) */
  webProvider?: IWebProvider;
  /** スキルマネージャー (#24) */
  skillManager?: any;
  /** コンテキスト圧縮戦略 (#26) */
  contextStrategies?: IContextStrategy[];
  /** カスタム LLM プロバイダー (#27) */
  provider?: ILLMProvider;
  /** リアルタイムデルタストリーミングを有効にするか (#27) */
  enableStreaming?: boolean;
  /** 最大コンテキストトークン上限 (#17, #26) */
  maxContextTokens?: number;
  /** コンテキストキャッシュマネージャー */
  cacheManager?: ContextCacheManager;
}

export interface ReactAgentExecuteOptions {
  signal?: AbortSignal;
  availableSkills?: SkillMetadata[];
  history?: LLMMessage[];
  workspaceRoot?: string;
}

/**
 * ReAct (Reasoning + Acting) 自律エージェントループ (Core-M1 〜 Core-M4 統合オーケストレーター)
 * - `ToolRegistry` & `ToolMiddleware` パイプラインによるプラガブルなツール実行 (#50, #23)
 * - `IPromptComposer` によるドメイン非依存・優先度順システムプロンプト構築 (#51)
 * - `ILLMProvider` によるマルチプロバイダー & リアルタイムデルタストリーミング (`THOUGHT_DELTA`, `TEXT_DELTA`, `TOOL_CALL_DELTA`) (#27)
 * - `candidates?.[0]?.content?.parts` からの `part.thought === true` 正確抽出 (#4)
 * - `AbortSignal` によるカスケード即時中断 (#27)
 * - 累計課金トークン (`billedPromptTokens`) と現在コンテキストサイズ (`contextWindowTokens`) の分離計測 (#17)
 */
export class ReactAgent {
  private apiKey: string;
  private model: string;
  private thinkingLevel: string;
  private maxTurns: number;
  private simulate: boolean;
  private mode: AgentMode;
  private toolRegistry: ToolRegistry;
  private promptComposer: IPromptComposer;
  private subagentRunner: ISubagentSpawner;
  private commandExecutor?: ICommandExecutor;
  private webProvider?: IWebProvider;
  private skillManager?: any;
  private contextStrategies: IContextStrategy[];
  private provider?: ILLMProvider;
  private enableStreaming: boolean;
  private maxContextTokens: number;
  private cacheManager: ContextCacheManager;

  constructor(options: ReactAgentOptions = {}) {
    const envApiKey =
      typeof (globalThis as any).process !== 'undefined'
        ? (globalThis as any).process.env?.GEMINI_API_KEY
        : '';
    this.apiKey = options.apiKey || envApiKey || '';
    this.model = options.model || 'gemini-3.8-flash';
    this.thinkingLevel = options.thinkingLevel || 'high';
    this.maxTurns = options.maxTurns ?? 300;
    this.simulate = options.simulate ?? (!this.apiKey && !options.provider);
    this.mode = options.mode || 'act';
    this.enableStreaming = options.enableStreaming ?? Boolean(options.provider);
    this.maxContextTokens = options.maxContextTokens ?? 128000;
    this.cacheManager = options.cacheManager || new ContextCacheManager();

    if (options.toolRegistry) {
      this.toolRegistry = options.toolRegistry;
    } else {
      const baseTools = createBuiltinTools();
      if (options.tools && options.tools.length > 0) {
        for (const t of options.tools) {
          const existingIdx = baseTools.findIndex((b) => b.name === t.name);
          if (existingIdx !== -1) {
            baseTools[existingIdx] = t;
          } else {
            baseTools.push(t);
          }
        }
      }
      const middlewares = options.middlewares ? [...options.middlewares] : [];
      middlewares.push(createRepetitiveCallGuardMiddleware());
      this.toolRegistry = new ToolRegistry(baseTools, middlewares);
    }

    this.promptComposer = options.promptComposer ?? new PromptComposer();
    this.commandExecutor = options.commandExecutor;
    this.webProvider = options.webProvider;
    this.skillManager = options.skillManager;
    this.contextStrategies =
      options.contextStrategies ?? [
        new ToolOutputPruningStrategy(),
        new LlmSummaryCompactionStrategy({ maxContextTokens: this.maxContextTokens }),
      ];
    this.provider = options.provider;

    this.subagentRunner =
      options.subagentSpawner ??
      new SubagentRunner({
        apiKey: this.apiKey,
        model: this.model,
        agentsDir: options.agentsDir,
        simulate: this.simulate,
        toolRegistry: this.toolRegistry,
        provider: this.provider,
        commandExecutor: this.commandExecutor,
        webProvider: this.webProvider,
        skillManager: this.skillManager,
      });
  }

  getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }

  getPromptComposer(): IPromptComposer {
    return this.promptComposer;
  }

  setMode(mode: 'plan' | 'act' | 'auto' | 'goal' | AgentMode): void {
    this.mode = mode;
  }

  setModel(model: string, thinkingLevel?: string): void {
    this.model = model;
    if (thinkingLevel) {
      this.thinkingLevel = thinkingLevel;
    }
  }

  setProvider(provider?: ILLMProvider): void {
    this.provider = provider;
    if (this.subagentRunner instanceof SubagentRunner) {
      this.subagentRunner.setProvider(provider);
    }
  }

  /**
   * IFileSystem から全ファイルマップを安全に取得するヘルパー
   */
  private getFilesSnapshot(vfs: IFileSystem): Record<string, string> {
    if (typeof (vfs as any).getFiles === 'function') {
      return (vfs as any).getFiles();
    }
    if (typeof vfs.getSnapshot === 'function') {
      return vfs.getSnapshot();
    }
    return {};
  }

  /**
   * モードに応じた有効な FunctionCalling 定義一覧を取得
   * 通常モードではサブエージェント(dispatch_subagent)を除外し、/goal モード時のみ解禁
   */
  private getAvailableFunctionDeclarations(): any[] {
    const decls = this.toolRegistry.toFunctionDeclarations();
    // サブエージェントは /goal モード（または plan モード / レガシー auto モード）時のみ解禁
    // 標準実装モード (act) では除外する
    if (this.mode === 'act') {
      return decls.filter((d) => d.name !== 'dispatch_subagent');
    }
    if (this.mode !== 'goal' && this.mode !== 'plan' && this.mode !== 'auto') {
      return decls.filter((d) => d.name !== 'dispatch_subagent');
    }
    return decls;
  }

  /**
   * ReAct自律ループを実行し、全イベントをリアルタイムに送出する
   */
  async *execute(
    prompt: string,
    skill: LoadedSkill | undefined,
    vfs: IFileSystem = new VirtualFS(),
    execOptions: ReactAgentExecuteOptions = {}
  ): AsyncGenerator<AgentEvent, void, unknown> {
    const startTime = Date.now();
    const signal = execOptions.signal;

    if (this.subagentRunner instanceof SubagentRunner) {
      this.subagentRunner.setFileSystem(vfs);
      this.subagentRunner.setToolRegistry(this.toolRegistry);
      this.subagentRunner.setAdapters({
        commandExecutor: this.commandExecutor,
        webProvider: this.webProvider,
        skillManager: this.skillManager,
      });
    }

    // AbortSignal 事前チェック (#27)
    if (signal?.aborted) {
      yield {
        type: 'COMPLETE',
        payload: {
          summary: 'Execution aborted before start.',
          files: this.getFilesSnapshot(vfs),
          turns: 0,
          durationMs: 0,
          aborted: true,
          usage: createDetailedTokenUsage({
            billedPromptTokens: 0,
            billedCompletionTokens: 0,
            contextWindowTokens: 0,
            maxContextWindowTokens: this.maxContextTokens,
          }),
        },
        timestamp: Date.now(),
      };
      return;
    }

    // Plan Mode 開始イベントの送出
    if (this.mode === 'plan' || this.mode === 'auto') {
      yield {
        type: 'PLAN_STARTED',
        payload: {
          mode: this.mode,
          prompt,
        },
        timestamp: Date.now(),
      };
    }

    // 1. オフライン / テスト用確定型シミュレーションモード (カスタムプロバイダー未指定時)
    if (this.simulate && !this.provider) {
      if (execOptions.history) {
        execOptions.history.push({
          role: 'user',
          parts: [{ text: prompt }],
        });
      }
      yield* this.executeSimulation(prompt, skill, vfs, startTime, signal);
      if (execOptions.history) {
        execOptions.history.push({
          role: 'model',
          parts: [{ text: `[Completed simulated execution for: ${prompt}]` }],
        });
      }
      return;
    }

    // PromptComposer によるシステムプロンプト構築 (#51)
    const availableSkills =
      execOptions.availableSkills ??
      (typeof this.skillManager?.getEnabledSkills === 'function'
        ? this.skillManager.getEnabledSkills()
        : undefined);

    let currentActiveSkill = skill;
    const buildSystemPrompt = () =>
      this.promptComposer.compose({
        mode: this.mode,
        activeSkill: currentActiveSkill,
        availableSkills,
        availableTools: this.toolRegistry.getAll(),
        workspaceRoot: execOptions.workspaceRoot,
      });

    const systemInstruction = buildSystemPrompt();

    // 2. カスタム ILLMProvider またはデルタストリーミングモード (#27)
    if (this.provider) {
      yield* this.executeWithProvider(
        this.provider,
        prompt,
        systemInstruction,
        vfs,
        startTime,
        execOptions,
        (activatedSkill) => {
          currentActiveSkill = activatedSkill;
          return buildSystemPrompt();
        }
      );
      return;
    }

    // 3. 本番 Gemini ReAct ループ
    try {
      const ai = new GoogleGenAI({ apiKey: this.apiKey });

      const stableTools = this.cacheManager.stabilizeTools(this.getAvailableFunctionDeclarations());
      let cachedContentName = await this.cacheManager.getOrCreateGeminiCache({
        ai,
        model: this.model,
        systemInstruction,
        tools: stableTools,
      });

      const config: Record<string, any> = {};
      if (cachedContentName) {
        config.cachedContent = cachedContentName;
      } else {
        config.systemInstruction = systemInstruction;
        config.tools = stableTools && stableTools.length > 0 ? [{ functionDeclarations: stableTools }] : [];
      }

      const thinkingLevelUpper = (this.thinkingLevel || 'high').toUpperCase();
      const validLevels = ['MINIMAL', 'LOW', 'MEDIUM', 'HIGH'];
      if (validLevels.includes(thinkingLevelUpper)) {
        config.thinkingConfig = {
          includeThoughts: true,
          thinkingLevel: thinkingLevelUpper,
        };
      } else {
        config.thinkingConfig = {
          includeThoughts: true,
        };
      }

      const normalizedHistory =
        execOptions.history && execOptions.history.length > 0
          ? execOptions.history.map((m) => {
              let msgSig: string | undefined = undefined;
              for (const p of m.parts || []) {
                const s =
                  p?.thoughtSignature ||
                  p?.thought_signature ||
                  p?.functionCall?.thoughtSignature ||
                  p?.functionCall?.thought_signature;
                if (typeof s === 'string' && s.length > 0) {
                  msgSig = s;
                  break;
                }
              }

              return {
                role: m.role === 'tool' ? 'user' : m.role === 'system' ? 'user' : m.role,
                parts: m.parts?.map((p: any) => {
                  const sig =
                    p?.thoughtSignature ||
                    p?.thought_signature ||
                    p?.functionCall?.thoughtSignature ||
                    p?.functionCall?.thought_signature ||
                    msgSig;
                  return {
                    ...p,
                    ...(sig ? { thoughtSignature: sig, thought_signature: sig } : {}),
                    ...(p?.functionCall
                      ? {
                          functionCall: {
                            ...p.functionCall,
                            ...(sig ? { thoughtSignature: sig, thought_signature: sig } : {}),
                          },
                        }
                      : {}),
                  };
                }),
              };
            })
          : undefined;

      const chat = ai.chats.create({
        model: this.model,
        config,
        ...(normalizedHistory ? { history: normalizedHistory as any } : {}),
      });

      let turns = 0;
      let currentMessage: any = prompt;
      let totalPromptTokens = 0;
      let totalCompletionTokens = 0;
      let totalCachedPromptTokens = 0;
      let lastPromptTokens = 0;

      while (turns < this.maxTurns) {
        if (signal?.aborted) {
          if (execOptions.history && Array.isArray((chat as any).history)) {
            execOptions.history.splice(0, execOptions.history.length, ...(chat as any).history);
          }
          yield {
            type: 'COMPLETE',
            payload: {
              summary: 'Execution aborted.',
              files: this.getFilesSnapshot(vfs),
              turns,
              durationMs: Date.now() - startTime,
              aborted: true,
              usage: createDetailedTokenUsage({
                billedPromptTokens: Math.max(0, totalPromptTokens - totalCachedPromptTokens),
                billedCompletionTokens: totalCompletionTokens,
                cachedPromptTokens: totalCachedPromptTokens,
                rawPromptTokens: totalPromptTokens,
                contextWindowTokens: lastPromptTokens,
                maxContextWindowTokens: this.maxContextTokens,
              }),
            },
            timestamp: Date.now(),
          };
          return;
        }

        turns++;

        // Context Pruning & Strategy 適用 (#11, #26)
        const chatHistory = (chat as any).history;
        if (this.contextStrategies.length === 0) {
          pruneChatHistory(chatHistory, {
            writeThresholdChars: 200,
            editThresholdChars: 300,
            outputThresholdChars: 400,
            preserveRecentMessages: 2,
            prunePastThoughts: true,
          });
        }

        for (const strategy of this.contextStrategies) {
          const compRes = await strategy.apply(chatHistory, {
            maxContextTokens: this.maxContextTokens,
          });
          if (compRes.compacted) {
            yield {
              type: 'CONTEXT_COMPACTED',
              payload: {
                strategyId: strategy.id,
                beforeTokens: compRes.beforeTokens,
                afterTokens: compRes.afterTokens,
                savedTokens: compRes.savedTokens,
                savedCharsCount: compRes.savedCharsCount,
                reductionRatio: compRes.reductionRatio,
                summary:
                  compRes.summary ||
                  (strategy.id === 'tool-output-pruning'
                    ? `Pruned ${compRes.savedCharsCount || 0} characters from context history`
                    : undefined),
              },
              timestamp: Date.now(),
            };
          }
        }

        const response = await chat.sendMessage({
          message: currentMessage,
        });

        if (Array.isArray((chat as any).history)) {
          const candidateSig =
            (response as any)?.candidates?.[0]?.thoughtSignature ||
            (response as any)?.candidates?.[0]?.thought_signature;
          for (const histMsg of (chat as any).history) {
            if (histMsg.role === 'model' && Array.isArray(histMsg.parts)) {
              let msgSig = candidateSig;
              for (const p of histMsg.parts) {
                const s = p.thoughtSignature || p.thought_signature;
                if (typeof s === 'string' && s.length > 0) {
                  msgSig = s;
                  break;
                }
              }
              if (msgSig) {
                for (const p of histMsg.parts) {
                  if (p.functionCall || p.thought) {
                    p.thoughtSignature = p.thoughtSignature || msgSig;
                    p.thought_signature = p.thought_signature || msgSig;
                    if (p.functionCall) {
                      p.functionCall.thoughtSignature = p.functionCall.thoughtSignature || msgSig;
                      p.functionCall.thought_signature = p.functionCall.thought_signature || msgSig;
                    }
                  }
                }
              }
            }
          }
        }

        if (execOptions.history && Array.isArray((chat as any).history)) {
          execOptions.history.splice(0, execOptions.history.length, ...(chat as any).history);
        }

        // トークン使用量の集計 (usageMetadata) (#17)
        const usageMeta = (response as any).usageMetadata;
        let turnCached = 0;
        if (usageMeta) {
          const extracted = this.cacheManager.extractGeminiUsage(usageMeta);
          const turnPrompt = extracted.promptTokens;
          const turnCompletion = extracted.completionTokens;
          turnCached = extracted.cachedPromptTokens;
          lastPromptTokens = turnPrompt;
          totalPromptTokens += turnPrompt;
          totalCompletionTokens += turnCompletion;
          totalCachedPromptTokens += turnCached;
        }

        const billedPromptTokens = Math.max(0, totalPromptTokens - totalCachedPromptTokens);

        yield {
          type: 'USAGE',
          payload: {
            promptTokens: totalPromptTokens,
            billedPromptTokens,
            rawPromptTokens: totalPromptTokens,
            completionTokens: totalCompletionTokens,
            totalTokens: totalPromptTokens + totalCompletionTokens,
            cachedPromptTokens: totalCachedPromptTokens,
            turn: turns,
            contextWindowTokens: lastPromptTokens,
            maxContextWindowTokens: this.maxContextTokens,
          },
          timestamp: Date.now(),
        };

        // Issue #4: candidates?.[0]?.content?.parts から part.thought === true を抽出
        const { thoughts, texts } = extractGeminiResponseParts(response);

        for (const t of thoughts) {
          if (this.enableStreaming) {
            yield {
              type: 'THOUGHT_DELTA',
              payload: { delta: t },
              timestamp: Date.now(),
            };
          }
          if (t.trim()) {
            yield {
              type: 'THOUGHT',
              payload: { thought: t.trim() },
              timestamp: Date.now(),
            };
          }
        }

        for (const txt of texts) {
          if (this.enableStreaming) {
            yield {
              type: 'TEXT_DELTA',
              payload: { delta: txt },
              timestamp: Date.now(),
            };
          }
          // 思考パートが存在しなかった場合は従来の互換動作として通常テキストも THOUGHT イベントへ配信
          if (thoughts.length === 0 && txt.trim()) {
            yield {
              type: 'THOUGHT',
              payload: { thought: txt.trim() },
              timestamp: Date.now(),
            };
          }
        }

        const functionCalls = response.functionCalls;

        if (functionCalls && functionCalls.length > 0) {
          const functionResponses: any[] = [];
          let isComplete = false;
          let completionSummary = '';

          for (const call of functionCalls) {
            const callName = call.name || 'unknown';
            const callArgs = (call.args || {}) as Record<string, any>;

            yield {
              type: 'TOOL_CALL',
              payload: {
                name: callName,
                args: callArgs,
                callId: call.id,
              },
              timestamp: Date.now(),
            };

            const eventQueue: AgentEvent[] = [];
            let notifyEvent: (() => void) | undefined;
            let toolDone = false;

            const execPromise = this.toolRegistry
              .execute(callName, callArgs, {
                fs: vfs,
                mode: this.mode,
                commandExecutor: this.commandExecutor,
                webProvider: this.webProvider,
                subagentSpawner: this.subagentRunner,
                skillManager: this.skillManager,
                signal,
                callId: call.id,
                emit: (ev) => {
                  eventQueue.push(ev);
                  if (notifyEvent) {
                    const fn = notifyEvent;
                    notifyEvent = undefined;
                    fn();
                  }
                },
              })
              .finally(() => {
                toolDone = true;
                if (notifyEvent) {
                  const fn = notifyEvent;
                  notifyEvent = undefined;
                  fn();
                }
              });

            while (!toolDone || eventQueue.length > 0) {
              while (eventQueue.length > 0) {
                yield eventQueue.shift()!;
              }
              if (!toolDone) {
                await new Promise<void>((r) => {
                  notifyEvent = r;
                });
              }
            }

            const execRes = await execPromise;

            // サブエージェントのトークン消費量を親累計に合算
            const subUsage = execRes.metadata?.usage as any;
            if (subUsage) {
              totalPromptTokens += subUsage.promptTokens || subUsage.rawPromptTokens || 0;
              totalCompletionTokens += subUsage.completionTokens || 0;
              totalCachedPromptTokens += subUsage.cachedPromptTokens || 0;
            }

            yield {
              type: 'TOOL_RESULT',
              payload: {
                name: callName,
                result: execRes.output,
                isError: execRes.isError,
                callId: call.id,
                metadata: execRes.metadata,
              },
              timestamp: Date.now(),
            };

            if (execRes.isTaskComplete) {
              isComplete = true;
              completionSummary =
                execRes.completionSummary ||
                String(callArgs.summary || 'Task completed successfully.');
            }

            functionResponses.push({
              functionResponse: {
                name: callName,
                response: execRes.isError
                  ? { error: execRes.output }
                  : { output: execRes.output },
                id: call.id,
              },
            });
          }

          if (isComplete) {
            yield {
              type: 'COMPLETE',
              payload: {
                summary: completionSummary,
                files: this.getFilesSnapshot(vfs),
                turns,
                durationMs: Date.now() - startTime,
                usage: createDetailedTokenUsage({
                  billedPromptTokens: Math.max(0, totalPromptTokens - totalCachedPromptTokens),
                  billedCompletionTokens: totalCompletionTokens,
                  cachedPromptTokens: totalCachedPromptTokens,
                  rawPromptTokens: totalPromptTokens,
                  contextWindowTokens:
                    lastPromptTokens || estimateMessagesTokens((chat as any).history, systemInstruction),
                  maxContextWindowTokens: this.maxContextTokens,
                }),
              },
              timestamp: Date.now(),
            };
            return;
          }

          currentMessage = functionResponses;
        } else {
          currentMessage =
            'Please proceed by invoking an appropriate workspace tool (e.g., write_file, edit_file, read_file, dispatch_subagent) or call complete_task if finished.';
        }
      }

      // 最大ターン数到達
      yield {
        type: 'COMPLETE',
        payload: {
          summary: `Execution ended after reaching maximum allowed turns (${this.maxTurns}).`,
          files: this.getFilesSnapshot(vfs),
          turns,
          durationMs: Date.now() - startTime,
          usage: createDetailedTokenUsage({
            billedPromptTokens: Math.max(0, totalPromptTokens - totalCachedPromptTokens),
            billedCompletionTokens: totalCompletionTokens,
            cachedPromptTokens: totalCachedPromptTokens,
            rawPromptTokens: totalPromptTokens,
            contextWindowTokens: lastPromptTokens,
            maxContextWindowTokens: this.maxContextTokens,
          }),
        },
        timestamp: Date.now(),
      };
    } catch (err: any) {
      yield {
        type: 'ERROR',
        payload: {
          error: err instanceof Error ? err : new Error(String(err)),
          phase: 'react_loop',
        },
        timestamp: Date.now(),
      };
    }
  }

  /**
   * プラガブル `ILLMProvider` を用いたリアルタイム・デルタストリーミング & ReAct ループ実行 (#27)
   */
  private async *executeWithProvider(
    provider: ILLMProvider,
    prompt: string,
    systemInstruction: string,
    vfs: IFileSystem,
    startTime: number,
    execOptions: ReactAgentExecuteOptions,
    onSkillActivated?: (skill: LoadedSkill) => string
  ): AsyncGenerator<AgentEvent, void, unknown> {
    const signal = execOptions.signal;
    let activeSystemInstruction = systemInstruction;
    const messages: LLMMessage[] = execOptions.history
      ? execOptions.history
      : [];

    messages.push({
      role: 'user',
      parts: [{ text: prompt }],
    });

    let turns = 0;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalCachedPromptTokens = 0;
    let lastContextTokens = 0;

    try {
      while (turns < this.maxTurns) {
        if (signal?.aborted) {
          yield {
            type: 'COMPLETE',
            payload: {
              summary: 'Execution aborted.',
              files: this.getFilesSnapshot(vfs),
              turns,
              durationMs: Date.now() - startTime,
              aborted: true,
              usage: createDetailedTokenUsage({
                billedPromptTokens: totalPromptTokens,
                billedCompletionTokens: totalCompletionTokens,
                cachedPromptTokens: totalCachedPromptTokens,
                contextWindowTokens: lastContextTokens,
                maxContextWindowTokens: this.maxContextTokens,
              }),
            },
            timestamp: Date.now(),
          };
          return;
        }

        turns++;

        // Context Pruning & Compaction Strategies (#11, #26)
        if (this.contextStrategies.length === 0) {
          pruneChatHistory(messages, {
            writeThresholdChars: 200,
            editThresholdChars: 300,
            outputThresholdChars: 400,
            preserveRecentMessages: 2,
            prunePastThoughts: true,
          });
        }

        for (const strategy of this.contextStrategies) {
          const compRes = await strategy.apply(messages, {
            maxContextTokens: this.maxContextTokens,
          });
          if (compRes.compacted) {
            yield {
              type: 'CONTEXT_COMPACTED',
              payload: {
                strategyId: strategy.id,
                beforeTokens: compRes.beforeTokens,
                afterTokens: compRes.afterTokens,
                savedTokens: compRes.savedTokens,
                savedCharsCount: compRes.savedCharsCount,
                reductionRatio: compRes.reductionRatio,
                summary:
                  compRes.summary ||
                  (strategy.id === 'tool-output-pruning'
                    ? `Pruned ${compRes.savedCharsCount || 0} characters from context history`
                    : undefined),
              },
              timestamp: Date.now(),
            };
          }
        }

        let turnThoughtAcc = '';
        let turnTextAcc = '';
        let turnThoughtSignature: string | undefined = undefined;
        const turnToolCalls: LLMToolCall[] = [];

        for await (const chunk of provider.streamChat(
          {
            model: this.model,
            systemInstruction: activeSystemInstruction,
            messages,
            tools: this.getAvailableFunctionDeclarations(),
            thinkingLevel: this.thinkingLevel,
          },
          signal
        )) {
          if (signal?.aborted) {
            break;
          }

          const chunkSig =
            chunk.thoughtSignature ||
            chunk.thought_signature ||
            chunk.toolCall?.thoughtSignature ||
            chunk.toolCall?.thought_signature;
          if (typeof chunkSig === 'string' && chunkSig.length > 0) {
            turnThoughtSignature = chunkSig;
          }

          if (chunk.type === 'thought_delta' && chunk.delta) {
            turnThoughtAcc += chunk.delta;
            yield {
              type: 'THOUGHT_DELTA',
              payload: { delta: chunk.delta },
              timestamp: Date.now(),
            };
          } else if (chunk.type === 'text_delta' && chunk.delta) {
            turnTextAcc += chunk.delta;
            yield {
              type: 'TEXT_DELTA',
              payload: { delta: chunk.delta },
              timestamp: Date.now(),
            };
          } else if (chunk.type === 'tool_call_delta' && chunk.delta) {
            yield {
              type: 'TOOL_CALL_DELTA',
              payload: {
                callId: chunk.toolCall?.id,
                name: chunk.toolCall?.name,
                argsDelta: chunk.delta,
              },
              timestamp: Date.now(),
            };
          } else if (chunk.type === 'tool_call' && chunk.toolCall) {
            turnToolCalls.push(chunk.toolCall);
          } else if (chunk.type === 'usage' && chunk.usage) {
            lastContextTokens = chunk.usage.promptTokens;
            totalPromptTokens += chunk.usage.promptTokens;
            totalCompletionTokens += chunk.usage.completionTokens;
            if (chunk.usage.cachedPromptTokens) {
              totalCachedPromptTokens += chunk.usage.cachedPromptTokens;
            }
          }
        }

        if (signal?.aborted) {
          yield {
            type: 'COMPLETE',
            payload: {
              summary: 'Execution aborted.',
              files: this.getFilesSnapshot(vfs),
              turns,
              durationMs: Date.now() - startTime,
              aborted: true,
              usage: createDetailedTokenUsage({
                billedPromptTokens: Math.max(0, totalPromptTokens - totalCachedPromptTokens),
                billedCompletionTokens: totalCompletionTokens,
                cachedPromptTokens: totalCachedPromptTokens,
                rawPromptTokens: totalPromptTokens,
                contextWindowTokens: lastContextTokens,
                maxContextWindowTokens: this.maxContextTokens,
              }),
            },
            timestamp: Date.now(),
          };
          return;
        }

        if (turnThoughtAcc.trim()) {
          yield {
            type: 'THOUGHT',
            payload: { thought: turnThoughtAcc.trim() },
            timestamp: Date.now(),
          };
        } else if (turnTextAcc.trim()) {
          yield {
            type: 'THOUGHT',
            payload: { thought: turnTextAcc.trim() },
            timestamp: Date.now(),
          };
        }

        const modelParts: any[] = [];
        if (turnThoughtAcc) {
          modelParts.push({
            text: turnThoughtAcc,
            thought: true,
            ...(turnThoughtSignature
              ? { thoughtSignature: turnThoughtSignature, thought_signature: turnThoughtSignature }
              : {}),
          });
        }
        if (turnTextAcc) modelParts.push({ text: turnTextAcc });
        for (const tc of turnToolCalls) {
          const sig = tc.thoughtSignature || tc.thought_signature || turnThoughtSignature;
          modelParts.push({
            functionCall: {
              id: tc.id,
              name: tc.name,
              args: tc.args || {},
              ...(sig ? { thoughtSignature: sig, thought_signature: sig } : {}),
            },
            ...(sig ? { thoughtSignature: sig, thought_signature: sig } : {}),
          });
        }
        messages.push({ role: 'model', parts: modelParts });

        if (turnToolCalls.length > 0) {
          const responseParts: any[] = [];
          let isComplete = false;
          let completionSummary = '';

          for (const call of turnToolCalls) {
            yield {
              type: 'TOOL_CALL',
              payload: {
                name: call.name,
                args: call.args || {},
                callId: call.id,
              },
              timestamp: Date.now(),
            };

            const eventQueue: AgentEvent[] = [];
            let notifyEvent: (() => void) | undefined;
            let toolDone = false;

            const execPromise = this.toolRegistry
              .execute(call.name, call.args || {}, {
                fs: vfs,
                mode: this.mode,
                commandExecutor: this.commandExecutor,
                webProvider: this.webProvider,
                subagentSpawner: this.subagentRunner,
                skillManager: this.skillManager,
                signal,
                callId: call.id,
                emit: (ev) => {
                  eventQueue.push(ev);
                  if (notifyEvent) {
                    const fn = notifyEvent;
                    notifyEvent = undefined;
                    fn();
                  }
                },
              })
              .finally(() => {
                toolDone = true;
                if (notifyEvent) {
                  const fn = notifyEvent;
                  notifyEvent = undefined;
                  fn();
                }
              });

            while (!toolDone || eventQueue.length > 0) {
              while (eventQueue.length > 0) {
                yield eventQueue.shift()!;
              }
              if (!toolDone) {
                await new Promise<void>((r) => {
                  notifyEvent = r;
                });
              }
            }

            const execRes = await execPromise;

            if (
              call.name === 'activate_skill' &&
              !execRes.isError &&
              onSkillActivated &&
              typeof this.skillManager?.activateSkill === 'function'
            ) {
              const activated = await this.skillManager.activateSkill(String(call.args?.name || ''));
              if (activated) {
                activeSystemInstruction = onSkillActivated(activated);
              }
            }

            const subUsage = execRes.metadata?.usage as any;
            if (subUsage) {
              totalPromptTokens += subUsage.promptTokens || subUsage.rawPromptTokens || 0;
              totalCompletionTokens += subUsage.completionTokens || 0;
              totalCachedPromptTokens += subUsage.cachedPromptTokens || 0;
            }

            yield {
              type: 'TOOL_RESULT',
              payload: {
                name: call.name,
                result: execRes.output,
                isError: execRes.isError,
                callId: call.id,
                metadata: execRes.metadata,
              },
              timestamp: Date.now(),
            };

            if (execRes.isTaskComplete) {
              isComplete = true;
              completionSummary =
                execRes.completionSummary ||
                String(call.args?.summary || 'Task completed successfully.');
            }

            responseParts.push({
              functionResponse: {
                id: call.id,
                name: call.name,
                response: execRes.isError
                  ? { error: execRes.output }
                  : { output: execRes.output },
              },
            });
          }

          messages.push({ role: 'user', parts: responseParts });

          const billedPromptTokens = Math.max(0, totalPromptTokens - totalCachedPromptTokens);

          yield {
            type: 'USAGE',
            payload: {
              promptTokens: totalPromptTokens,
              billedPromptTokens,
              rawPromptTokens: totalPromptTokens,
              completionTokens: totalCompletionTokens,
              totalTokens: totalPromptTokens + totalCompletionTokens,
              cachedPromptTokens: totalCachedPromptTokens,
              turn: turns,
              contextWindowTokens:
                lastContextTokens || estimateMessagesTokens(messages, activeSystemInstruction),
              maxContextWindowTokens: this.maxContextTokens,
            },
            timestamp: Date.now(),
          };

          if (isComplete) {
            yield {
              type: 'COMPLETE',
              payload: {
                summary: completionSummary,
                files: this.getFilesSnapshot(vfs),
                turns,
                durationMs: Date.now() - startTime,
                usage: createDetailedTokenUsage({
                  billedPromptTokens: Math.max(0, totalPromptTokens - totalCachedPromptTokens),
                  billedCompletionTokens: totalCompletionTokens,
                  cachedPromptTokens: totalCachedPromptTokens,
                  rawPromptTokens: totalPromptTokens,
                  contextWindowTokens:
                    lastContextTokens || estimateMessagesTokens(messages, activeSystemInstruction),
                  maxContextWindowTokens: this.maxContextTokens,
                }),
              },
              timestamp: Date.now(),
            };
            return;
          }
        } else {
          messages.push({
            role: 'user',
            parts: [
              {
                text: 'Please proceed by calling a workspace tool or complete_task if finished.',
              },
            ],
          });

          const billedPromptTokens = Math.max(0, totalPromptTokens - totalCachedPromptTokens);

          yield {
            type: 'USAGE',
            payload: {
              promptTokens: totalPromptTokens,
              billedPromptTokens,
              rawPromptTokens: totalPromptTokens,
              completionTokens: totalCompletionTokens,
              totalTokens: totalPromptTokens + totalCompletionTokens,
              cachedPromptTokens: totalCachedPromptTokens,
              turn: turns,
              contextWindowTokens:
                lastContextTokens || estimateMessagesTokens(messages, activeSystemInstruction),
              maxContextWindowTokens: this.maxContextTokens,
            },
            timestamp: Date.now(),
          };
        }
      }

      yield {
        type: 'COMPLETE',
        payload: {
          summary: `Execution ended after reaching maximum allowed turns (${this.maxTurns}).`,
          files: this.getFilesSnapshot(vfs),
          turns,
          durationMs: Date.now() - startTime,
          usage: createDetailedTokenUsage({
            billedPromptTokens: Math.max(0, totalPromptTokens - totalCachedPromptTokens),
            billedCompletionTokens: totalCompletionTokens,
            cachedPromptTokens: totalCachedPromptTokens,
            rawPromptTokens: totalPromptTokens,
            contextWindowTokens: lastContextTokens || estimateMessagesTokens(messages, activeSystemInstruction),
            maxContextWindowTokens: this.maxContextTokens,
          }),
        },
        timestamp: Date.now(),
      };
    } catch (err: any) {
      if (signal?.aborted) {
        yield {
          type: 'COMPLETE',
          payload: {
            summary: 'Execution aborted.',
            files: this.getFilesSnapshot(vfs),
            turns,
            durationMs: Date.now() - startTime,
            aborted: true,
            usage: createDetailedTokenUsage({
              billedPromptTokens: Math.max(0, totalPromptTokens - totalCachedPromptTokens),
              billedCompletionTokens: totalCompletionTokens,
              cachedPromptTokens: totalCachedPromptTokens,
              rawPromptTokens: totalPromptTokens,
              contextWindowTokens: lastContextTokens,
              maxContextWindowTokens: this.maxContextTokens,
            }),
          },
          timestamp: Date.now(),
        };
        return;
      }

      yield {
        type: 'ERROR',
        payload: {
          error: err instanceof Error ? err : new Error(String(err)),
          phase: 'react_loop',
        },
        timestamp: Date.now(),
      };
    }
  }

  /**
   * オフライン / テスト用決定論的 ReAct シミュレーション (Plan Mode, Sub-agents, ToolRegistry 経由実行対応)
   */
  private async *executeSimulation(
    prompt: string,
    _skill: LoadedSkill | undefined,
    vfs: IFileSystem,
    startTime: number,
    signal?: AbortSignal
  ): AsyncGenerator<AgentEvent, void, unknown> {
    const runToolViaRegistry = async function* (
      self: ReactAgent,
      name: string,
      args: Record<string, any>,
      callId: string
    ): AsyncGenerator<AgentEvent, ToolExecutionResult, unknown> {
      if (self.enableStreaming) {
        yield {
          type: 'TOOL_CALL_DELTA',
          payload: {
            callId,
            name,
            argsDelta: JSON.stringify(args),
          },
          timestamp: Date.now(),
        };
      }

      yield {
        type: 'TOOL_CALL',
        payload: {
          name,
          args,
          callId,
        },
        timestamp: Date.now(),
      };

      const eventQueue: AgentEvent[] = [];
      let notifyEvent: (() => void) | undefined;
      let toolDone = false;

      const execPromise = self.toolRegistry
        .execute(name, args, {
          fs: vfs,
          mode: self.mode,
          commandExecutor: self.commandExecutor,
          webProvider: self.webProvider,
          subagentSpawner: self.subagentRunner,
          skillManager: self.skillManager,
          signal,
          callId,
          emit: (ev) => {
            eventQueue.push(ev);
            if (notifyEvent) {
              const fn = notifyEvent;
              notifyEvent = undefined;
              fn();
            }
          },
        })
        .finally(() => {
          toolDone = true;
          if (notifyEvent) {
            const fn = notifyEvent;
            notifyEvent = undefined;
            fn();
          }
        });

      while (!toolDone || eventQueue.length > 0) {
        while (eventQueue.length > 0) {
          yield eventQueue.shift()!;
        }
        if (!toolDone) {
          await new Promise<void>((r) => {
            notifyEvent = r;
          });
        }
      }

      const res = await execPromise;

      yield {
        type: 'TOOL_RESULT',
        payload: {
          name,
          result: res.output,
          isError: res.isError,
          callId,
          metadata: res.metadata,
        },
        timestamp: Date.now(),
      };

      return res;
    };

    const emitThought = function* (
      self: ReactAgent,
      thoughtText: string
    ): Generator<AgentEvent, void, unknown> {
      if (self.enableStreaming) {
        yield {
          type: 'THOUGHT_DELTA',
          payload: { delta: thoughtText },
          timestamp: Date.now(),
        };
      }
      yield {
        type: 'THOUGHT',
        payload: { thought: thoughtText },
        timestamp: Date.now(),
      };
    };

    // ------------------------------------------------------------------
    // Case A: Plan Mode (計画書作成のみを行い停止)
    // ------------------------------------------------------------------
    if (this.mode === 'plan') {
      yield* emitThought(
        this,
        `[Plan Mode] Entering planning phase for "${prompt}". Dispatching "researcher" sub-agent for physics and visual architecture recommendations.`
      );

      const subToolRes = yield* runToolViaRegistry(
        this,
        'dispatch_subagent',
        {
          agent_type: 'researcher',
          task_prompt: `Investigate physics and HUD layout for "${prompt}".`,
        },
        'sim-sub-1'
      );

      const researchReport = subToolRes.output;

      const planContent = [
        `# Implementation Plan: ${prompt}`,
        '',
        '## 1. Architecture & Components',
        '- Canvas: 440x680 responsive cyber-neon layout.',
        '- HUD: Glassmorphism overlay bar with Orbitron typography.',
        '- Audio: Synthesized Web Audio API bleeps.',
        '',
        '## 2. Research Findings',
        researchReport,
        '',
        '## 3. Milestones',
        '- [ ] Setup canvas container and glassmorphic HUD bar.',
        '- [ ] Implement player movement and dual keyboard/touch controls.',
        '- [ ] Implement game loop and particle explosion engine.',
      ].join('\n');

      yield* emitThought(
        this,
        'Drafting structured technical plan in "plan.md" based on research findings.'
      );

      yield* runToolViaRegistry(
        this,
        'write_file',
        { path: 'plan.md', content: planContent },
        'sim-plan-write'
      );

      const planSummary = 'Plan Mode finalized. Technical design generated in plan.md.';
      yield {
        type: 'TOOL_CALL',
        payload: {
          name: 'complete_task',
          args: { summary: planSummary },
          callId: 'sim-plan-complete',
        },
        timestamp: Date.now(),
      };

      yield {
        type: 'TOOL_RESULT',
        payload: {
          name: 'complete_task',
          result: 'Task completion confirmed.',
          callId: 'sim-plan-complete',
        },
        timestamp: Date.now(),
      };

      yield {
        type: 'USAGE',
        payload: {
          promptTokens: 1250,
          completionTokens: 450,
          totalTokens: 1700,
          cachedPromptTokens: 380,
          turn: 2,
          contextWindowTokens: 780,
          maxContextWindowTokens: this.maxContextTokens,
        },
        timestamp: Date.now(),
      };

      yield {
        type: 'COMPLETE',
        payload: {
          summary: planSummary,
          files: this.getFilesSnapshot(vfs),
          turns: 2,
          durationMs: Date.now() - startTime,
          usage: createDetailedTokenUsage({
            billedPromptTokens: 1250,
            billedCompletionTokens: 450,
            cachedPromptTokens: 380,
            contextWindowTokens: 780,
            maxContextWindowTokens: this.maxContextTokens,
          }),
        },
        timestamp: Date.now(),
      };
      return;
    }

    // ------------------------------------------------------------------
    // Case B & C: Auto Mode or Act Mode with Sub-agents
    // ------------------------------------------------------------------
    let turnsCount = 0;

    if (this.mode === 'auto') {
      turnsCount++;
      yield* emitThought(
        this,
        `[Auto Mode: Phase 1] Dispatching "researcher" sub-agent to investigate optimal mechanics and visual constraints.`
      );

      const autoSubRes = yield* runToolViaRegistry(
        this,
        'dispatch_subagent',
        {
          agent_type: 'researcher',
          task_prompt: `Research mechanics and visual HUD for "${prompt}".`,
        },
        'sim-sub-res'
      );

      const resReport = autoSubRes.output;
      const autoPlan = `# Plan: ${prompt}\n\n${resReport}\n\n- Implementation file: index.html`;
      await vfs.writeFile('plan.md', autoPlan);
      yield {
        type: 'PLAN_CREATED',
        payload: { plan: autoPlan, path: 'plan.md' },
        timestamp: Date.now(),
      };
    }

    if (signal?.aborted) {
      yield {
        type: 'COMPLETE',
        payload: {
          summary: 'Execution aborted.',
          files: this.getFilesSnapshot(vfs),
          turns: turnsCount,
          durationMs: Date.now() - startTime,
          aborted: true,
        },
        timestamp: Date.now(),
      };
      return;
    }

    // Phase 2: Act (Write index.html)
    turnsCount++;
    yield* emitThought(
      this,
      `[ReAct: Implementation] Writing complete cyber-neon HTML5 Canvas arcade game to "index.html" with Orbitron typography, glassmorphism HUD, particle engine, and touch/keyboard controls.`
    );

    const simulatedHtml = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>CYBER STRIKE - Melonpan Canvas Arcade</title>
  <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@700;900&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0; padding: 0; overflow: hidden; background: #0a0a16;
      display: flex; justify-content: center; align-items: center;
      height: 100vh; font-family: 'Orbitron', monospace; touch-action: none;
    }
    #game-container {
      position: relative; width: 440px; height: 680px; max-width: 100vw; max-height: 100vh;
      border: 1px solid rgba(0, 240, 255, 0.4); border-radius: 12px;
      box-shadow: 0 0 30px rgba(0, 240, 255, 0.25); overflow: hidden;
    }
    #hud {
      position: absolute; top: 0; left: 0; width: 100%; height: 50px;
      background: rgba(10, 10, 22, 0.75); backdrop-filter: blur(10px);
      border-bottom: 1px solid rgba(0, 240, 255, 0.3);
      display: flex; justify-content: space-between; align-items: center;
      padding: 0 16px; color: #00f0ff; z-index: 10; font-size: 14px;
    }
    .hud-val { color: #fff; font-weight: 900; margin-left: 4px; text-shadow: 0 0 8px #00f0ff; }
    canvas { display: block; width: 100%; height: 100%; background: #05050f; }
  </style>
</head>
<body>
  <div id="game-container">
    <div id="hud">
      <div>SCORE: <span id="score-val" class="hud-val">0</span></div>
      <div>STAGE: <span id="stage-val" class="hud-val">1</span></div>
      <div>LIVES: <span id="lives-val" class="hud-val">♥♥♥</span></div>
    </div>
    <canvas id="c" width="440" height="680"></canvas>
  </div>
  <script>
    const canvas = document.getElementById('c');
    const ctx = canvas.getContext('2d');
    const scoreVal = document.getElementById('score-val');
    let score = 0, stage = 1, lives = 3, gameOver = false;
    let player = { x: 220, y: 580, w: 40, h: 20, vx: 0 };
    let bullets = [], enemies = [], particles = [];

    window.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'a') { player.vx = -7; e.preventDefault(); }
      if (e.key === 'ArrowRight' || e.key === 'd') { player.vx = 7; e.preventDefault(); }
      if (e.key === ' ' || e.key === 'Enter') {
        if (gameOver) restart();
        else shoot();
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => {
      if (['ArrowLeft', 'ArrowRight', 'a', 'd'].includes(e.key)) player.vx = 0;
    });

    canvas.addEventListener('pointerdown', (e) => {
      if (gameOver) { restart(); return; }
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) * (canvas.width / rect.width);
      player.x = x;
      shoot();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (gameOver) return;
      const rect = canvas.getBoundingClientRect();
      player.x = (e.clientX - rect.left) * (canvas.width / rect.width);
    });

    function shoot() {
      bullets.push({ x: player.x, y: player.y - 10, vy: -12 });
    }

    function createExplosion(x, y, color) {
      for (let i = 0; i < 16; i++) {
        particles.push({
          x, y,
          vx: (Math.random() - 0.5) * 8,
          vy: (Math.random() - 0.5) * 8,
          alpha: 1,
          color
        });
      }
    }

    function restart() {
      score = 0; stage = 1; lives = 3; gameOver = false;
      enemies = []; bullets = []; particles = [];
      scoreVal.textContent = score;
      loop();
    }

    setInterval(() => {
      if (!gameOver && enemies.length < 8) {
        enemies.push({
          x: Math.random() * (canvas.width - 30) + 15,
          y: 70,
          w: 30, h: 24,
          vy: 2 + Math.random() * 2
        });
      }
    }, 1200);

    function loop() {
      if (gameOver) {
        ctx.fillStyle = 'rgba(10, 10, 22, 0.85)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#ff007f';
        ctx.font = '900 32px Orbitron';
        ctx.textAlign = 'center';
        ctx.fillText('MISSION FAILED', 220, 320);
        ctx.fillStyle = '#00f0ff';
        ctx.font = '16px Orbitron';
        ctx.fillText('TAP OR PRESS SPACE TO RETRY', 220, 370);
        return;
      }

      ctx.fillStyle = '#05050f';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      player.x += player.vx;
      player.x = Math.max(player.w / 2, Math.min(canvas.width - player.w / 2, player.x));

      // Player glow
      ctx.shadowBlur = 12; ctx.shadowColor = '#00f0ff';
      ctx.fillStyle = '#00f0ff';
      ctx.beginPath();
      ctx.moveTo(player.x, player.y - 15);
      ctx.lineTo(player.x - player.w / 2, player.y + 10);
      ctx.lineTo(player.x + player.w / 2, player.y + 10);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;

      // Bullets
      ctx.fillStyle = '#ffe600';
      ctx.shadowBlur = 8; ctx.shadowColor = '#ffe600';
      for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.y += b.vy;
        ctx.fillRect(b.x - 2, b.y - 6, 4, 12);
        if (b.y < 50) bullets.splice(i, 1);
      }
      ctx.shadowBlur = 0;

      // Enemies
      ctx.fillStyle = '#ff007f';
      ctx.shadowBlur = 10; ctx.shadowColor = '#ff007f';
      for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];
        e.y += e.vy;
        ctx.fillRect(e.x - e.w / 2, e.y, e.w, e.h);

        for (let j = bullets.length - 1; j >= 0; j--) {
          const b = bullets[j];
          if (Math.abs(b.x - e.x) < e.w / 2 && Math.abs(b.y - e.y) < e.h / 2) {
            createExplosion(e.x, e.y, '#ff007f');
            enemies.splice(i, 1);
            bullets.splice(j, 1);
            score += 100;
            scoreVal.textContent = score;
            break;
          }
        }

        if (e && e.y > canvas.height - 40) {
          enemies.splice(i, 1);
          lives--;
          document.getElementById('lives-val').textContent = '♥'.repeat(Math.max(0, lives));
          if (lives <= 0) gameOver = true;
        }
      }
      ctx.shadowBlur = 0;

      // Particles
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx; p.y += p.vy; p.alpha -= 0.03;
        if (p.alpha <= 0) {
          particles.splice(i, 1);
        } else {
          ctx.fillStyle = p.color;
          ctx.globalAlpha = p.alpha;
          ctx.fillRect(p.x, p.y, 3, 3);
          ctx.globalAlpha = 1.0;
        }
      }

      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  </script>
</body>
</html>`;

    yield* runToolViaRegistry(
      this,
      'write_file',
      { path: 'index.html', content: simulatedHtml },
      'sim-call-write'
    );

    // Phase 3: Code Review (Sub-agent)
    turnsCount++;
    yield* emitThought(
      this,
      `[ReAct: Multi-Perspective Audit] Dispatching "code-reviewer" sub-agent to audit performance, security, and UI/UX polish.`
    );

    yield* runToolViaRegistry(
      this,
      'dispatch_subagent',
      {
        agent_type: 'code-reviewer',
        task_prompt: `Audit "index.html" (${simulatedHtml.length} chars) for performance, security, and neon visual polish.`,
        file_path: 'index.html',
      },
      'sim-sub-review'
    );

    // Phase 4: Complete
    turnsCount++;
    yield* emitThought(
      this,
      'Code review passed with APPROVED verdict. Verification confirmed. Finalizing task.'
    );

    const summary =
      'Implemented full standalone cyber-neon HTML5 Canvas arcade game with glassmorphic overlay HUD, Orbitron typography, particle explosion system, and responsive touch/keyboard controls. Validated by clean-room code reviewer.';

    yield* runToolViaRegistry(
      this,
      'complete_task',
      { summary },
      'sim-call-complete'
    );

    const simPromptTokens = 450 + turnsCount * 380;
    const simCompletionTokens = 300 + turnsCount * 220;
    const simCachedTokens = Math.max(0, turnsCount > 1 ? (turnsCount - 1) * 320 : 0);
    yield {
      type: 'USAGE',
      payload: {
        promptTokens: simPromptTokens,
        completionTokens: simCompletionTokens,
        totalTokens: simPromptTokens + simCompletionTokens,
        cachedPromptTokens: simCachedTokens,
        turn: turnsCount,
      },
      timestamp: Date.now(),
    };
    yield {
      type: 'COMPLETE',
      payload: {
        summary,
        files: this.getFilesSnapshot(vfs),
        turns: turnsCount,
        durationMs: Date.now() - startTime,
        usage: createDetailedTokenUsage({
          billedPromptTokens: simPromptTokens,
          billedCompletionTokens: simCompletionTokens,
          cachedPromptTokens: simCachedTokens,
          contextWindowTokens: 450 + 380,
          maxContextWindowTokens: this.maxContextTokens,
        }),
      },
      timestamp: Date.now(),
    };
  }
}
