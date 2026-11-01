import { CommandDefinition } from '../types.js';

export const compactCommand: CommandDefinition = {
  name: 'compact',
  syntax: '/compact [instructions]',
  description: '現在の会話履歴を手動で要約・圧縮してコンテキストウィンドウを解放',
  execute: async (args, ctx) => {
    const instructions = args.join(' ').trim() || undefined;

    ctx.logActivity('Compacting conversation context...');
    ctx.logThought('🗜️ Triggered context compaction strategy...');

    if (ctx.compactSession) {
      try {
        await ctx.compactSession(instructions);
        ctx.logActivity('Context successfully compacted');
      } catch (err: any) {
        ctx.logActivity(`Compaction failed: ${err.message}`);
        ctx.logThought(`❌ Compaction error: ${err.message}`);
      }
    } else if (ctx.core?.getSession()) {
      try {
        const compacted = await ctx.core.getSession().compact({ force: true });
        if (compacted) {
          const ratio = Math.round(compacted.reductionRatio * 100);
          ctx.logActivity(
            `Context compacted: ${compacted.beforeTokens} -> ${compacted.afterTokens} tokens (${ratio}% saved)`
          );
          ctx.logThought(
            `🗜️ Context Compacted: ${compacted.beforeTokens} -> ${compacted.afterTokens} tokens (${ratio}% saved, ${compacted.savedTokens} tokens freed)`
          );
        } else {
          ctx.logActivity('No compaction needed (history within compact threshold)');
          ctx.logThought('ℹ️ Conversation history is already compact.');
        }
      } catch (err: any) {
        ctx.logActivity(`Compaction error: ${err.message}`);
        ctx.logThought(`❌ Compaction error: ${err.message}`);
      }
    } else {
      ctx.logActivity('Context compaction not available in current session');
    }
  },
  getSuggestions: (input) => {
    const prefix = '/compact ';
    if (!input.startsWith(prefix)) return [];
    return [
      {
        text: '/compact Preserve code diffs and plan',
        display: '<instructions>',
        description: 'Optional focus instructions for context summarizer',
      },
    ];
  },
};
