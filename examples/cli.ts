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
  if (apiKey) {
    console.log(`🔑 GEMINI_API_KEY detected. Using real Gemini 3.8 Flash.`);
  } else {
    console.log(
      `ℹ️  GEMINI_API_KEY is not set in environment. Running in deterministic simulation mode.`
    );
  }

  const core = new MelonpanCore({
    apiKey,
    model: 'gemini-3.8-flash',
    simulate: !apiKey,
  });

  const eventStream = core.run(prompt);
  let finalHtml = '';

  for await (const event of eventStream) {
    switch (event.type) {
      case 'SKILL_LOADED':
        console.log(`[Skill Loaded]: ${event.payload.name}`);
        break;
      case 'THOUGHT':
        console.log(`[Thought]: ${event.payload.thought}\n`);
        break;
      case 'TOOL_CALL':
        console.log(`[Tool Call]: ${event.payload.name}`);
        break;
      case 'COMPLETE':
        console.log(`\n========================================`);
        console.log(`🎉 [Complete]: タスク完了！`);
        console.log(`ターン数: ${event.payload.turns} 回`);
        console.log(`所要時間: ${event.payload.durationMs} ms`);
        console.log(`========================================\n`);
        finalHtml = event.payload.files['index.html'] || '';
        break;
      case 'ERROR':
        console.error(`\n❌ [Error] (${event.payload.phase}):`, event.payload.error);
        break;
    }
  }

  if (finalHtml) {
    const outputPath = path.resolve(process.cwd(), 'generated-game.html');
    fs.writeFileSync(outputPath, finalHtml, 'utf-8');
    console.log(`📁 生成された成果物を保存しました: ${outputPath}`);
  }
}

main().catch(console.error);
