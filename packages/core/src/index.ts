import { ReactAgent } from './react-agent.js';
import { SkillManager } from './skills/skill-manager.js';
import { AgentEvent, MelonpanCoreOptions } from './types.js';
import { VirtualFS } from './vfs/virtual-fs.js';

/**
 * MelonpanCore - Agent Skills標準仕様準拠・本格ReAct自律エージェントハーネス
 *
 * 1. Agent Skills Standard Specification (agentskills.io)
 *    YAML Frontmatterによる軽量インデックス化とオンデマンドMarkdown本文ロード (Progressive Disclosure)
 * 2. ReAct自律ループ (Reasoning + Acting)
 *    Gemini API Function Callingによる Thought ⇄ Action ⇄ Observation の自律実行
 * 3. メモリ内仮想ファイルシステム (VirtualFS)
 *    write_file, edit_file による安全な差分修正とファイル管理
 */
export class MelonpanCore {
  private skillManager: SkillManager;
  private agent: ReactAgent;
  private vfs: VirtualFS;

  constructor(options: MelonpanCoreOptions = {}) {
    this.skillManager = new SkillManager({ skillsDir: options.skillsDir });
    this.vfs = options.vfs ?? new VirtualFS();
    this.agent = new ReactAgent({
      apiKey: options.apiKey,
      model: options.model ?? 'gemini-3.8-flash',
      thinkingLevel: options.thinkingLevel ?? 'high',
      maxTurns: options.maxTurns,
      simulate: options.simulate,
      mode: options.mode,
      agentsDir: options.agentsDir,
    });
  }

  /**
   * ユーザー入力を受け取り、スキル動的解決・ReActループの全イベントストリームを送出する
   */
  async *run(prompt: string): AsyncGenerator<AgentEvent, void, unknown> {
    // 1. スキルメタデータの軽量インデックス化
    const indexed = await this.skillManager.loadAllMetadata();
    yield {
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
    };

    // 2. プロンプトに応じたスキルの動的解決と本文ロード (Progressive Disclosure)
    const skill = await this.skillManager.resolveAndLoad(prompt);
    if (!skill) {
      yield {
        type: 'ERROR',
        payload: {
          error: new Error(`No matching skill found for input: "${prompt}"`),
          phase: 'resolution',
        },
        timestamp: Date.now(),
      };
      return;
    }

    yield {
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
    };

    // 3. ReAct 自律ループの実行
    yield* this.agent.execute(prompt, skill, this.vfs);
  }

  /**
   * 仮想ファイルシステム内の全成果物（ファイルパス: 内容）を取得
   */
  getVirtualFiles(): Record<string, string> {
    return this.vfs.getFiles();
  }

  /**
   * 仮想ファイルシステムインスタンスを取得
   */
  getVFS(): VirtualFS {
    return this.vfs;
  }

  /**
   * スキルマネージャーインスタンスを取得
   */
  getSkillManager(): SkillManager {
    return this.skillManager;
  }
}

// 全型および各サブモジュールのエクスポート
export * from './types.js';
export * from './skills/index.js';
export * from './vfs/index.js';
export * from './tools/index.js';
export * from './subagents/index.js';
export * from './react-agent.js';
