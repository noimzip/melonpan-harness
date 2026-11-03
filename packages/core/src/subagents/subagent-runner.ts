import { GoogleGenAI } from '@google/genai';
import { load as yamlLoad } from 'js-yaml';
import {
  AgentEvent,
  IFileSystem,
  ILLMProvider,
  ISubagentSpawner,
  LLMToolCall,
  SubagentDefinition,
  SubagentRunResult,
  SubagentSpawnOptions,
  TokenUsage,
} from '../types.js';
import { ToolRegistry } from '../tools/tool-registry.js';
import { createBuiltinTools } from '../tools/builtin-tools.js';
import { VirtualFS } from '../vfs/virtual-fs.js';
import { inspectHtmlGameQuality } from '../safety/quality-gate.js';
import { pruneChatHistory } from '../session/context-strategy.js';

export type { SubagentDefinition };

/**
 * ファイルパスまたは内容から適切な Markdown コードフェンス言語タグを動的に推論する (Issue #12)
 */
export function inferCodeFenceLanguage(filePath?: string, content?: string): string {
  if (filePath) {
    const ext = filePath.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'ts':
      case 'mts':
      case 'cts':
        return 'typescript';
      case 'tsx':
        return 'tsx';
      case 'js':
      case 'mjs':
      case 'cjs':
        return 'javascript';
      case 'jsx':
        return 'jsx';
      case 'md':
      case 'markdown':
        return 'markdown';
      case 'json':
        return 'json';
      case 'css':
        return 'css';
      case 'html':
      case 'htm':
        return 'html';
      case 'py':
        return 'python';
      case 'sh':
      case 'bash':
        return 'bash';
      case 'yml':
      case 'yaml':
        return 'yaml';
      case 'rs':
        return 'rust';
      case 'go':
        return 'go';
      case 'sql':
        return 'sql';
    }
  }

  if (content) {
    const trimmed = content.trimStart();
    if (trimmed.startsWith('<!DOCTYPE html') || trimmed.startsWith('<html') || trimmed.startsWith('<div')) {
      return 'html';
    }
    if (trimmed.startsWith('# ') || trimmed.startsWith('## ') || trimmed.startsWith('---')) {
      return 'markdown';
    }
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      return 'json';
    }
    if (
      trimmed.startsWith('import ') ||
      trimmed.startsWith('export ') ||
      trimmed.includes('interface ')
    ) {
      return 'typescript';
    }
  }

  return 'text';
}

export interface SubagentRunnerOptions {
  apiKey?: string;
  model?: string;
  agentsDir?: string;
  simulate?: boolean;
  fs?: IFileSystem;
  toolRegistry?: ToolRegistry;
  provider?: ILLMProvider;
  commandExecutor?: any;
  webProvider?: any;
  skillManager?: any;
  maxTurns?: number;
}

/**
 * Clean-Room Isolation サブエージェント実行エンジン & ISubagentSpawner 実装 (Issues #25, #12, #13, #20)
 * - メインの会話コンテキストを引き継がず、独立した新規セッションで特化型エージェントを実行
 * - `agents/*.md` の `allowed-tools` / `readonly` に基づいてスコープ制限された `ToolRegistry` を構成
 * - `subagentId` および `parentCallId` を付与した階層的イベント中継 (`onEvent`)
 * - 対象ファイルの拡張子・内容に応じた動的コードフェンス言語指定 (#12)
 */
export class SubagentRunner implements ISubagentSpawner {
  private apiKey: string;
  private model: string;
  private agentsDir?: string;
  private simulate: boolean;
  private vfs: IFileSystem;
  private parentToolRegistry: ToolRegistry;
  private provider?: ILLMProvider;
  private commandExecutor?: any;
  private webProvider?: any;
  private skillManager?: any;
  private maxTurns: number;
  private definitions: Map<string, SubagentDefinition> = new Map();
  private lastUsage?: TokenUsage;

