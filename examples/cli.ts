import { MelonpanCore } from '../packages/core/src/index.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

async function main() {
  const prompt = process.argv[2] || 'ブロック崩し';
  console.log(`\n========================================`);
  console.log(`🍈 Melonpan Agent Harness (CLI Demo)`);
  console.log(`Input Prompt: "${prompt}"`);
  console.log(`========================================\n`);

  const apiKey = process.env.GEMINI_API_KEY;
  let core: MelonpanCore;

  if (apiKey) {
    console.log(`🔑 GEMINI_API_KEY detected. Using real Gemini 3.8 Flash.`);
    core = new MelonpanCore({
      apiKey,
      model: 'gemini-3.8-flash',
    });
  } else {
    console.warn(
      `⚠️  GEMINI_API_KEY is not set in environment. Falling back to offline MockLLMProvider for demonstration.`
    );
    const { MockLLMProvider } = await import('../packages/core/src/providers/mock.js');
    core = new MelonpanCore({
      provider: new MockLLMProvider({ delayMs: 3 }),
    });
  }

  // 入力を流し込み、イベントをリッスンする
  const eventStream = core.run(prompt);
  let finalHtml = '';

  for await (const event of eventStream) {
    switch (event.type) {
      case 'SKILL_LOADED':
        console.log(`[Skill Loaded]: ${event.payload.name}`);
        break;
      case 'THINKING':
        console.log(`[Thinking]: ${event.payload.message}\n`);
        console.log(`--- [Code Streaming Output] ---`);
        break;
      case 'CODE_CHUNK':
        process.stdout.write(event.payload); // CLIならそのまま出力
        break;
      case 'VALIDATING':
        console.log(`\n-------------------------------`);
        console.log(`[Validating]: ${event.payload.message}`);
        break;
      case 'REPAIRING':
        console.log(
          `\n[Repairing]: エラー検知により自己修復を開始します (Attempt ${event.payload.attempt})`
        );
        for (const err of event.payload.errors) {
          console.log(`  - 修正対象: ${err}`);
        }
        console.log(`--- [Repair Streaming Output] ---`);
        break;
      case 'COMPLETE':
        console.log(`\n========================================`);
        console.log(`🎉 [Complete]: ゲーム生成完了！`);
        console.log(`試行回数: ${event.payload.attempts} 回`);
        console.log(`所要時間: ${event.payload.durationMs} ms`);
        console.log(`========================================\n`);
        finalHtml = event.payload.html;
        break;
      case 'ERROR':
        console.error(`\n❌ [Error] (${event.payload.phase}):`, event.payload.error);
        break;
    }
  }

  if (finalHtml) {
    const outputPath = path.resolve(process.cwd(), 'generated-game.html');
    fs.writeFileSync(outputPath, finalHtml, 'utf-8');
    console.log(`📁 生成されたゲームを保存しました: ${outputPath}`);
  }
}

main().catch(console.error);
