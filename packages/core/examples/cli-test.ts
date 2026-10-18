import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MelonpanCore } from '../src/index.js';

async function main() {
  const currentFile = fileURLToPath(import.meta.url);
  const coreDir = path.resolve(path.dirname(currentFile), '..');
  const skillsDir = path.resolve(coreDir, 'skills');

  const prompt = process.argv[2] || 'ネオンサイバーなブロック崩しゲームを作って';

  console.log('================================================================');
  console.log('🍈 Melonpan Core - Agent Skills & ReAct 自律エージェントテスト');
  console.log(`プロンプト: "${prompt}"`);
  console.log('================================================================\n');

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.log('ℹ️  GEMINI_API_KEY is not set in environment.');
    console.log('   Running in deterministic ReAct simulation mode.\n');
  } else {
    console.log('🔑 GEMINI_API_KEY detected. Connecting to Gemini 3.8 Flash.\n');
  }

  const core = new MelonpanCore({
    apiKey,
    model: 'gemini-3.8-flash',
    skillsDir,
    simulate: !apiKey,
  });

  const eventStream = core.run(prompt);
  let finalFiles: Record<string, string> = {};

  for await (const event of eventStream) {
    const timestampStr = new Date(event.timestamp).toISOString().split('T')[1].slice(0, 8);

    switch (event.type) {
      case 'SKILL_INDEXED':
        console.log(`[${timestampStr}] 📚 [SKILL_INDEXED] メタデータ軽量インデックス完了: ${event.payload.count} 件`);
        for (const skill of event.payload.skills) {
          console.log(`  - スキル名: ${skill.name}`);
          console.log(`    説明: ${skill.description.slice(0, 90)}...`);
        }
        console.log('');
        break;

      case 'SKILL_LOADED':
        console.log(`[${timestampStr}] 🎯 [SKILL_LOADED] スキル動的解決 & 本文オンデマンド読み込み成功:`);
        console.log(`  - 適用スキル: ${event.payload.name}`);
        console.log(`  - ファイルパス: ${event.payload.filePath}`);
        console.log(`  - 指示本文プレビュー:\n    ${event.payload.instructionPreview.replace(/\n/g, '\n    ')}\n`);
        break;

      case 'THOUGHT':
        console.log(`[${timestampStr}] 🧠 [THOUGHT / 推論]`);
        console.log(`  ${event.payload.thought}\n`);
        break;

      case 'TOOL_CALL':
        console.log(`[${timestampStr}] 🛠️  [TOOL_CALL / 行動] -> ${event.payload.name}()`);
        if (event.payload.name === 'write_file') {
          console.log(`  - Path: "${event.payload.args.path}" (${event.payload.args.content.length} chars)`);
        } else if (event.payload.name === 'edit_file') {
          console.log(`  - Path: "${event.payload.args.path}"`);
          console.log(`  - Search: "${event.payload.args.search.slice(0, 50)}..."`);
          console.log(`  - Replace: "${event.payload.args.replace.slice(0, 50)}..."`);
        } else if (event.payload.name === 'complete_task') {
          console.log(`  - Summary: "${event.payload.args.summary}"`);
        }
        break;

      case 'FILE_CHANGED':
        console.log(
          `[${timestampStr}] 📝 [FILE_CHANGED / VFS] "${event.payload.path}" (${event.payload.action.toUpperCase()}, ${event.payload.size} bytes)`
        );
        break;

      case 'TOOL_RESULT':
        console.log(`[${timestampStr}] 👁️  [TOOL_RESULT / 観測] <- ${event.payload.name}`);
        console.log(`  ${event.payload.result}\n`);
        break;

      case 'COMPLETE':
        console.log('================================================================');
        console.log(`🎉 [COMPLETE / 完了] ReAct自律タスク完了！`);
        console.log(`所要ターン数: ${event.payload.turns} ターン`);
        console.log(`処理時間: ${event.payload.durationMs} ms`);
        console.log(`サマリー: ${event.payload.summary}`);
        console.log(`生成ファイル一覧: ${Object.keys(event.payload.files).join(', ')}`);
        console.log('================================================================\n');
        finalFiles = event.payload.files;
        break;

      case 'ERROR':
        console.error(`❌ [ERROR] (${event.payload.phase}):`, event.payload.error);
        break;
    }
  }

  // 成果物をローカルディレクトリにも書き出し確認
  if (finalFiles['index.html']) {
    const outputPath = path.resolve(process.cwd(), 'index.html');
    fs.writeFileSync(outputPath, finalFiles['index.html'], 'utf-8');
    console.log(`💾 成果物HTMLをディスクに保存しました: ${outputPath}`);
  }
}

main().catch(console.error);
