import { SkillManager } from './skills/skill-manager.js';
import { HtmlValidator } from './validator/html-validator.js';
import {
  AgentEvent,
  AgentLoopOptions,
  HtmlValidatorInterface,
  LLMProvider,
} from './types.js';

/**
 * Melonpan エージェントループ
 * スキル解決、コード生成ストリーム、構文検証、自動修復ループの状態遷移を統括します。
 */
export class AgentLoop {
  private skillManager: SkillManager;
  private provider: LLMProvider;
  private validator: HtmlValidatorInterface;
  private maxRepairs: number;
  private temperature?: number;

  constructor(
    skillManager: SkillManager,
    provider: LLMProvider,
    validator: HtmlValidatorInterface = new HtmlValidator(),
    options: AgentLoopOptions = {}
  ) {
    this.skillManager = skillManager;
    this.provider = provider;
    this.validator = validator;
    this.maxRepairs = options.maxRepairs ?? 2;
    this.temperature = options.temperature;
  }

  /**
   * ユーザー入力を受け取り、生成プロセスのイベントストリームを送出する
   */
  async *run(input: string): AsyncGenerator<AgentEvent, void, unknown> {
    const startTime = Date.now();

    try {
      // 1. スキル判定・解決
      const skill = await this.skillManager.resolve(input);
      if (!skill) {
        yield {
          type: 'ERROR',
          payload: {
            error: new Error(`No matching skill found for input: "${input}"`),
            phase: 'resolution',
          },
          timestamp: Date.now(),
        };
        return;
      }

      // SKILL_LOADED イベント送出
      yield {
        type: 'SKILL_LOADED',
        payload: {
          id: skill.id,
          name: skill.name,
          description: skill.description,
        },
        timestamp: Date.now(),
      };

      // THINKING イベント送出
      yield {
        type: 'THINKING',
        payload: {
          message: `Designing game based on request: "${input}" using skill [${skill.name}]`,
        },
        timestamp: Date.now(),
      };

      // 指示文のオンデマンド取得
      const systemInstruction = await skill.getInstruction();

      let currentPrompt = input;
      let attempt = 1;
      const maxAttempts = this.maxRepairs + 1;

      while (attempt <= maxAttempts) {
        let accumulatedCode = '';

        // 2. コードストリーミング生成
        try {
          const stream = this.provider.generateStream({
            systemInstruction,
            prompt: currentPrompt,
            temperature: this.temperature,
          });

          for await (const chunk of stream) {
            accumulatedCode += chunk;
            yield {
              type: 'CODE_CHUNK',
              payload: chunk,
              timestamp: Date.now(),
            };
          }
        } catch (genErr: any) {
          yield {
            type: 'ERROR',
            payload: {
              error: genErr instanceof Error ? genErr : new Error(String(genErr)),
              phase: 'generation',
            },
            timestamp: Date.now(),
          };
          return;
        }

        // 3. 構文チェック・検証
        yield {
          type: 'VALIDATING',
          payload: {
            attempt,
            message: `Validating HTML structure, Canvas loop, and JavaScript syntax (Attempt ${attempt}/${maxAttempts})...`,
          },
          timestamp: Date.now(),
        };

        const validation = this.validator.validate(accumulatedCode);

        if (validation.valid) {
          // 4. 正常完了 (COMPLETE)
          const durationMs = Date.now() - startTime;
          yield {
            type: 'COMPLETE',
            payload: {
              html: validation.sanitizedHtml || accumulatedCode,
              attempts: attempt,
              durationMs,
            },
            timestamp: Date.now(),
          };
          return;
        }

        // 構文エラー検知: 修復可能か判定
        if (attempt < maxAttempts) {
          // 5. 自己修復中 (REPAIRING)
          const repairInstruction =
            `The previously generated HTML game had the following critical errors:\n` +
            validation.errors.map((e) => `- ${e}`).join('\n') +
            `\n\nPrevious code snippet:\n${accumulatedCode.slice(0, 1500)}...\n\n` +
            `Please fix ALL the errors above. Output ONLY the complete, corrected, standalone single-file HTML code.`;

          yield {
            type: 'REPAIRING',
            payload: {
              attempt,
              errors: validation.errors,
              instruction: repairInstruction,
            },
            timestamp: Date.now(),
          };

          currentPrompt =
            `${input}\n\n[ATTENTION: The previous attempt failed validation with these errors: ${validation.errors.join(
              ', '
            )}. Please produce the complete, corrected, standalone single-file HTML game.]`;

          attempt++;
        } else {
          // 修復上限に達しても解決しなかった場合
          yield {
            type: 'ERROR',
            payload: {
              error: new Error(
                `Code validation failed after ${attempt} attempts: ${validation.errors.join(
                  '; '
                )}`
              ),
              phase: 'validation',
            },
            timestamp: Date.now(),
          };
          return;
        }
      }
    } catch (unexpectedErr: any) {
      yield {
        type: 'ERROR',
        payload: {
          error:
            unexpectedErr instanceof Error
              ? unexpectedErr
              : new Error(String(unexpectedErr)),
          phase: 'execution',
        },
        timestamp: Date.now(),
      };
    }
  }
}
