# 🍈 Melonpan Harness

高専祭（学校祭・技術展）出展向け自律ゲーム生成エージェントハーネス。
来場者の自然言語プロンプト（「宇宙を舞台にしたジャンプゲーム」「ブロック崩し」など）から、即座に遊べる単一ファイル完結のHTML5 Canvas 2Dゲームをストリーミング生成・構文検証・自動修復します。

---

## 🌟 特徴
- **Headless & UI非依存**: Pure TypeScript + Web標準API (`fetch`, `ReadableStream`, `AsyncIterable`) のみで設計。ブラウザ、Node CLI、スマートフォンWeb、エッジ環境でそのまま動作。
- **Event-Driven（ストリーミング駆動）**: 思考中、スキル動的ロード、コードストリーミング、構文検証、自己修復、完了までの全ライフサイクルイベントをリアルタイムに配信。
- **Progressive Disclosure（動的スキルローダー）**: 入力内容に応じて必要な指示プロンプトをオンデマンドで注入し、トークン消費とAttentionの希釈を防止。
- **自己修復（Auto-Repair）**: `new Function` による非実行JS構文コンパイル、Canvas要素、ゲームループ（`requestAnimationFrame`）の検査を自動実行し、エラー時は自己修復ループで自動再生成。
- **最新LLMサポート**: デフォルトで最新の **Gemini 3.8 Flash** (`gemini-3.8-flash`) を使用。

---

## 📂 ディレクトリ構成

```plaintext
packages/core/
├── src/
│   ├── index.ts              # 公開API（MelonpanCore, 型定義のエクスポート）
│   ├── types.ts              # 共通型定義（Event, Skill, Resultなど）
│   ├── agent-loop.ts         # エージェントの制御ループ・状態遷移
│   ├── skills/
│   │   ├── skill-manager.ts  # 動的ロード・スキルの登録・解決エンジン
│   │   └── presets/          # 高専祭用の組み込みスキル（game-generator等）
│   ├── providers/
│   │   ├── provider.interface.ts # LLMの共通インターフェース
│   │   ├── gemini.ts         # Gemini 3.8 Flash 実装 (Pure Fetch + SSE)
│   │   └── mock.ts           # テスト・オフライン用 MockProvider
│   └── validator/
│       └── html-validator.ts # 生成されたHTML/JSの構文検証・抽出・サニタイズ
├── package.json
└── tsconfig.json
```

---

## 🚀 クイックスタート

### 依存関係のインストール & ビルド

```bash
pnpm install
pnpm build
```

### テストの実行 (全19テスト)

```bash
pnpm test
```

### デモの実行

#### オフライン/モック実演 (APIキー不要・自動修復シミュレーション)
```bash
pnpm demo:mock
```

#### 実APIを使用した生成 (Gemini 3.8 Flash)
```bash
export GEMINI_API_KEY="your-gemini-api-key"
pnpm demo "宇宙を舞台にしたジャンプアクションゲーム"
```

生成されたゲームは `generated-game.html` に保存され、ブラウザで開いてすぐに遊べます。

---

## 💻 コードからの利用例

```typescript
import { MelonpanCore } from '@melonpan/core';

const core = new MelonpanCore({
  apiKey: process.env.GEMINI_API_KEY,
  model: 'gemini-3.8-flash',
});

// 入力を流し込み、イベントストリームをリッスン
const eventStream = core.run("ブロック崩し");

for await (const event of eventStream) {
  switch (event.type) {
    case 'SKILL_LOADED':
      console.log(`[Skill Loaded]: ${event.payload.name}`);
      break;
    case 'CODE_CHUNK':
      process.stdout.write(event.payload); // CLIならコンソール、Webならエディタに追記
      break;
    case 'VALIDATING':
      console.log(`[Validating]: ${event.payload.message}`);
      break;
    case 'REPAIRING':
      console.log(`[Repairing]: 構文エラーを検知、自己修復中...`);
      break;
    case 'COMPLETE':
      console.log("🎉 ゲーム生成完了！", event.payload.html);
      break;
    case 'ERROR':
      console.error("エラー:", event.payload.error);
      break;
  }
}
```
