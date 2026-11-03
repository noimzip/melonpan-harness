import {
  MelonpanCore,
  VirtualFS,
  InMemorySkillLoader,
  SkillManager,
  RuleBasedPermissionPolicy,
  ILLMProvider,
  calculateTokenCost,
  AgentEvent,
  resolveModelContextWindow,
} from '@melonpan/core';
import {
  Message,
  WebToolCall,
  PlanState,
  PlanTask,
  SubagentTrace,
  PermissionRequest,
  Session,
  ProviderConfig,
  PermissionPolicyConfig,
} from '../types';
import { createProviderInstance, getStoredApiKeys } from './provider-factory';
import { GAME_GENERATOR_SKILL_MD } from './embedded-skills';

export interface RuntimeCallbacks {
  onMessageUpdate: (message: Message) => void;
  onToolCallUpdate: (toolCall: WebToolCall) => void;
  onFileChange: (path: string, content: string) => void;
  onPlanUpdate: (plan: PlanState) => void;
  onSubagentUpdate: (subagent: SubagentTrace) => void;
  onPermissionRequest: (request: PermissionRequest) => void;
  onMetricsUpdate: (updater: (prev: any) => any) => void;
  onEvent?: (event: AgentEvent) => void;
}

export function parsePlanTasks(markdown: string): PlanTask[] {
  const lines = markdown.split('\n');
  const tasks: PlanTask[] = [];
  let count = 1;

  for (const line of lines) {
    const trimmed = line.trim();
    // 1. Checklist brackets: - [ ] or * [ ] or - [x]
    const match = trimmed.match(/^[-*]\s+\[([ xX])\]\s+(.+)$/);
    if (match) {
      tasks.push({
        id: `task-${count++}`,
        title: match[2].trim(),
        status: match[1].toLowerCase() === 'x' ? 'completed' : 'pending',
      });
      continue;
    }

    // 2. Numbered checklist: 1. [ ] or 1. [x]
    const numCheck = trimmed.match(/^\d+\.\s*\[([ xX])\]\s*(.+)$/);
    if (numCheck) {
      tasks.push({
        id: `task-${count++}`,
        title: numCheck[2].trim(),
        status: numCheck[1].toLowerCase() === 'x' ? 'completed' : 'pending',
      });
      continue;
    }
  }

  // If no checkbox syntax was used, fallback to numbered list items
  if (tasks.length === 0) {
    for (const line of lines) {
      const trimmed = line.trim();
      const numMatch = trimmed.match(/^\d+\.\s+([^#\n].+)$/);
      if (numMatch) {
        tasks.push({
          id: `task-${count++}`,
          title: numMatch[1].trim(),
          status: 'pending',
        });
      }
    }
  }

  return tasks;
}

export class AgentRuntime {
  private abortController: AbortController | null = null;
  private isRunning = false;
  private core: MelonpanCore | null = null;
  private sessionPermissions: Set<string> = new Set();
  private permissionPolicy: PermissionPolicyConfig = {
    read: 'allow',
    write: 'ask',
    command: 'ask',
    web: 'allow',
  };

  setPermissionPolicy(policy: PermissionPolicyConfig) {
    this.permissionPolicy = { ...policy };
  }

  getPermissionPolicy(): PermissionPolicyConfig {
    return { ...this.permissionPolicy };
  }

  cancelCurrentTask(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.isRunning = false;
  }

  getIsRunning(): boolean {
    return this.isRunning;
  }

  getCore(): MelonpanCore | null {
    return this.core;
  }

  /**
   * Main turn execution entry point using MelonpanCore ReAct agent loop
   */
  async executeTurn(
    prompt: string,
    session: Session,
    providerConfig: ProviderConfig,
    callbacks: RuntimeCallbacks,
    customProvider?: ILLMProvider
  ): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    // Capture baseline metrics from session before running this turn to avoid double-counting running totals
    const baseBilledInput = session.metrics?.billedInputTokens || 0;
    const baseBilledOutput = session.metrics?.billedOutputTokens || 0;
    const baseCached = session.metrics?.cachedTokens || 0;
    const baseTotal = session.metrics?.totalTokens || 0;

    const assistantMsgId = `asst_${Date.now()}`;
    const assistantMsg: Message = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      thought: '',
      isStreaming: true,
      toolCalls: [],
      timestamp: Date.now(),
    };
    callbacks.onMessageUpdate({ ...assistantMsg });

    try {
      const storedKeys = getStoredApiKeys();
      const effectiveKey = providerConfig.apiKey || storedKeys[providerConfig.provider] || '';

      let provider = customProvider;
      if (!provider) {
        if (providerConfig.provider === 'bridge') {
          // If bridge is selected, execute via bridge endpoint
          await this.runBridgeMode(prompt, session, providerConfig, assistantMsg, callbacks, signal);
          return;
        } else {
          provider = createProviderInstance(
            providerConfig.provider,
            providerConfig.model,
            effectiveKey,
            providerConfig.baseUrl
          );
        }
      }

      if (!provider) {
        throw new Error(
          `「${providerConfig.provider}」のAPIキーが未設定です。入力欄で「/key <APIキー>」を実行するか、設定モーダル（⚙）からAPIキーを入力してください。`
        );
      }

      // Initialize VirtualFS with current session files
      const vfs = new VirtualFS();
      for (const [p, c] of Object.entries(session.files)) {
        await vfs.writeFile(p, c);
      }

      // Initialize SkillManager with embedded standard skills
      const skillLoader = new InMemorySkillLoader();
      skillLoader.registerSkill('game-generator', GAME_GENERATOR_SKILL_MD);
      const skillManager = new SkillManager({ loader: skillLoader, fs: vfs });

      // Initialize Permission Policy
      const permissionPolicy = new RuleBasedPermissionPolicy({
        categoryRules: {
          read: this.permissionPolicy.read,
          write: this.permissionPolicy.write,
          execute: this.permissionPolicy.command,
          network: this.permissionPolicy.web,
          skill: 'allow',
          control: 'allow',
          subagent: 'allow',
        },
      });
      for (const tool of this.sessionPermissions) {
        permissionPolicy.setToolRule(tool, 'allow');
      }

      // Compute remaining cost budget across previous turns in this session (default session cap: $2.00 USD)
      const priorCost = calculateTokenCost({
        model: providerConfig.model,
        billedPromptTokens: baseBilledInput,
        rawPromptTokens: baseBilledInput + baseCached,
        cachedPromptTokens: baseCached,
        completionTokens: baseBilledOutput,
      });
      const priorCostUsd = Math.max(
        session.metrics?.estimatedCostUsd || 0,
        priorCost.totalCostUsd
      );
      const remainingCostCapUsd = Math.max(0.000001, 2.0 - priorCostUsd);

      // Create MelonpanCore ReAct agent
      const core = new MelonpanCore({
        apiKey: effectiveKey,
        model: providerConfig.model,
        provider,
        thinkingLevel: providerConfig.thinkingEffort,
        mode: session.mode,
        simulate: false,
        vfs,
        skillManager,
        permissionPolicy,
        enableStreaming: true,
        maxTurns: 300,
        maxCostUsd: remainingCostCapUsd,
      });
      this.core = core;

      for await (const event of core.run(prompt, {
        mode: session.mode,
        signal,
      })) {
        callbacks.onEvent?.(event);

        switch (event.type) {
          case 'THOUGHT':
            assistantMsg.thought =
              (assistantMsg.thought ? assistantMsg.thought + '\n' : '') +
              event.payload.thought;
            callbacks.onMessageUpdate({ ...assistantMsg });
            break;

          case 'THOUGHT_DELTA':
            assistantMsg.thought = (assistantMsg.thought || '') + event.payload.delta;
            callbacks.onMessageUpdate({ ...assistantMsg });
            break;

          case 'TEXT_DELTA':
            assistantMsg.content = (assistantMsg.content || '') + event.payload.delta;
            callbacks.onMessageUpdate({ ...assistantMsg });
            break;

          case 'TOOL_CALL': {
            const tc: WebToolCall = {
              id:
                event.payload.id ||
                `tool_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
              name: event.payload.name,
              args: event.payload.args || {},
              status: 'running',
            };
            assistantMsg.toolCalls = [...(assistantMsg.toolCalls || []), tc];
            callbacks.onMessageUpdate({ ...assistantMsg });
            callbacks.onToolCallUpdate(tc);
            break;
          }

          case 'TOOL_RESULT': {
            if (assistantMsg.toolCalls && assistantMsg.toolCalls.length > 0) {
              const lastIdx = assistantMsg.toolCalls.findIndex(
                (t) => t.name === event.payload.name && t.status === 'running'
              );
              const targetIdx =
                lastIdx >= 0 ? lastIdx : assistantMsg.toolCalls.length - 1;
              const updatedTc = {
                ...assistantMsg.toolCalls[targetIdx],
                status: (event.payload.isError ? 'error' : 'success') as WebToolCall['status'],
                result: event.payload.output,
              };
              assistantMsg.toolCalls[targetIdx] = updatedTc;
              callbacks.onMessageUpdate({ ...assistantMsg });
              callbacks.onToolCallUpdate(updatedTc);
            }
            break;
          }

          case 'FILE_CHANGED': {
            const filePath = event.payload.path;
            const updatedContent =
              (await vfs.readFile(filePath)) ?? event.payload.content ?? '';
            callbacks.onFileChange(filePath, updatedContent);

            if (assistantMsg.toolCalls && assistantMsg.toolCalls.length > 0) {
              const targetTc = assistantMsg.toolCalls[assistantMsg.toolCalls.length - 1];
              if (targetTc && targetTc.name.includes('file')) {
                targetTc.diff = {
                  path: filePath,
                  newContent: updatedContent,
                  unifiedDiff:
                    event.payload.action === 'edit'
                      ? `--- ${filePath}\n+++ ${filePath}\n@@ updated via edit_file @@`
                      : `+ [Written ${updatedContent.length} chars to ${filePath}]`,
                };
                callbacks.onMessageUpdate({ ...assistantMsg });
              }
            }
            break;
          }

          case 'PLAN_CREATED': {
            const planMarkdown = event.payload.plan;
            const newPlan: PlanState = {
              rawMarkdown: planMarkdown,
              status: 'pending_review',
              tasks: parsePlanTasks(planMarkdown),
            };
            callbacks.onPlanUpdate(newPlan);
            break;
          }

          case 'PERMISSION_REQUESTED': {
            const req: PermissionRequest = {
              id: event.payload.requestId,
              toolName: event.payload.toolName,
              args: event.payload.args || {},
              category:
                event.payload.category === 'execute'
                  ? 'command'
                  : (event.payload.category as any),
              details: event.payload.reason || `${event.payload.toolName} の実行確認`,
              commandString: event.payload.args?.command,
              filePath: event.payload.args?.path,
              diffPreview: event.payload.args?.content
                ? `+ ${event.payload.args.content.slice(0, 300)}...`
                : undefined,
              resolve: (decision) => {
                if (decision === 'always_allow') {
                  this.sessionPermissions.add(event.payload.toolName);
                  core.resolvePermission(event.payload.requestId, 'always_allow');
                } else if (decision === 'allow_once') {
                  core.resolvePermission(event.payload.requestId, 'allow');
                } else {
                  core.resolvePermission(event.payload.requestId, 'deny');
                }
              },
            };
            callbacks.onPermissionRequest(req);
            break;
          }

          case 'SUBAGENT_DISPATCHED': {
            const trace: SubagentTrace = {
              id: event.payload.subagentId || `sub_${Date.now()}`,
              agentName: event.payload.agentType,
              role:
                event.payload.agentType === 'researcher'
                  ? 'Technical & Architectural Researcher'
                  : 'Multi-Perspective Code Auditor',
              taskPrompt: event.payload.taskPrompt,
              thoughts: [`${event.payload.agentType} sub-agent dispatched...`],
              toolCalls: [],
              status: 'running',
              tokens: { input: 0, output: 0, total: 0 },
              durationMs: 0,
            };
            callbacks.onSubagentUpdate(trace);
            break;
          }

          case 'SUBAGENT_COMPLETED': {
            const trace: SubagentTrace = {
              id: event.payload.subagentId || `sub_${Date.now()}`,
              agentName: event.payload.agentType,
              role:
                event.payload.agentType === 'researcher'
                  ? 'Technical & Architectural Researcher'
                  : 'Multi-Perspective Code Auditor',
              taskPrompt: event.payload.taskPrompt || '',
              thoughts: [],
              toolCalls: [],
              status: 'completed',
              verdict:
                event.payload.verdict ||
                (typeof event.payload.result === 'string' &&
                event.payload.result.includes('Critical')
                  ? 'WARN'
                  : 'PASS'),
              report: event.payload.result,
              tokens: {
                input: event.payload.usage?.promptTokens ?? 0,
                output: event.payload.usage?.completionTokens ?? 0,
                total: event.payload.usage?.totalTokens ?? 0,
              },
              durationMs: event.payload.durationMs ?? 0,
            };
            callbacks.onSubagentUpdate(trace);
            break;
          }

          case 'CONTEXT_COMPACTED': {
            const saved = event.payload.savedTokens || 0;
            callbacks.onMetricsUpdate((prev) => ({
              ...prev,
              currentContextTokens: Math.max(0, prev.currentContextTokens - saved),
              prunedChars: prev.prunedChars + (event.payload.savedCharsCount || 0),
              compactionCount: prev.compactionCount + 1,
              compactionLogs: [
                `[${new Date().toLocaleTimeString()}] 自動コンテキスト圧縮: ${saved.toLocaleString()} tokens 削減`,
                ...prev.compactionLogs,
              ],
            }));
            break;
          }

          case 'USAGE': {
            callbacks.onMetricsUpdate((prev) => {
              const billedInputTokens =
                baseBilledInput + (event.payload.billedPromptTokens ?? event.payload.promptTokens ?? 0);
              const billedOutputTokens =
                baseBilledOutput + (event.payload.completionTokens || 0);
              const cachedTokens =
                baseCached + (event.payload.cachedPromptTokens || 0);
              const totalTokens = baseTotal + (event.payload.totalTokens || 0);
              const cost = calculateTokenCost({
                model: providerConfig.model,
                billedPromptTokens: billedInputTokens,
                rawPromptTokens: billedInputTokens + cachedTokens,
                cachedPromptTokens: cachedTokens,
                completionTokens: billedOutputTokens,
              });
              const contextWindowLimit =
                event.payload.maxContextWindowTokens ||
                resolveModelContextWindow(providerConfig.model);
              return {
                ...prev,
                billedInputTokens,
                billedOutputTokens,
                cachedTokens,
                totalTokens,
                currentContextTokens:
                  event.payload.contextWindowTokens || prev.currentContextTokens,
                contextWindowLimit,
                estimatedCostUsd: cost.totalCostUsd,
                estimatedCostJpy: cost.totalCostJpy,
                savedCostUsd: cost.savedCostUsd,
                savedCostJpy: cost.savedCostJpy,
                activeModel: providerConfig.model,
              };
            });
            break;
          }

          case 'COMPLETE':
            assistantMsg.isStreaming = false;
            if (event.payload.costCapReached) {
              assistantMsg.content =
                (assistantMsg.content ? assistantMsg.content + '\n\n' : '') +
                (event.payload.summary ||
                  '⚠️ 累計費用が上限に達したため、安全のため自動一時停止しました。');
            } else if (signal.aborted || /abort/i.test(event.payload.summary || '')) {
              assistantMsg.content =
                (assistantMsg.content ? assistantMsg.content + '\n\n' : '') +
                '⚠️ *ユーザーによってタスクが中断されました。*';
            } else if (!assistantMsg.content) {
              assistantMsg.content =
                event.payload.summary ||
                'タスクが完了しました！右ペインのプレビューで動作を確認できます。';
            }
            callbacks.onMessageUpdate({ ...assistantMsg });
            break;

          case 'ERROR':
            assistantMsg.isStreaming = false;
            assistantMsg.content += `\n\n❌ ${event.payload.error?.message || event.payload.error}`;
            callbacks.onMessageUpdate({ ...assistantMsg });
            break;
        }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError' || signal.aborted || /abort/i.test(err?.message || '')) {
        assistantMsg.isStreaming = false;
        assistantMsg.content += '\n\n⚠️ *ユーザーによってタスクが中断されました。*';
        callbacks.onMessageUpdate({ ...assistantMsg });
      } else {
        assistantMsg.isStreaming = false;
        assistantMsg.content += `\n\n❌ エラーが発生しました: ${err.message || String(err)}`;
        callbacks.onMessageUpdate({ ...assistantMsg });
      }
    } finally {
      assistantMsg.isStreaming = false;
      callbacks.onMessageUpdate({ ...assistantMsg });
      this.isRunning = false;
      this.abortController = null;
    }
  }

  /**
   * Execution via local Node.js bridge endpoint
   */
  private async runBridgeMode(
    prompt: string,
    session: Session,
    providerConfig: ProviderConfig,
    msg: Message,
    callbacks: RuntimeCallbacks,
    signal: AbortSignal
  ): Promise<void> {
    const bridgeUrl = providerConfig.bridgeUrl || 'http://localhost:3001/api/agent';
    const res = await fetch(bridgeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, session }),
      signal,
    });
    if (!res.ok) throw new Error(`Bridge returned HTTP ${res.status}`);
    const data = await res.json();
    msg.content = data.reply || 'ブリッジ経由で完了しました。';
    if (data.files && typeof data.files === 'object') {
      for (const [path, content] of Object.entries(data.files)) {
        callbacks.onFileChange(path, content as string);
      }
    }
    callbacks.onMessageUpdate({ ...msg });
  }
}

export const agentRuntime = new AgentRuntime();
