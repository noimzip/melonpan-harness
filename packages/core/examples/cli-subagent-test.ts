import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MelonpanCore } from '../src/index.js';

async function main() {
  const currentFile = fileURLToPath(import.meta.url);
  const coreDir = path.resolve(path.dirname(currentFile), '..');
  const skillsDir = path.resolve(coreDir, 'skills');
  const agentsDir = path.resolve(coreDir, 'agents');

  // 引数からモードとプロンプトを取得
  const args = process.argv.slice(2);
  let mode: 'plan' | 'act' | 'auto' = 'auto';
  let prompt = 'ネオンサイバーなブロック崩しゲームを作って';

  for (const arg of args) {
    if (arg.startsWith('--mode=')) {
      const m = arg.split('=')[1];
      if (m === 'plan' || m === 'act' || m === 'auto') {
        mode = m;
      }
    } else if (!arg.startsWith('--')) {
      prompt = arg;
    }
  }

  console.log('================================================================');
  console.log('🍈 Melonpan Core - Plan Mode & Clean-Room Sub-agent 動作検証');
  console.log(`実行モード: [${mode.toUpperCase()}]`);
  console.log(`プロンプト: "${prompt}"`);
  console.log('================================================================\n');

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.log('ℹ️  GEMINI_API_KEY is not set in environment.');
    console.log('   Running in deterministic Clean-Room simulation mode.\n');
  } else {
    console.log('🔑 GEMINI_API_KEY detected. Connecting to Gemini 3.8 Flash.\n');
  }

  const core = new MelonpanCore({
    apiKey,
    model: 'gemini-3.8-flash',
    skillsDir,
    agentsDir,
    mode,
    simulate: !apiKey,
  });

  const eventStream = core.run(prompt);
  let finalFiles: Record<string, string> = {};

  for await (const event of eventStream) {
    const timestampStr = new Date(event.timestamp).toISOString().split('T')[1].slice(0, 8);

    switch (event.type) {
      case 'SKILL_INDEXED':
        console.log(`[${timestampStr}] 📚 [SKILL_INDEXED] メタデータ軽量インデックス完了: ${event.payload.count} 件`);
        break;

      case 'SKILL_LOADED':
        console.log(`[${timestampStr}] 🎯 [SKILL_LOADED] スキル動的ロード: ${event.payload.name}`);
        break;

      case 'PLAN_STARTED':
        console.log(`[${timestampStr}] 📋 [PLAN_STARTED] Plan Mode フェーズ開始 (Mode: ${event.payload.mode})`);
        break;

      case 'PLAN_CREATED':
        console.log(`[${timestampStr}] 📝 [PLAN_CREATED] 計画書生成完了 ("${event.payload.path}")`);
        console.log(`  --- 計画書プレビュー ---`);
        console.log(`  ${event.payload.plan.slice(0, 200).replace(/\n/g, '\n  ')}...\n`);
        break;

      case 'THOUGHT':
        console.log(`[${timestampStr}] 🧠 [THOUGHT / 推論]`);
        console.log(`  ${event.payload.thought}\n`);
        break;

      case 'SUBAGENT_DISPATCHED':
        console.log(`[${timestampStr}] 🚀 [SUBAGENT_DISPATCHED / 委譲] Clean-Room Isolation 起動 -> [${event.payload.agentType}]`);
        console.log(`  - 依頼内容: "${event.payload.taskPrompt.slice(0, 80)}..."`);
        break;

      case 'SUBAGENT_COMPLETED':
        console.log(`[${timestampStr}] 📥 [SUBAGENT_COMPLETED / 報告受領] <- [${event.payload.agentType}] (${event.payload.durationMs}ms)`);
        console.log(`  --- サブエージェント報告内容 ---`);
        console.log(`  ${event.payload.result.replace(/\n/g, '\n  ')}\n`);
        break;

      case 'TOOL_CALL':
        if (event.payload.name !== 'dispatch_subagent') {
          console.log(`[${timestampStr}] 🛠️  [TOOL_CALL / 行動] -> ${event.payload.name}()`);
        }
        break;

      case 'FILE_CHANGED':
        console.log(
          `[${timestampStr}] 💾 [FILE_CHANGED / VFS] "${event.payload.path}" (${event.payload.action.toUpperCase()}, ${event.payload.size} bytes)`
        );
        break;

      case 'TOOL_RESULT':
        if (event.payload.name !== 'dispatch_subagent') {
          console.log(`[${timestampStr}] 👁️  [TOOL_RESULT / 観測] <- ${event.payload.name}: ${event.payload.result}\n`);
        }
        break;

      case 'COMPLETE':
        console.log('================================================================');
        console.log(`🎉 [COMPLETE / 完了] エージェントタスク完了！`);
        console.log(`総所要ターン数: ${event.payload.turns} ターン`);
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

  // 成果物をローカルディスクにも書き出して確認可能に
  for (const [filename, content] of Object.entries(finalFiles)) {
    const outputPath = path.resolve(process.cwd(), filename);
    fs.writeFileSync(outputPath, content, 'utf-8');
    console.log(`📁 成果物を出力しました: ${outputPath}`);
  }
}

main().catch(console.error);
