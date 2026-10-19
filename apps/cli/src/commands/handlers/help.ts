import { CommandDefinition } from '../types.js';

export const helpCommand: CommandDefinition = {
  name: 'help',
  syntax: '/help',
  description: '利用可能な全スラッシュコマンドの一覧と操作説明を表示',
  execute: (_args, ctx) => {
    const helpLines = [
      '📖 Melonpan TUI スラッシュコマンド一覧:',
      '  • /model [name]   : モデルの表示・切り替え (gemini-3.8-flash, gemini-4-argon, etc.)',
      '  • /effort [level] : 推論レベルの変更 (minimal, low, medium, high)',
      '  • /plan [prompt]  : Plan Mode トグル (引数なし) または指定プロンプトで即時実行',
      '  • /clear          : 会話履歴・セッションをリセット',
      '  • /export [path]  : VFS成果物を実ディスク (デフォルト: ./output/) に一括保存',
      '  • /skills [sub]   : スキルの状態一覧 (list) や有効化/無効化 (enable/disable <name>)',
      '  • /cost           : セッション累計トークン数と概算費用 (USD / JPY) を表示',
      '  • /key [api-key]  : Gemini APIキーの設定・確認・.env保存 (/key save <key>)',
      '  • /help           : このヘルプを表示',
      '',
      '💡 オートコンプリート: 入力欄で "/" を押すと補完候補が表示されます。[Tab / Enter] で選択。',
    ];

    ctx.logActivity('Displayed help information.');
    for (const line of helpLines) {
      ctx.logThought(line);
    }
  },
};
