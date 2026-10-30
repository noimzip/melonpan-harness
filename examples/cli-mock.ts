import { MelonpanCore } from '../packages/core/src/index.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

async function main() {
  console.log(`\n========================================`);
  console.log(`🍈 Melonpan Agent Harness (Offline Simulation Demo)`);
  console.log(`========================================\n`);

  const core = new MelonpanCore({
    simulate: true,
    mode: 'auto',
  });

  const prompt = '宇宙を舞台にしたジャンプアクションゲーム';
  console.log(`プロンプト: "${prompt}"\n`);

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
      case 'SUBAGENT_DISPATCHED':
        console.log(`[Subagent Dispatched]: ${event.payload.agentType}`);
        break;
      case 'COMPLETE':
        console.log(`\n========================================`);
        console.log(`🎉 [Complete]: シミュレーション生成が正常完了しました！`);
        console.log(`総ターン数: ${event.payload.turns} 回`);
        console.log(`処理所要時間: ${event.payload.durationMs} ms`);
        console.log(`========================================\n`);
        finalHtml = event.payload.files['index.html'] || '';
        break;
      case 'ERROR':
        console.error(`\n❌ [Error]:`, event.payload.error);
        break;
    }
  }

  if (finalHtml) {
    const outputPath = path.resolve(process.cwd(), 'generated-game.html');
    fs.writeFileSync(outputPath, finalHtml, 'utf-8');
    console.log(`📁 成果物HTMLを保存しました: ${outputPath}`);
  }
}

main().catch(console.error);
