import path from 'node:path';
import { CommandDefinition } from '../types.js';

export const exportCommand: CommandDefinition = {
  name: 'export',
  syntax: '/export [path]',
  description: 'メモリ内VFSの全成果物をローカル実ディスク（デフォルト: ./output/）に保存',
  execute: async (args, ctx) => {
    const files =
      typeof (ctx.vfs as any).getFiles === 'function'
        ? (ctx.vfs as any).getFiles()
        : typeof (ctx.vfs as any).getSnapshot === 'function'
        ? (ctx.vfs as any).getSnapshot()
        : {};
    const count = Object.keys(files).length;

    if (count === 0) {
      ctx.logActivity('No deliverables in virtual filesystem to export.');
      ctx.logThought('⚠️ VFS is empty. Run an agent task first to generate files.');
      return;
    }

    const targetDir = args[0]?.trim() || './output/';

    if (targetDir === 'logs' || targetDir === './.melonpan/logs/' || targetDir === '.melonpan/logs') {
      const logsDir = path.resolve('.melonpan/logs');
      ctx.logActivity(`Session logs directory: ${logsDir}`);
      ctx.logThought(`📜 Session transcripts and JSONL logs are saved in: "${logsDir}" (Latest: latest.log)`);
      return;
    }

    try {
      let writtenPaths: string[] = [];
      if (typeof (ctx.vfs as any).flushToDisk === 'function') {
        writtenPaths = await (ctx.vfs as any).flushToDisk(targetDir);
      }
      const fileNames = writtenPaths.map((p: string) => path.basename(p)).join(', ');
      ctx.logActivity(`Exported ${writtenPaths.length} files to ${targetDir}`);
      ctx.logThought(`💾 Saved deliverables to "${targetDir}": ${fileNames}`);
    } catch (err: any) {
      ctx.logActivity(`Export failed: ${err.message}`);
      ctx.logThought(`❌ Error during export: ${err.message}`);
    }
  },
  getSuggestions: (input) => {
    const prefix = '/export ';
    if (!input.startsWith(prefix)) return [];
    return [
      {
        text: '/export ./output/',
        display: './output/',
        description: '標準の出力ディレクトリに出力',
      },
      {
        text: '/export ./',
        display: './',
        description: 'カレントディレクトリ直下に出力',
      },
    ];
  },
};
