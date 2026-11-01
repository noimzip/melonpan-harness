import { CommandDefinition } from '../types.js';

export const helpCommand: CommandDefinition = {
  name: 'help',
  syntax: '/help',
  description: '利用可能な全スラッシュコマンドの一覧と操作説明を表示',
  execute: (_args, ctx) => {
    const helpLines = [
      '📖 Melonpan TUI スラッシュコマンド一覧:',
      '  • /model [name]       : モデルの表示・検索・切り替え (Gemini, OpenAI, Anthropic, OpenRouter, OrcaRouter, Groq)',
      '  • /boost [name]       : /model と同等。各種APIから取得できたモデルを表示・検索・切り替え',
      '  • /effort [level]     : 推論レベルの変更 (minimal, low, medium, high)',
      '  • /goal [objective]   : フル自律目標達成モード（サブエージェント解禁・徹底テスト・監査）',
      '  • /plan [prompt]      : Plan Mode トグル (引数なし) または指定プロンプトで即時実行',
      '  • /permissions [mode] : ツール実行権限モードの確認・切り替え (auto / ask / strict)',
      '  • /agents [name]      : 利用可能なサブエージェント一覧と許可ツール詳細の表示',
      '  • /compact [instr]    : 会話履歴を手動要約・圧縮してコンテキストウィンドウを解放',
      '  • /clear              : 会話履歴・セッションをリセット',
      '  • /export [path]      : 成果物を実ディスク (デフォルト: ./output/) に一括保存',
      '  • /skills [sub]       : スキルの状態一覧 (list) や有効化/無効化 (enable/disable <name>)',
      '  • /cost               : セッション累計課金トークンと現在のコンテキストウィンドウ占有量を表示',
      '  • /key [api-key]      : APIキーの設定・確認・.env保存 (Gemini, OpenAI, Anthropic, OpenRouter, OrcaRouter, Groq)',
      '  • /help               : このヘルプを表示',
      '',
      '💡 オートコンプリート: 入力欄で "/" を押すと補完候補が表示されます。[Tab] で補完適用、[Esc] でキャンセル。',
      '⚡ ショートカット: [Esc] 実行キャンセル / [PageUp/Down] 履歴スクロール / [y/a/n] 権限承認',
    ];

    ctx.logActivity('Displayed help information.');
    for (const line of helpLines) {
      ctx.logThought(line);
    }
  },
};
