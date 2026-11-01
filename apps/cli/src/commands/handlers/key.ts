import fs from 'node:fs/promises';
import path from 'node:path';
import { CommandDefinition, CommandSuggestion } from '../types.js';

export function maskApiKey(key?: string): string {
  if (!key) return '(not set)';
  const trimmed = key.trim();
  if (trimmed.length <= 8) return '****';
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`;
}

export async function saveKeyToEnv(
  apiKey: string,
  baseDir: string = process.cwd(),
  envVarName: string = 'GEMINI_API_KEY'
): Promise<string> {
  const envPath = path.resolve(baseDir, '.env');
  let content = '';
  try {
    content = await fs.readFile(envPath, 'utf-8');
  } catch {
    content = '';
  }

  const lineRegex = new RegExp(`^${envVarName}=.*$`, 'm');
  const newLine = `${envVarName}=${apiKey}`;

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
  syntax: '/key [api-key | clear | save <api-key> | status | openai <key> | anthropic <key> | openrouter <key> | orcarouter <key> | groq <key>]',
  description: 'マルチプロバイダーAPIキー (Gemini, OpenAI, Anthropic, OpenRouter, OrcaRouter, Groq) の設定・確認・.env保存',
  execute: async (args, ctx) => {
    const sub = args[0]?.trim();

    // 1. Status check / Help
    if (!sub || sub.toLowerCase() === 'status') {
      const geminiKey = ctx.apiKey || (typeof process !== 'undefined' ? process.env?.GEMINI_API_KEY : '');
      const openaiKey = typeof process !== 'undefined' ? process.env?.OPENAI_API_KEY : '';
      const anthropicKey = typeof process !== 'undefined' ? process.env?.ANTHROPIC_API_KEY : '';
      const openrouterKey = typeof process !== 'undefined' ? process.env?.OPENROUTER_API_KEY : '';
      const orcarouterKey = typeof process !== 'undefined' ? process.env?.ORCAROUTER_API_KEY : '';
      const groqKey = typeof process !== 'undefined' ? process.env?.GROQ_API_KEY : '';

      const maskedGemini = maskApiKey(geminiKey);
      const maskedOpenAI = maskApiKey(openaiKey);
      const maskedAnthropic = maskApiKey(anthropicKey);
      const maskedOpenRouter = maskApiKey(openrouterKey);
      const maskedOrcaRouter = maskApiKey(orcarouterKey);
      const maskedGroq = maskApiKey(groqKey);

      const isLive = Boolean(ctx.apiKey) && !ctx.isSimulate;
      const engineMode = isLive
        ? '🟢 Live (Real Model API)'
        : '🟡 Simulation (Offline Mock)';

      ctx.logActivity(`API Key: ${maskedGemini} | Engine: ${isLive ? 'Live' : 'Simulation'}`);
      ctx.logThought(`🔑 Gemini API Key Status:`);
      ctx.logThought(`  • Active Key    : ${maskedGemini}`);
      ctx.logThought(`  • OpenAI Key    : ${maskedOpenAI}`);
      ctx.logThought(`  • Anthropic     : ${maskedAnthropic}`);
      ctx.logThought(`  • OpenRouter    : ${maskedOpenRouter}`);
      ctx.logThought(`  • OrcaRouter    : ${maskedOrcaRouter}`);
      ctx.logThought(`  • Groq          : ${maskedGroq}`);
      ctx.logThought(`  • Engine Mode   : ${engineMode}`);

      ctx.logThought(`  ───────────────────────────────────────────`);
      ctx.logThought(`💡 Usage:`);
      ctx.logThought(`  • /key <api-key>             : Gemini APIキーを設定し本番Liveモードを有効化`);
      ctx.logThought(`  • /key openai <api-key>      : OpenAI APIキーを設定`);
      ctx.logThought(`  • /key anthropic <api-key>   : Anthropic APIキーを設定`);
      ctx.logThought(`  • /key openrouter <api-key>  : OpenRouter APIキーを設定`);
      ctx.logThought(`  • /key orcarouter <api-key>  : OrcaRouter APIキーを設定`);
      ctx.logThought(`  • /key groq <api-key>        : Groq APIキーを設定`);
      ctx.logThought(`  • /key save <api-key>        : APIキーを設定してカレントディレクトリの .env に永続保存`);
      ctx.logThought(`  • /key clear                 : 全APIキーを破棄しシミュレーションモードに戻す`);
      return;
    }

    // 2. Clear API Key
    if (sub.toLowerCase() === 'clear') {
      if (ctx.setApiKey) {
        ctx.setApiKey('');
      }
      if (typeof process !== 'undefined' && process.env) {
        delete process.env.GEMINI_API_KEY;
        delete process.env.OPENAI_API_KEY;
        delete process.env.ANTHROPIC_API_KEY;
        delete process.env.OPENROUTER_API_KEY;
        delete process.env.ORCAROUTER_API_KEY;
        delete process.env.GROQ_API_KEY;
      }
      if (ctx.setSimulate) {
        ctx.setSimulate(true);
      }
      if (ctx.refreshModels) {
        await ctx.refreshModels();
      }
      ctx.logActivity('API key cleared. Switched to offline simulation mode.');
      ctx.logThought('🗑️ API key removed. Melonpan is now running in offline simulation mode.');
      return;
    }

    // 3. Provider-specific key set (e.g. /key openai sk-..., /key anthropic sk-ant-..., /key openrouter sk-or-...)
    const knownProviders = ['gemini', 'openai', 'anthropic', 'openrouter', 'orcarouter', 'groq'];
    if (knownProviders.includes(sub.toLowerCase())) {
      const provider = sub.toLowerCase();
      const targetKey = args[1]?.trim();
      if (!targetKey) {
        ctx.logActivity(`Usage: /key ${provider} <api-key>`);
        ctx.logThought(`⚠️ Please provide an API key: /key ${provider} <your-api-key>`);
        return;
      }

      const envMap: Record<string, string> = {
        gemini: 'GEMINI_API_KEY',
        openai: 'OPENAI_API_KEY',
        anthropic: 'ANTHROPIC_API_KEY',
        openrouter: 'OPENROUTER_API_KEY',
        orcarouter: 'ORCAROUTER_API_KEY',
        groq: 'GROQ_API_KEY',
      };
      const envVar = envMap[provider] || `${provider.toUpperCase()}_API_KEY`;
      if (typeof process !== 'undefined' && process.env) {
        process.env[envVar] = targetKey;
      }
      if (provider === 'gemini') {
        if (ctx.setApiKey) ctx.setApiKey(targetKey);
        if (ctx.setSimulate) ctx.setSimulate(false);
      }
      if (ctx.refreshModels) {
        await ctx.refreshModels();
      }
      const masked = maskApiKey(targetKey);
      ctx.logActivity(`${provider.toUpperCase()} API key set (${masked})`);
      ctx.logThought(`🔑 ${provider.toUpperCase()} API key configured: [${masked}]`);
      return;
    }

    // 4. Save API Key to .env
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
        if (ctx.refreshModels) {
          await ctx.refreshModels();
        }
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

    // 5. Set API Key directly (/key <api-key>)
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
    if (ctx.refreshModels) {
      await ctx.refreshModels();
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

    // Standard 3 options
    const baseOptions: CommandSuggestion[] = [
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
      return baseOptions;
    }

    const allOptions = [
      ...baseOptions,
      {
        text: `${matchedPrefix}openai `,
        display: 'openai <key>',
        description: 'OpenAI APIキーを設定',
      },
      {
        text: `${matchedPrefix}anthropic `,
        display: 'anthropic <key>',
        description: 'Anthropic APIキーを設定',
      },
      {
        text: `${matchedPrefix}openrouter `,
        display: 'openrouter <key>',
        description: 'OpenRouter APIキーを設定',
      },
      {
        text: `${matchedPrefix}orcarouter `,
        display: 'orcarouter <key>',
        description: 'OrcaRouter APIキーを設定',
      },
      {
        text: `${matchedPrefix}groq `,
        display: 'groq <key>',
        description: 'Groq APIキーを設定',
      },
    ];

    return allOptions.filter((opt) => opt.display.toLowerCase().startsWith(remainder));
  },
};

