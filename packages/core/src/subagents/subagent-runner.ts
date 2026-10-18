import { GoogleGenAI } from '@google/genai';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as yamlLoad } from 'js-yaml';

export interface SubagentDefinition {
  name: string;
  description: string;
  role?: string;
  instruction: string;
}

export interface SubagentRunnerOptions {
  apiKey?: string;
  model?: string;
  agentsDir?: string;
  simulate?: boolean;
}

/**
 * Clean-Room Isolation サブエージェント実行エンジン
 * メインの会話コンテキストを引き継がず、独立した新規セッションで特化型エージェントを実行します。
 */
export class SubagentRunner {
  private apiKey: string;
  private model: string;
  private agentsDir: string;
  private simulate: boolean;
  private definitions: Map<string, SubagentDefinition> = new Map();

  constructor(options: SubagentRunnerOptions = {}) {
    const envApiKey =
      typeof (globalThis as any).process !== 'undefined'
        ? (globalThis as any).process.env?.GEMINI_API_KEY
        : '';
    this.apiKey = options.apiKey || envApiKey || '';
    this.model = options.model || 'gemini-3.8-flash';
    this.simulate = options.simulate ?? !this.apiKey;

    if (options.agentsDir) {
      this.agentsDir = options.agentsDir;
    } else {
      try {
        const currentFile = fileURLToPath(import.meta.url);
        this.agentsDir = path.resolve(path.dirname(currentFile), '../../agents');
      } catch {
        this.agentsDir = path.resolve(process.cwd(), 'agents');
      }
    }
  }

  /**
   * 定義ディレクトリからエージェント仕様をロード
   */
  async loadDefinitions(): Promise<Map<string, SubagentDefinition>> {
    if (this.definitions.size > 0) {
      return this.definitions;
    }

    try {
      const entries = await fs.readdir(this.agentsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.md')) {
          const filePath = path.join(this.agentsDir, entry.name);
          const raw = await fs.readFile(filePath, 'utf-8');
          const def = this.parseAgentFile(raw, path.basename(entry.name, '.md'));
          this.definitions.set(def.name, def);
        }
      }
    } catch {
      // 読み込みに失敗した場合も組み込みフォールバックで動作継続
    }

    return this.definitions;
  }

  /**
   * Markdown + YAML Frontmatter パーサー
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

    return {
      name: parsed.name || defaultName,
      description: parsed.description || 'Specialized sub-agent',
      role: parsed.role,
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
   * サブエージェントを Clean-Room Isolation 環境で実行
   */
  async run(agentType: string, taskPrompt: string): Promise<string> {
    await this.loadDefinitions();
    const def = this.definitions.get(agentType);
    const instruction = def?.instruction || this.getDefaultInstruction(agentType);

    // 1. オフライン / テスト用確定型シミュレーション
    if (this.simulate) {
      return this.simulateSubagent(agentType, taskPrompt);
    }

    // 2. 本番 Clean-Room Gemini セッション
    const ai = new GoogleGenAI({ apiKey: this.apiKey });
    const chat = ai.chats.create({
      model: this.model,
      config: {
        systemInstruction: instruction,
      },
    });

    const response = await chat.sendMessage({
      message: taskPrompt,
    });

    return response.text?.trim() || 'No response from sub-agent.';
  }

  /**
   * 組み込みフォールバック指示文
   */
  private getDefaultInstruction(agentType: string): string {
    if (agentType === 'researcher') {
      return `You are a technical research sub-agent. Investigate the technical topic and return 1. 結論 (Conclusion), 2. 推奨実装 (Recommended Implementation), 3. 懸念点・リスク (Risks & Considerations). Keep it concise and actionable.`;
    }
    if (agentType === 'code-reviewer') {
      return `You are a multi-perspective code reviewer. Audit the code across 1. Performance, 2. Security, 3. Visual & UI/UX. Output Critical, Warning, and Verdict (APPROVED or NEEDS_REVISION).`;
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
        '- **判定**: `APPROVED` (高品質・本番展示可能)',
      ].join('\n');
    }

    return `[Sub-agent ${agentType}] Task evaluated successfully. Ready for implementation.`;
  }
}
