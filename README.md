# 🍈 Melonpan Core

**Agent Skills 標準仕様 (agentskills.io) 準拠・本格ReAct自律エージェントハーネス**

高専祭（学校祭・技術展）などの体験型展示向けに設計された自律型コーディングエージェントハーネス。
来場者の自然言語プロンプト（「ネオンサイバーなブロック崩し」「宇宙のジャンプアクション」等）から、ReAct自律ループ（思考 ⇄ ツール実行 ⇄ 観測 ⇄ 修正）とメモリ内仮想ファイルシステム（VFS）を用いて、即座に遊べる高品質な単一ファイルHTML5 Canvas 2Dアーケードゲームを生成します。

---

## 🌟 コアアーキテクチャの柱

1. **Agent Skills 標準仕様準拠 (`agentskills.io`)**:
   - スキルは `skills/<skill-name>/SKILL.md` の標準ディレクトリ配置で管理。
   - YAML Frontmatter (`name`, `description`, `metadata` 等) と Markdown Body (詳細規約) を厳格に分離。
   - **Progressive Disclosure (段階的開示)**: 起動時は全スキルのメタデータ（`name`, `description`）のみを軽量インデックス化し、ユーザー入力に応じて最適なスキルの本文（Instructions）のみをオンデマンドでシステムプロンプトに注入。
2. **ReAct自律ループ (Reasoning + Acting)**:
   - 最新の Gemini API (`@google/genai`) による Function Calling を活用。
   - `Thought`（思考）⇄ `Action`（ツール実行）⇄ `Observation`（結果観測）を自律的に繰り返す。
3. **本番用ツールセット (Tools) & メモリ内VFS**:
   - `write_file(path, content)`: 新規作成・完全上書き
   - `edit_file(path, search, replace)`: 差分更新（部分置換による自己修正）
   - `complete_task(summary)`: タスク完了宣言
   - `Map<string, string>` による安全なメモリ内VFSでNode/ブラウザ両対応。
4. **リアルタイム Event-Driven ストリーミング**:
   - `SKILL_INDEXED` ➔ `SKILL_LOADED` ➔ `THOUGHT` ➔ `TOOL_CALL` ➔ `FILE_CHANGED` ➔ `TOOL_RESULT` ➔ `COMPLETE` の全プロセスを `AsyncGenerator` で配信。

---

## 📂 ディレクトリ構成

```text
packages/core/
├── package.json
├── tsconfig.json
├── skills/
│   └── game-generator/
│       └── SKILL.md            # ★Agent Skills標準仕様のゲーム生成スキル
└── src/
    ├── types.ts                # イベント、スキル、ツールの型定義
    ├── skills/
    │   ├── skill-parser.ts     # SKILL.md の YAML/Markdown パーサー
    │   └── skill-manager.ts    # メタデータ常駐 & 本文オンデマンド読み込みエンジン
    ├── vfs/
    │   └── virtual-fs.ts       # メモリ内 Map<string, string> ベースの安全なVFS
    ├── tools/
    │   └── tool-definitions.ts # write_file, edit_file, complete_task ツール定義
    ├── react-agent.ts          # Gemini Function Calling によるReAct自律ループ
    └── index.ts                # MelonpanCore ファサード
```

---

## 🚀 クイックスタート

### 1. 依存関係のインストール & ビルド

```bash
pnpm install
pnpm build
```

### 2. ユニットテストの実行 (全16テスト)

```bash
pnpm test
```

### 3. CLI テストの実行

#### オフライン / シミュレーション実演 (APIキー不要)
```bash
# packages/core から実行する場合
cd packages/core && npx tsx examples/cli-test.ts

# リポジトリルートから実行する場合
pnpm demo
```

#### 実Gemini 3.8 Flashによる生成
```bash
export GEMINI_API_KEY="your-gemini-api-key"
pnpm demo "ネオンサイバーなブロック崩しゲームを作って"
```

生成された成果物 `index.html` はディスクに保存され、ブラウザで開いてすぐに遊べます。

---

## 💻 コードからの利用例

```typescript
import { MelonpanCore } from '@melonpan/core';

const core = new MelonpanCore({
  apiKey: process.env.GEMINI_API_KEY,
  model: 'gemini-3.8-flash',
});

// 入力を流し込み、イベントストリームをリッスン
const eventStream = core.run("宇宙を舞台にしたジャンプアクションゲーム");

for await (const event of eventStream) {
  switch (event.type) {
    case 'SKILL_INDEXED':
      console.log(`[Indexed]: ${event.payload.count} skills indexed`);
      break;
    case 'SKILL_LOADED':
      console.log(`[Skill Loaded]: ${event.payload.name}`);
      break;
    case 'THOUGHT':
      console.log(`[Thought]: ${event.payload.thought}`);
      break;
    case 'TOOL_CALL':
      console.log(`[Action]: ${event.payload.name}(${JSON.stringify(event.payload.args)})`);
      break;
    case 'FILE_CHANGED':
      console.log(`[VFS]: ${event.payload.path} (${event.payload.action})`);
      break;
    case 'TOOL_RESULT':
      console.log(`[Observation]: ${event.payload.result}`);
      break;
    case 'COMPLETE':
      console.log("🎉 [Complete]:", event.payload.summary);
      console.log("Files:", Object.keys(event.payload.files));
      break;
  }
}
```
