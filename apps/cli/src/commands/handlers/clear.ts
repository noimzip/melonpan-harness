import { CommandDefinition } from '../types.js';

export const clearCommand: CommandDefinition = {
  name: 'clear',
  syntax: '/clear',
  description: '会話履歴・コンテキストウィンドウを初期化（セッションリセット）',
  execute: (_args, ctx) => {
    ctx.clearSession();
    ctx.logActivity('Session and conversation history cleared.');
    ctx.logThought('🧹 Session context reset. Ready for new task.');
  },
};