  constructor(options: SubagentRunnerOptions = {}) {
    const envApiKey =
      typeof (globalThis as any).process !== 'undefined'
        ? (globalThis as any).process.env?.GEMINI_API_KEY
        : '';
    this.apiKey = options.apiKey || envApiKey || '';
    this.model = options.model || 'gemini-3.8-flash';
    this.simulate = options.simulate ?? !this.apiKey;
    this.agentsDir = options.agentsDir;
    this.vfs = options.fs ?? new VirtualFS();
    this.parentToolRegistry = options.toolRegistry ?? new ToolRegistry(createBuiltinTools());
    this.provider = options.provider;
    this.commandExecutor = options.commandExecutor;
    this.webProvider = options.webProvider;
    this.skillManager = options.skillManager;
    this.maxTurns = options.maxTurns ?? 10;
  }

  setFileSystem(fs: IFileSystem): void {
    this.vfs = fs;
  }

  setToolRegistry(registry: ToolRegistry): void {
    this.parentToolRegistry = registry;
  }

  setProvider(provider?: ILLMProvider): void {
    this.provider = provider;
  }

  setAdapters(adapters: { commandExecutor?: any; webProvider?: any; skillManager?: any }): void {
    if (adapters.commandExecutor !== undefined) this.commandExecutor = adapters.commandExecutor;
    if (adapters.webProvider !== undefined) this.webProvider = adapters.webProvider;
    if (adapters.skillManager !== undefined) this.skillManager = adapters.skillManager;
  }

  private async resolveDefaultAgentsDir(): Promise<string> {
    if (this.agentsDir) return this.agentsDir;
    try {
      const path = await import('node:path');
      const { fileURLToPath } = await import('node:url');
      const currentFile = fileURLToPath(import.meta.url);
      return path.resolve(path.dirname(currentFile), '../../agents');
    } catch {
      return 'agents';
    }
  }

  /**
   * 定義ディレクトリからエージェント仕様をロード（ブラウザ環境でも安全にフォールバック）
   */
  async loadDefinitions(): Promise<Map<string, SubagentDefinition>> {
    if (this.definitions.size > 0) {
      return this.definitions;
    }

    try {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      const dirToScan = await this.resolveDefaultAgentsDir();
      const entries = await fs.readdir(dirToScan, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.md')) {
          const filePath = path.join(dirToScan, entry.name);
          const raw = await fs.readFile(filePath, 'utf-8');
          const def = this.parseAgentFile(raw, path.basename(entry.name, '.md'));
          this.definitions.set(def.name, def);
        }
      }
    } catch {
      // 読み込みに失敗した場合（ブラウザ環境など）も組み込みフォールバック定義を登録
    }

    // 組み込み定義の補完
    if (!this.definitions.has('researcher')) {
      this.definitions.set('researcher', {
        name: 'researcher',
        description: 'Specialist in researching technical specifications and algorithms.',
        role: 'Technical & Architectural Researcher',
        readonly: true,
        allowedTools: ['read_file', 'list_files', 'grep_search', 'web_search', 'fetch_url', 'complete_task'],
        instruction: this.getDefaultInstruction('researcher'),
      });
    }
    if (!this.definitions.has('code-reviewer')) {
      this.definitions.set('code-reviewer', {
        name: 'code-reviewer',
        description: 'Multi-perspective code auditor assessing performance, security, and UI/UX.',
        role: 'Multi-Perspective Code Reviewer',
        readonly: true,
        allowedTools: ['read_file', 'list_files', 'grep_search', 'run_command', 'complete_task'],
        instruction: this.getDefaultInstruction('code-reviewer'),
      });
    }
    if (!this.definitions.has('coder')) {
      this.definitions.set('coder', {
        name: 'coder',
        description: 'Focused implementation worker capable of reading, writing, and editing code.',
        role: 'Focused Implementation Worker',
        readonly: false,
        allowedTools: ['read_file', 'list_files', 'grep_search', 'write_file', 'edit_file', 'run_command', 'complete_task'],
        instruction: this.getDefaultInstruction('coder'),
      });
    }

