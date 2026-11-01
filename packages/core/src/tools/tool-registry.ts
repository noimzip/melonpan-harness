import { FunctionDeclaration, Tool } from '@google/genai';
import {
  ITool,
  ToolExecutionContext,
  ToolExecutionResult,
  ToolMiddleware,
} from '../types.js';
import { formatOpenAITools } from './schema-converter.js';


/**
 * プラガブル・ツールレジストリ (Issue #50, #23)
 * - `ITool` プラグインの登録・取得・削除
 * - サブエージェントやスキル用のスコープ制限レジストリ生成 (`createScopedRegistry`)
 * - `ToolMiddleware` パイプラインによる実行前後フック（権限チェック・安全ガード・計測）
 * - Gemini / OpenAI 向けの `FunctionDeclaration` 配列生成
 */
export class ToolRegistry {
  private tools: Map<string, ITool<any>> = new Map();
  private middlewares: ToolMiddleware[] = [];

  constructor(initialTools: ITool<any>[] = [], middlewares: ToolMiddleware[] = []) {
    for (const tool of initialTools) {
      this.register(tool);
    }
    this.middlewares = [...middlewares];
  }

  /**
   * ツールプラグインを登録する（同名ツールは上書き）
   */
  register<TArgs = Record<string, any>>(tool: ITool<TArgs>): this {
    this.tools.set(tool.name, tool);
    return this;
  }

  /**
   * ツールを登録解除する
   */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /**
   * 指定名のツールを取得する
   */
  get(name: string): ITool<any> | undefined {
    return this.tools.get(name);
  }

  /**
   * ツールが登録されているか判定する
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * 登録されている全ツール一覧を取得する
   */
  getAll(): ITool<any>[] {
    return Array.from(this.tools.values());
  }

  /**
   * 登録されている全ツール名一覧を取得する
   */
  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * ミドルウェアを追加登録する (Issue #23)
   */
  use(middleware: ToolMiddleware): this {
    this.middlewares.push(middleware);
    return this;
  }

  /**
   * 現在登録されているミドルウェア一覧を取得する
   */
  getMiddlewares(): ToolMiddleware[] {
    return [...this.middlewares];
  }

  /**
   * 許可されたツール名リスト（または readonly フィルタ）のみで制限した子 ToolRegistry を生成する (Issue #50, #25)
   */
  createScopedRegistry(options: {
    allowedTools?: string[];
    readonly?: boolean;
    includeMiddlewares?: boolean;
  }): ToolRegistry {
    const allowedSet =
      options.allowedTools && options.allowedTools.length > 0
        ? new Set(options.allowedTools.map((t) => t.trim()).filter(Boolean))
        : undefined;

    const filtered: ITool<any>[] = [];
    for (const tool of this.tools.values()) {
      if (allowedSet && !allowedSet.has(tool.name)) {
        continue;
      }
      if (options.readonly && (tool.category === 'write' || tool.category === 'execute')) {
        // allowedTools で明示許可されていない限り、readonly 時は write / execute を除外
        if (!allowedSet || !allowedSet.has(tool.name)) {
          continue;
        }
      }
      filtered.push(tool);
    }

    return new ToolRegistry(
      filtered,
      options.includeMiddlewares !== false ? this.middlewares : []
    );
  }

  /**
   * LLM Function Calling 用の FunctionDeclaration 配列を出力する
   */
  toFunctionDeclarations(): FunctionDeclaration[] {
    return Array.from(this.tools.values()).map((t) => t.declaration);
  }

  /**
   * @google/genai 形式の Tool[] を出力する
   */
  toGeminiTools(): Tool[] {
    const declarations = this.toFunctionDeclarations();
    if (declarations.length === 0) return [];
    return [{ functionDeclarations: declarations }];
  }

  /**
   * OpenAI 互換 (JSON Schema 準拠) の Tool[] を出力する
   */
  toOpenAITools(): any[] {
    return formatOpenAITools(this.toFunctionDeclarations());
  }


  /**
   * 指定されたツールをミドルウェアパイプライン経由で実行する
   */
  async execute(
    name: string,
    args: Record<string, any>,
    ctx: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      const available = this.getToolNames().join(', ');
      return {
        output: `Unknown tool "${name}". Available tools: ${available}.`,
        isError: true,
      };
    }

    const chain = this.middlewares;
    let index = -1;

    const dispatch = async (i: number): Promise<ToolExecutionResult> => {
      if (i <= index) {
        throw new Error('ToolMiddleware next() called multiple times');
      }
      index = i;
      if (i === chain.length) {
        return tool.execute(args || {}, ctx);
      }
      const middleware = chain[i]!;
      return middleware(
        {
          tool,
          args: args || {},
          executionContext: ctx,
        },
        () => dispatch(i + 1)
      );
    };

    try {
      return await dispatch(0);
    } catch (err: any) {
      return {
        output: `Error executing tool "${name}": ${err?.message || String(err)}`,
        isError: true,
      };
    }
  }
}
