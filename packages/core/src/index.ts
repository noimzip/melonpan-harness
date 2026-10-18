import { AgentLoop } from './agent-loop.js';
import { GeminiProvider } from './providers/gemini.js';
import { SkillManager } from './skills/skill-manager.js';
import { HtmlValidator } from './validator/html-validator.js';
import {
  AgentEvent,
  HtmlValidatorInterface,
  LLMProvider,
  MelonpanCoreOptions,
} from './types.js';

/**
 * MelonpanCore - 自律エージェントハーネスのメインエントリーポイント
 *
 * Headless & UI非依存: Pure TypeScript + Web標準APIベース。
 * Event-Driven: 思考からコード生成・検証・自己修復までをAsyncIterableストリームで配信。
 * Progressive Disclosure: 必要なスキルのみをオンデマンドで注入。
 */
export class MelonpanCore {
  private skillManager: SkillManager;
  private provider: LLMProvider;
  private validator: HtmlValidatorInterface;
  private agentLoop: AgentLoop;

  constructor(options: MelonpanCoreOptions = {}) {
    this.skillManager =
      options.skillManager ??
      new SkillManager({ disablePresets: options.disablePresets });

    this.provider =
      options.provider ??
      new GeminiProvider({
        apiKey: options.apiKey,
        model: options.model ?? 'gemini-3.8-flash',
        baseUrl: options.baseUrl,
      });

    this.validator = options.validator ?? new HtmlValidator();

    this.agentLoop = new AgentLoop(
      this.skillManager,
      this.provider,
      this.validator,
      {
        maxRepairs: options.maxRepairs,
        temperature: options.temperature,
      }
    );
  }

  /**
   * ユーザー指示（プロンプト）を入力し、エージェントイベントストリームを開始する
   */
  run(input: string): AsyncIterable<AgentEvent> {
    return this.agentLoop.run(input);
  }

  /**
   * スキルマネージャーのインスタンスを取得する
   */
  getSkillManager(): SkillManager {
    return this.skillManager;
  }

  /**
   * 設定されているLLMプロバイダーを取得する
   */
  getProvider(): LLMProvider {
    return this.provider;
  }

  /**
   * 設定されているHTMLバリデーターを取得する
   */
  getValidator(): HtmlValidatorInterface {
    return this.validator;
  }
}

// 共通型・各モジュールのエクスポート
export * from './types.js';
export * from './skills/index.js';
export * from './providers/index.js';
export * from './validator/index.js';
export * from './agent-loop.js';