    return this.definitions;
  }

  /**
   * Markdown + YAML Frontmatter パーサー (#25: `allowed-tools` および `readonly` 対応)
   */
  parseAgentFile(raw: string, defaultName: string): SubagentDefinition {
    const trimmed = raw.trimStart();
    if (!trimmed.startsWith('---')) {
      return {
        name: defaultName,
        description: 'Specialized sub-agent',
        instruction: raw,
      };
    }

    const firstDelim = trimmed.indexOf('\n');
    const secondDelim = trimmed.indexOf('\n---', firstDelim);
    if (secondDelim === -1) {
      return {
        name: defaultName,
        description: 'Specialized sub-agent',
        instruction: raw,
      };
    }

    const yamlStr = trimmed.slice(firstDelim + 1, secondDelim).trim();
    const afterClosing = trimmed.indexOf('\n', secondDelim + 4);
    const body = afterClosing !== -1 ? trimmed.slice(afterClosing + 1).trim() : '';

    let parsed: any = {};
    try {
      parsed = yamlLoad(yamlStr) || {};
    } catch {
      parsed = {};
    }

    let allowedTools: string[] | undefined;
    if (typeof parsed['allowed-tools'] === 'string') {
      allowedTools = parsed['allowed-tools']
        .split(',')
        .map((t: string) => t.trim())
        .filter(Boolean);
    } else if (Array.isArray(parsed['allowed-tools'])) {
      allowedTools = parsed['allowed-tools'].map((t: any) => String(t).trim()).filter(Boolean);
    }

    return {
      name: parsed.name || defaultName,
      description: parsed.description || 'Specialized sub-agent',
      role: parsed.role,
      readonly: typeof parsed.readonly === 'boolean' ? parsed.readonly : undefined,
      allowedTools,
      instruction: body,
    };
  }

  /**
   * インメモリでサブエージェントを登録（テスト・ブラウザ用）
   */
  registerDefinition(def: SubagentDefinition): void {
    this.definitions.set(def.name, def);
  }

  /**
   * 指定エージェントに適用されるスコープ制限付き ToolRegistry を生成する (#25)
   */
  async getScopedToolRegistry(agentType: string): Promise<ToolRegistry> {
    await this.loadDefinitions();
    const def = this.definitions.get(agentType);
    return this.parentToolRegistry.createScopedRegistry({
      allowedTools: def?.allowedTools,
      readonly: def?.readonly ?? (agentType === 'researcher' || agentType === 'code-reviewer'),
    });
  }

  /**
   * 直近のサブエージェント実行で消費したトークン数を取得
   */
  getLastUsage(): TokenUsage | undefined {
    return this.lastUsage;
  }

  /**
   * コンテキスト文字列（対象ファイル群）を動的な言語フェンスタグ付きで構築する (#12, #13, #61)
   * code-reviewer の場合は対象 HTML ファイルに対して 0 トークン静的品質検査 (Quality Gate) の事前診断結果を自動添付する。
   */
  async buildPromptWithFileContext(
    taskPrompt: string,
    options?: {
      filePath?: string;
      files?: string[];
      fileContext?: string;
      agentType?: string;
    }
  ): Promise<string> {
    const blocks: string[] = [taskPrompt];
    const isReviewer = options?.agentType === 'code-reviewer';

    const appendFileBlock = (fp: string | undefined, content: string) => {
      const lang = inferCodeFenceLanguage(fp, content);
      const label = fp ? `[Target File Content (${fp})]` : `[Target File Content (VFS)]`;
      if (isReviewer && (lang === 'html' || (fp && fp.toLowerCase().endsWith('.html')))) {
        const qg = inspectHtmlGameQuality(content, fp || 'index.html');
        blocks.push(`[Pre-Audit Static Quality Gate]: ${qg.summary}`);
      }
      blocks.push(`${label}:\n\`\`\`${lang}\n${content}\n\`\`\``);
    };

    if (options?.files && options.files.length > 0) {
      for (const fp of options.files) {
        const content = await this.vfs.readFile(fp);
        if (content !== undefined) {
          appendFileBlock(fp, content);
        }
      }
      return blocks.join('\n\n');
    }

    if (options?.fileContext !== undefined) {
      appendFileBlock(options.filePath, options.fileContext);
    } else if (options?.filePath) {
      const content = await this.vfs.readFile(options.filePath);
      if (content !== undefined) {
        appendFileBlock(options.filePath, content);
      }
    }

    return blocks.join('\n\n');
  }

  /**
   * サブエージェントを Clean-Room Isolation 環境で実行 (#25, #12, #13)
   * 第3引数には後方互換の `fileContext?: string` または構造化された `Partial<SubagentSpawnOptions>` を受け取ります。
   */
  async run(
    agentType: string,
    taskPrompt: string,
    fileContextOrOptions?: string | Partial<SubagentSpawnOptions>
  ): Promise<string> {
    const opts: Partial<SubagentSpawnOptions> =
      typeof fileContextOrOptions === 'string'
        ? { fileContext: fileContextOrOptions }
        : fileContextOrOptions || {};

    const result = await this.spawn({
      agentType,
      taskPrompt,
      ...opts,
    });
    return result.output;
  }

  /**
   * Clean-Room ReAct ループによるサブエージェント実行と階層イベント中継 (#25)
   */
  async spawn(options: SubagentSpawnOptions): Promise<SubagentRunResult> {
    const startTime = Date.now();
    const { agentType, taskPrompt, signal, onEvent } = options;
    const subagentId =
      options.subagentId || `sub-${agentType}-${Date.now().toString(36)}`;
    const parentCallId = options.parentCallId;

    if (signal?.aborted) {
      throw new Error(`Subagent "${agentType}" execution aborted.`);
    }

    await this.loadDefinitions();
    const def = this.definitions.get(agentType);
    const scopedTools = await this.getScopedToolRegistry(agentType);
    const baseInstruction = def?.instruction || this.getDefaultInstruction(agentType);
    const instruction = `${baseInstruction}\n\n[STRICT CLEAN-ROOM CONSTRAINTS]: Do NOT include conversational filler, greetings, or step-by-step thinking traces. Output ONLY a concise, structured bulleted summary of conclusions and actionable findings (maximum 150-200 words) so that the parent agent can immediately act on it without context pollution.`;

    const message = await this.buildPromptWithFileContext(taskPrompt, {
      filePath: options.filePath,
      files: options.files,
      fileContext: options.fileContext,
      agentType,
    });

    const emitHierarchical = (event: AgentEvent) => {
      if (onEvent) {
        onEvent({
          ...event,
          subagentId,
          parentCallId,
        });
      }
    };

    // 1. オフライン / テスト用確定型シミュレーション
    if (this.simulate && !this.provider) {
      const promptLen = message.length;
      const simPromptTokens = Math.max(80, Math.min(350, Math.round(promptLen / 4)));
      this.lastUsage = {
        promptTokens: simPromptTokens,
        rawPromptTokens: simPromptTokens,
        billedPromptTokens: simPromptTokens,
        cachedPromptTokens: 0,
        completionTokens: 160,
        totalTokens: simPromptTokens + 160,
      };

      emitHierarchical({
        type: 'THOUGHT',
        payload: {
          thought: `[Sub-agent ${agentType}] Analyzing task in isolated clean-room session (allowed tools: ${scopedTools.getToolNames().join(', ')})...`,
        },
        timestamp: Date.now(),
      });

      const output = this.simulateSubagent(agentType, taskPrompt);
      return {
        subagentId,
        agentType,
        output,
        durationMs: Date.now() - startTime,
        turns: 1,
        usage: this.lastUsage,
      };
    }

    // 2. カスタム ILLMProvider が設定されている場合 (#27)
    if (this.provider) {
      let totalPrompt = 0;
      let totalCompletion = 0;
      let totalCached = 0;
      let turns = 0;
      let finalOutput = '';
      const messages: any[] = [{ role: 'user', parts: [{ text: message }] }];

      while (turns < this.maxTurns) {
        if (signal?.aborted) {
          throw new Error(`Subagent "${agentType}" aborted.`);
        }
        turns++;

        pruneChatHistory(messages, {
          writeThresholdChars: 200,
          editThresholdChars: 300,
          outputThresholdChars: 400,
          preserveRecentMessages: 2,
          prunePastThoughts: true,
        });

        let turnText = '';
        const toolCalls: LLMToolCall[] = [];
        const seenToolCallKeys = new Set<string>();

        let turnThoughtSignature: string | undefined = undefined;

        for await (const chunk of this.provider.streamChat(
          {
            model: this.model,
            systemInstruction: instruction,
            messages,
            tools: scopedTools.toFunctionDeclarations(),
          },
          signal
        )) {
          const chunkSig =
            chunk.thoughtSignature ||
            chunk.thought_signature ||
            chunk.toolCall?.thoughtSignature ||
            chunk.toolCall?.thought_signature;
          if (typeof chunkSig === 'string' && chunkSig.length > 0) {
            turnThoughtSignature = chunkSig;
          }

          if (chunk.type === 'thought_delta' && chunk.delta) {
            emitHierarchical({
              type: 'THOUGHT_DELTA',
              payload: { delta: chunk.delta },
              timestamp: Date.now(),
            });
          } else if (chunk.type === 'text_delta' && chunk.delta) {
            turnText += chunk.delta;
          } else if (chunk.type === 'tool_call' && chunk.toolCall) {
            const tc = chunk.toolCall;
            const dedupKey = tc.id
              ? `id:${tc.id}`
              : `call:${tc.name}:${JSON.stringify(tc.args || {})}`;
            if (!seenToolCallKeys.has(dedupKey)) {
              seenToolCallKeys.add(dedupKey);
              toolCalls.push(tc);
            }
          } else if (chunk.type === 'usage' && chunk.usage) {
            totalPrompt += chunk.usage.promptTokens || chunk.usage.rawPromptTokens || 0;
            totalCompletion += chunk.usage.completionTokens || 0;
            if (chunk.usage.cachedPromptTokens) {
              totalCached += chunk.usage.cachedPromptTokens;
            }
          }
        }

        if (turnText.trim()) {
          finalOutput = turnText.trim();
          emitHierarchical({
            type: 'THOUGHT',
            payload: { thought: finalOutput },
            timestamp: Date.now(),
          });
        }

        if (toolCalls.length === 0) {
          break;
        }

        messages.push({
          role: 'model',
          parts: toolCalls.map((tc) => {
            const sig = tc.thoughtSignature || tc.thought_signature || turnThoughtSignature;
            return {
              functionCall: {
                id: tc.id,
                name: tc.name,
                args: tc.args || {},
                ...(sig ? { thoughtSignature: sig, thought_signature: sig } : {}),
              },
              ...(sig ? { thoughtSignature: sig, thought_signature: sig } : {}),
            };
          }),
        });

        const toolResponseParts: any[] = [];
        let completedViaTool = false;

        for (const call of toolCalls) {
          emitHierarchical({
            type: 'TOOL_CALL',
            payload: { name: call.name, args: call.args || {}, callId: call.id },
            timestamp: Date.now(),
          });

          const res = await scopedTools.execute(call.name, call.args || {}, {
            fs: this.vfs,
            commandExecutor: this.commandExecutor,
            webProvider: this.webProvider,
            skillManager: this.skillManager,
            signal,
            callId: call.id,
            subagentId,
            parentCallId,
            emit: emitHierarchical,
          });

          emitHierarchical({
            type: 'TOOL_RESULT',
            payload: {
              name: call.name,
              result: res.output,
              isError: res.isError,
              callId: call.id,
              metadata: res.metadata,
            },
            timestamp: Date.now(),
          });

          if (res.isTaskComplete) {
            completedViaTool = true;
            if (res.completionSummary) {
              finalOutput = res.completionSummary;
            }
          }

          toolResponseParts.push({
            functionResponse: {
              id: call.id,
              name: call.name,
              response: res.isError ? { error: res.output } : { output: res.output },
            },
          });
        }

        messages.push({ role: 'user', parts: toolResponseParts });
        if (completedViaTool) break;
      }

      this.lastUsage = {
        promptTokens: totalPrompt || 100,
        rawPromptTokens: totalPrompt || 100,
        billedPromptTokens: Math.max(0, (totalPrompt || 100) - totalCached),
        cachedPromptTokens: totalCached,
        completionTokens: totalCompletion || 120,
        totalTokens: (totalPrompt || 100) + (totalCompletion || 120),
      };

      return {
        subagentId,
        agentType,
        output: finalOutput || 'Sub-agent completed task.',
        durationMs: Date.now() - startTime,
        turns,
        usage: this.lastUsage,
      };
    }

    // 3. 本番 Clean-Room Gemini セッション（Multi-turn ReAct with Scoped Tools）
    const ai = new GoogleGenAI({ apiKey: this.apiKey });
    const geminiTools = scopedTools.toGeminiTools();
    const chat = ai.chats.create({
      model: this.model,
      config: {
        systemInstruction: instruction,
        ...(geminiTools.length > 0 ? { tools: geminiTools } : {}),
      },
    });

    let currentMsg: any = message;
    let turns = 0;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalCachedPromptTokens = 0;
    let finalReport = '';

    while (turns < this.maxTurns) {
      if (signal?.aborted) {
        throw new Error(`Subagent "${agentType}" aborted.`);
      }
      turns++;

      if (Array.isArray((chat as any).history)) {
        pruneChatHistory((chat as any).history, {
          writeThresholdChars: 200,
          editThresholdChars: 300,
          outputThresholdChars: 400,
          preserveRecentMessages: 2,
          prunePastThoughts: true,
        });
      }

      const response = await chat.sendMessage({
        message: currentMsg,
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

      const usageMeta = (response as any).usageMetadata;
      if (usageMeta) {
        totalPromptTokens += usageMeta.promptTokenCount || 0;
        totalCompletionTokens += usageMeta.candidatesTokenCount || 0;
        totalCachedPromptTokens +=
          usageMeta.cachedContentTokenCount ||
          usageMeta.totalCachedTokens ||
          usageMeta.total_cached_tokens ||
          0;
      }

      // 思考パートの抽出 (#4)
      const parts = (response as any).candidates?.[0]?.content?.parts || [];
      for (const part of parts) {
        if (part?.thought === true && typeof part.text === 'string' && part.text.trim()) {
          emitHierarchical({
            type: 'THOUGHT',
            payload: { thought: part.text.trim() },
            timestamp: Date.now(),
          });
        }
      }

      if (response.text && response.text.trim()) {
        finalReport = response.text.trim();
      }

      const functionCalls = response.functionCalls;
      if (!functionCalls || functionCalls.length === 0) {
        break;
      }

      const functionResponses: any[] = [];
      let isDone = false;

      for (const call of functionCalls) {
        const callName = call.name || 'unknown';
        emitHierarchical({
          type: 'TOOL_CALL',
          payload: { name: callName, args: call.args || {}, callId: call.id },
          timestamp: Date.now(),
        });

        const execRes = await scopedTools.execute(callName, call.args || {}, {
          fs: this.vfs,
          commandExecutor: this.commandExecutor,
          webProvider: this.webProvider,
          skillManager: this.skillManager,
          signal,
          callId: call.id,
          subagentId,
          parentCallId,
          emit: emitHierarchical,
        });

        emitHierarchical({
          type: 'TOOL_RESULT',
          payload: {
            name: callName,
            result: execRes.output,
            isError: execRes.isError,
            callId: call.id,
            metadata: execRes.metadata,
          },
          timestamp: Date.now(),
        });

        if (execRes.isTaskComplete) {
          isDone = true;
          if (execRes.completionSummary) {
            finalReport = execRes.completionSummary;
          }
        }

        functionResponses.push({
          functionResponse: {
            name: callName,
            response: execRes.isError ? { error: execRes.output } : { output: execRes.output },
            id: call.id,
          },
        });
      }

      if (isDone) {
        break;
      }
      currentMsg = functionResponses;
    }

    if (totalPromptTokens > 0 || totalCompletionTokens > 0) {
      this.lastUsage = {
        promptTokens: totalPromptTokens,
        rawPromptTokens: totalPromptTokens,
        billedPromptTokens: Math.max(0, totalPromptTokens - totalCachedPromptTokens),
        cachedPromptTokens: totalCachedPromptTokens,
        completionTokens: totalCompletionTokens,
        totalTokens: totalPromptTokens + totalCompletionTokens,
      };
    } else {
      this.lastUsage = undefined;
    }

    return {
      subagentId,
      agentType,
      output: finalReport || 'No response from sub-agent.',
      durationMs: Date.now() - startTime,
      turns,
      usage: this.lastUsage,
    };
  }

  /**
   * 組み込みフォールバック指示文
   */
  private getDefaultInstruction(agentType: string): string {
    if (agentType === 'researcher') {
      return `You are a technical research sub-agent. Investigate the technical topic and return 1. 結論 (Conclusion), 2. 推奨実装 (Recommended Implementation), 3. 懸念点・リスク (Risks & Considerations). Keep it concise, focused, and actionable.`;
    }
    if (agentType === 'code-reviewer') {
      return `You are a multi-perspective code reviewer. Audit the code across 1. Performance, 2. Security, 3. Visual & UI/UX. Output Critical, Warning, and Verdict (APPROVED or NEEDS_REVISION). Keep it concise and bulleted.`;
    }
    if (agentType === 'coder') {
      return `You are a focused implementation sub-agent. Implement or refine the requested files using write_file or edit_file, verify your work, and summarize the changes concisely.`;
    }
    return `You are an expert sub-agent specializing in ${agentType}. Provide clear, direct, and actionable advice for the task.`;
  }

  /**
   * 確定型シミュレーションレスポンス
   */
  private simulateSubagent(agentType: string, taskPrompt: string): string {
    if (agentType === 'researcher') {
      return [
        '### 1. 結論 (Conclusion)',
        `「${taskPrompt.slice(0, 40)}」に関する技術調査結果: HTML5 Canvas 2D では requestAnimationFrame による60FPSメインループ、CSSグラスモフィズムHUDオーバーレイ、およびWeb Audio APIの動的周波数シンセシスによる効果音設計が最適です。`,
        '',
        '### 2. 推奨実装 (Recommended Implementation)',
        '- タイポグラフィ: Google Fonts Orbitron (`family=Orbitron:wght@700;900`) をヘッダーでロードしHUDに適用。',
        '- HUDレイアウト: Canvas上部に `position: absolute; top: 0; width: 100%; backdrop-filter: blur(10px); background: rgba(10,10,22,0.75); border-bottom: 1px solid rgba(0,240,255,0.3);` のグラスモフィズムバーを設置。',
        '- 入力処理: PCのキーボード（Arrow/WASD/Space）とモバイルのPointerEvent（ドラッグ・タップ）を両立。',
        '',
        '### 3. 懸念点・リスク (Risks & Considerations)',
        '- `ctx.shadowBlur` の多用はスマートフォンで描画負荷が高くなるため、発光要素の描画後に `ctx.shadowBlur = 0` で必ずリセットすること。',
        '- モバイルブラウザでの意図しない画面スクロールを防ぐため、コンテナに `touch-action: none;` を指定し、キーイベントで `e.preventDefault()` を呼ぶこと。',
      ].join('\n');
    }

    if (agentType === 'code-reviewer') {
      return [
        '### 1. Performance (パフォーマンス監査)',
        '- [PASS] `requestAnimationFrame` ループ内での過剰なGCオブジェクト割り当ては回避されています。',
        '- [PASS] イベントリスナーの重複登録はなく、初期化時に適切にバインドされています。',
        '- [PASS] パーティクルシステムは寿命管理（alpha <= 0）により自動回収されています。',
        '',
        '### 2. Security & Robustness (セキュリティ監査)',
        '- [PASS] 外部スクリプトや未検証の innerHTML 挿入はなく、DOM操作は安全です。',
        '- [PASS] Canvas 2D コンテキストの取得とエラーガードが実装されています。',
        '',
        '### 3. Visual & UI/UX (演出・操作性監査)',
        '- [PASS] Google Fonts Orbitron の読み込みとHUD適用を確認。',
        '- [PASS] グラスモフィズムHUDオーバーレイにより、ゲーム画面とUIスコアが視認性高く分離されています。',
        '- [PASS] モバイル向けポインタードラッグ操作とPCキーボード操作の両方に対応。',
        '- [PASS] リトライループ（ゲームオーバー時の即座な再スタート）を確認。',
        '',
        '### 4. Verdict (判定)',
        '- **Critical**: 0 件',
        '- **Warning**: 0 件',
        '- **判定**: `APPROVED` (高品質・本番稼働可能)',
      ].join('\n');
    }

    return `[Sub-agent ${agentType}] Task evaluated successfully. Ready for implementation.`;
  }
}
