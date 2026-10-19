import fs from 'node:fs/promises';
import path from 'node:path';
import { CommandDefinition, CommandSuggestion } from '../types.js';

export function maskApiKey(key?: string): string {
  if (!key) return '(not set)';
  const trimmed = key.trim();
  if (trimmed.length <= 8) return '****';
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`;
}

export async function saveKeyToEnv(apiKey: string, baseDir: string = process.cwd()): Promise<string> {
  const envPath = path.resolve(baseDir, '.env');
  let content = '';
  try {
    content = await fs.readFile(envPath, 'utf-8');
  } catch {
    content = '';
  }

  const lineRegex = /^GEMINI_API_KEY=.*$/m;
  const newLine = `GEMINI_API_KEY=${apiKey}`;

  let newContent = '';
  if (lineRegex.test(content)) {
    newContent = content.replace(lineRegex, newLine);
  } else {
    newContent = content ? `${content.trimEnd()}\n${newLine}\n` : `${newLine}\n`;
  }

  await fs.writeFile(envPath, newContent, 'utf-8');
  return envPath;
}

export const keyCommand: CommandDefinition = {
  name: 'key',
  aliases: ['apikey', 'api-key'],
  syntax: '/key [api-key | clear | save <api-key> | status]',
  description: 'Gemini APIキーの設定・確認・.env保存・クリア',
  execute: async (args, ctx) => {
    const sub = args[0]?.trim();

    // 1. Status check / Help
    if (!sub || sub.toLowerCase() === 'status') {
      const masked = maskApiKey(ctx.apiKey);
      const isLive = Boolean(ctx.apiKey) && !ctx.isSimulate;
      const engineMode = isLive
        ? '🟢 Live (Real Gemini API)'
        : '🟡 Simulation (Offline Mock)';

      ctx.logActivity(`API Key: ${masked} | Engine: ${isLive ? 'Live' : 'Simulation'}`);
      ctx.logThought(`🔑 Gemini API Key Status:`);
      ctx.logThought(`  • Active Key  : ${masked}`);
      ctx.logThought(`  • Engine Mode : ${engineMode}`);
      ctx.logThought(`  ───────────────────────────────────────────`);
      ctx.logThought(`💡 Usage:`);
      ctx.logThought(`  • /key <api-key>      : APIキーを設定し本番Gemini APIモードを有効化`);
      ctx.logThought(`  • /key save <api-key> : APIキーを設定してカレントディレクトリの .env に永続保存`);
      ctx.logThought(`  • /key clear          : APIキーを破棄しシミュレーションモードに戻す`);
      return;
    }

    // 2. Clear API Key
    if (sub.toLowerCase() === 'clear') {
      if (ctx.setApiKey) {
        ctx.setApiKey('');
      }
      if (typeof process !== 'undefined' && process.env) {
        delete process.env.GEMINI_API_KEY;
      }
      if (ctx.setSimulate) {
        ctx.setSimulate(true);
      }
      ctx.logActivity('API key cleared. Switched to offline simulation mode.');
      ctx.logThought('🗑️ API key removed. Melonpan is now running in offline simulation mode.');
      return;
    }

    // 3. Save API Key to .env
    if (sub.toLowerCase() === 'save') {
      const targetKey = args[1]?.trim() || ctx.apiKey;
      if (!targetKey) {
        ctx.logActivity('Usage: /key save <api-key>');
        ctx.logThought('⚠️ Please provide an API key to save: /key save <your-api-key>');
        return;
      }

      if (ctx.setApiKey) {
        ctx.setApiKey(targetKey);
      }
      if (typeof process !== 'undefined' && process.env) {
        process.env.GEMINI_API_KEY = targetKey;
      }
      if (ctx.setSimulate) {
        ctx.setSimulate(false);
      }

      try {
        await saveKeyToEnv(targetKey);
        const masked = maskApiKey(targetKey);
        ctx.logActivity(`API key saved to .env (${masked})`);
        ctx.logThought(`💾 API key [${masked}] saved to .env file in current directory.`);
        ctx.logThought(`⚡ Live Gemini API mode activated.`);
      } catch (err: any) {
        ctx.logActivity(`Failed to save .env: ${err.message}`);
        ctx.logThought(`❌ Error writing .env: ${err.message}`);
      }
      return;
    }

    // 4. Set API Key directly (/key <api-key>)
    const newKey = sub;
    if (newKey.length < 8) {
      ctx.logActivity('Warning: Provided API key seems too short.');
    }

    if (ctx.setApiKey) {
      ctx.setApiKey(newKey);
    }
    if (typeof process !== 'undefined' && process.env) {
      process.env.GEMINI_API_KEY = newKey;
    }
    if (ctx.setSimulate) {
      ctx.setSimulate(false);
    }

    const masked = maskApiKey(newKey);
    ctx.logActivity(`API key set (${masked}). Live mode active.`);
    ctx.logThought(`🔑 Gemini API key configured: [${masked}]`);
    ctx.logThought(`⚡ Live Gemini API mode activated. Real model inferences will now be executed.`);
  },

  getSuggestions: (input) => {
    const matchedPrefix = ['/key ', '/apikey ', '/api-key '].find((p) =>
      input.startsWith(p)
    );
    if (!matchedPrefix) return [];

    const remainder = input.slice(matchedPrefix.length).trimStart().toLowerCase();

    const options: CommandSuggestion[] = [
      {
        text: `${matchedPrefix}status`,
        display: 'status',
        description: '現在のAPIキー設定状態と接続モードを確認',
      },
      {
        text: `${matchedPrefix}clear`,
        display: 'clear',
        description: '設定中のAPIキーをクリアしてシミュレーションモードに戻す',
      },
      {
        text: `${matchedPrefix}save `,
        display: 'save <key>',
        description: 'APIキーを設定しローカルの .env に永続保存',
      },
    ];

    if (!remainder) {
      return options;
    }

    return options.filter((opt) => opt.display.toLowerCase().startsWith(remainder));
  },
};
