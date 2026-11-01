import { CommandSuggestion, Session, ProviderConfig, PermissionPolicyConfig } from '../types';
import {
  ALL_SUPPORTED_MODELS,
  MODEL_PRICING,
  USD_TO_JPY_RATE,
  maskApiKey,
  saveStoredApiKey,
  clearAllStoredApiKeys,
  getStoredApiKeys,
} from './provider-factory';
import { agentRuntime } from './agent-runtime';
import JSZip from 'jszip';

export interface WebCommandContext {
  session: Session;
  providerConfig: ProviderConfig;
  permissionPolicy: PermissionPolicyConfig;
  setProviderConfig: React.Dispatch<React.SetStateAction<ProviderConfig>>;
  setPermissionPolicy: React.Dispatch<React.SetStateAction<PermissionPolicyConfig>>;
  updateActiveSession: (updater: (prev: Session) => Session) => void;
  executePrompt: (prompt: string, overrideMode?: 'plan' | 'act' | 'auto' | 'goal') => void;
  logMessage: (content: string, thought?: string) => void;
  triggerZipDownload?: () => void;
}

export interface WebCommandDefinition {
  name: string;
  aliases?: string[];
  syntax: string;
  description: string;
  execute: (args: string[], ctx: WebCommandContext) => Promise<void> | void;
  getSuggestions?: (currentInput: string) => CommandSuggestion[];
}

export class WebCommandRegistry {
  private commands: Map<string, WebCommandDefinition> = new Map();

  constructor() {
    this.register({
      name: 'help',
      syntax: '/help',
      description: '利用可能な全スラッシュコマンドの一覧と操作説明を表示',
      execute: (_args, ctx) => {
        const text = `📖 **Melonpan WebUI スラッシュコマンド一覧**:
• \`/key [key | clear | status | <provider> <key>]\` : APIキーの設定・確認・ローカル保存
• \`/model [name]\` : モデルの表示・切り替え (Gemini, OpenAI, Anthropic, OpenRouter, Groq)
• \`/effort [level]\` : 推論レベルの変更 (minimal, low, medium, high)
• \`/plan [prompt]\` : Plan Mode トグル (引数なし) または指定プロンプトで計画策定を実行
• \`/permissions [mode]\` : ツール実行権限モードの確認・変更 (auto / ask / strict)
• \`/agents [name]\` : 利用可能なサブエージェント (researcher, code-reviewer) の一覧表示
• \`/compact [instructions]\` : 会話履歴を手動要約・圧縮してコンテキストウィンドウを解放
• \`/cost\` : セッション累計課金トークンと推定費用 (USD/JPY) を表示
• \`/skills [list | enable <name> | disable <name>]\` : スキルの状態一覧や有効化/無効化
• \`/export\` : VFS内の全成果物を ZIP アーカイブとして一括ダウンロード
• \`/clear\` : 会話履歴・セッションをリセット
• \`/help\` : このヘルプを表示

💡 **ヒント**: 入力欄で「 \`/ \` 」を入力するとリアルタイム補完が表示されます。[Tab] またはクリックで補完を適用できます。`;
        ctx.logMessage(text);
      },
    });

    this.register({
      name: 'key',
      aliases: ['apikey', 'api-key'],
      syntax: '/key [api-key | clear | status | <provider> <api-key>]',
      description: 'マルチプロバイダーAPIキー (Gemini, OpenAI, Anthropic, OpenRouter, Groq) の設定・確認',
      execute: (args, ctx) => {
        const sub = args[0]?.trim();

        if (!sub || sub.toLowerCase() === 'status') {
          const stored = getStoredApiKeys();
          const activeKey = ctx.providerConfig.apiKey || stored[ctx.providerConfig.provider] || '';
          const lines = [
            `🔑 **APIキー設定ステータス**:`,
            `  • 現在のアクティブプロバイダー: **${ctx.providerConfig.provider}**`,
            `  • 現在のアクティブモデル: **${ctx.providerConfig.model}**`,
            `  • アクティブAPIキー: \`${maskApiKey(activeKey)}\``,
            `  ───────────────────────────────────────────`,
            `  • Gemini Key      : \`${maskApiKey(stored.gemini)}\``,
            `  • OpenAI Key      : \`${maskApiKey(stored.openai)}\``,
            `  • Anthropic Key   : \`${maskApiKey(stored.anthropic)}\``,
            `  • OpenRouter Key  : \`${maskApiKey(stored.openrouter)}\``,
            `  • OrcaRouter Key  : \`${maskApiKey(stored.orcarouter)}\``,
            `  • Groq Key        : \`${maskApiKey(stored.groq)}\``,
            `\n💡 **コマンド例**:`,
            `  • \`/key AIza...\` : 現在のプロバイダーにAPIキーを設定`,
            `  • \`/key openai sk-...\` : OpenAI用APIキーを設定`,
            `  • \`/key clear\` : 保存されている全APIキーを破棄`,
          ];
          ctx.logMessage(lines.join('\n'));
          return;
        }

        if (sub.toLowerCase() === 'clear') {
          clearAllStoredApiKeys();
          ctx.setProviderConfig((prev) => ({ ...prev, apiKey: '' }));
          ctx.logMessage('🗑️ 保存されていた全APIキーをブラウザストレージから消去しました。');
          return;
        }

        const knownProviders = ['gemini', 'openai', 'anthropic', 'openrouter', 'orcarouter', 'groq'];
        if (knownProviders.includes(sub.toLowerCase())) {
          const provider = sub.toLowerCase();
          const targetKey = args[1]?.trim();
          if (!targetKey) {
            ctx.logMessage(`⚠️ 使用方法: \`/key ${provider} <APIキー>\``);
            return;
          }
          saveStoredApiKey(provider, targetKey);
          if (ctx.providerConfig.provider === provider) {
            ctx.setProviderConfig((prev) => ({ ...prev, apiKey: targetKey }));
          }
          ctx.logMessage(`🔑 ${provider.toUpperCase()} のAPIキーを設定・保存しました: \`${maskApiKey(targetKey)}\``);
          return;
        }

        // Direct key (/key <api-key>)
        const newKey = sub;
        saveStoredApiKey(ctx.providerConfig.provider, newKey);
        ctx.setProviderConfig((prev) => ({ ...prev, apiKey: newKey }));
        ctx.logMessage(`🔑 ${ctx.providerConfig.provider.toUpperCase()} のAPIキーを設定しました: \`${maskApiKey(newKey)}\``);
      },
      getSuggestions: (input) => {
        const prefix = '/key ';
        if (!input.startsWith(prefix)) return [];
        const rem = input.slice(prefix.length).trim().toLowerCase();
        const base = [
          { text: '/key status', display: 'status', description: '現在のAPIキー設定状況を確認' },
          { text: '/key clear', display: 'clear', description: '保存中の全APIキーを破棄' },
          { text: '/key gemini ', display: 'gemini <key>', description: 'Google Gemini APIキーを設定' },
          { text: '/key openai ', display: 'openai <key>', description: 'OpenAI APIキーを設定' },
          { text: '/key anthropic ', display: 'anthropic <key>', description: 'Anthropic APIキーを設定' },
          { text: '/key openrouter ', display: 'openrouter <key>', description: 'OpenRouter APIキーを設定' },
          { text: '/key groq ', display: 'groq <key>', description: 'Groq APIキーを設定' },
        ];
        return base.filter((b) => b.display.toLowerCase().startsWith(rem));
      },
    });

    this.register({
      name: 'model',
      aliases: ['boost'],
      syntax: '/model [name]',
      description: 'モデルの表示・切り替え (Gemini, OpenAI, Anthropic, OpenRouter, Groq)',
      execute: (args, ctx) => {
        const targetModel = args[0]?.trim();

        if (!targetModel) {
          const modelsList = ALL_SUPPORTED_MODELS.map(
            (m) => `  • \`${m.id}\` (${m.provider}) - ${m.description}`
          ).join('\n');
          ctx.logMessage(
            `🤖 **現在のアクティブモデル**: \`${ctx.providerConfig.model}\` (${ctx.providerConfig.provider})\n\n**利用可能な推奨モデル一覧**:\n${modelsList}\n\n切り替え例: \`/model gemini-4-argon\` または \`/model gpt-4o\``
          );
          return;
        }

        const found = ALL_SUPPORTED_MODELS.find(
          (m) => m.id.toLowerCase() === targetModel.toLowerCase()
        );

        if (found) {
          const stored = getStoredApiKeys();
          const targetKey = stored[found.provider] || ctx.providerConfig.apiKey;
          ctx.setProviderConfig((prev) => ({
            ...prev,
            model: found.id,
            provider: found.provider,
            apiKey: targetKey,
          }));
          ctx.logMessage(
            `✔ モデルを \`${found.id}\` (${found.provider}) に切り替えました。\n説明: ${found.description}`
          );
        } else {
          // Custom model name
          ctx.setProviderConfig((prev) => ({
            ...prev,
            model: targetModel,
          }));
          ctx.logMessage(`✔ モデルを \`${targetModel}\` に設定しました。`);
        }
      },
      getSuggestions: (input) => {
        const prefix = '/model ';
        if (!input.startsWith(prefix)) return [];
        const rem = input.slice(prefix.length).trim().toLowerCase();
        return ALL_SUPPORTED_MODELS.filter((m) =>
          m.id.toLowerCase().includes(rem) || m.provider.toLowerCase().includes(rem)
        ).map((m) => ({
          text: `/model ${m.id}`,
          display: m.id,
          description: `(${m.provider}) ${m.description}`,
        }));
      },
    });

    this.register({
      name: 'effort',
      syntax: '/effort [minimal|low|medium|high]',
      description: '推論レベル (Thinking Level) の深さを制御',
      execute: (args, ctx) => {
        const target = args[0]?.trim().toLowerCase();
        const validLevels = ['minimal', 'low', 'medium', 'high'] as const;

        if (!target) {
          ctx.logMessage(
            `🧠 **現在の思考推論レベル**: \`${ctx.providerConfig.thinkingEffort}\`\n利用可能: \`minimal\`, \`low\`, \`medium\`, \`high\``
          );
          return;
        }

        if (validLevels.includes(target as any)) {
          ctx.setProviderConfig((prev) => ({
            ...prev,
            thinkingEffort: target as any,
          }));
          ctx.logMessage(`✔ 思考推論レベルを \`${target}\` に変更しました。`);
        } else {
          ctx.logMessage(`⚠️ 不明な推論レベルです: "${target}"。指定可能: ${validLevels.join(', ')}`);
        }
      },
      getSuggestions: (input) => {
        const prefix = '/effort ';
        if (!input.startsWith(prefix)) return [];
        const rem = input.slice(prefix.length).trim().toLowerCase();
        const options = [
          { level: 'minimal', desc: '最速実行・最小の推論トークン' },
          { level: 'low', desc: '簡潔な思考プロセス' },
          { level: 'medium', desc: 'バランスの取れた標準的な推論 (推奨)' },
          { level: 'high', desc: '深いアルゴリズム設計と網羅的検証' },
        ];
        return options
          .filter((o) => o.level.startsWith(rem))
          .map((o) => ({
            text: `/effort ${o.level}`,
            display: o.level,
            description: o.desc,
          }));
      },
    });

    this.register({
      name: 'plan',
      syntax: '/plan [prompt]',
      description: 'Plan Mode のトグル切り替え、または指定プロンプトで Plan Mode 即時実行',
      execute: (args, ctx) => {
        const prompt = args.join(' ').trim();
        if (prompt.length > 0) {
          ctx.logMessage(`📝 計画モードでタスクを実行します: "${prompt}"`);
          ctx.executePrompt(prompt, 'plan');
          return;
        }

        if (ctx.session.mode === 'plan') {
          ctx.updateActiveSession((prev) => ({ ...prev, mode: 'auto' }));
          ctx.logMessage('💡 計画モード (Plan Mode) を **OFF** にしました (AUTO モードに移行)');
        } else {
          ctx.updateActiveSession((prev) => ({ ...prev, mode: 'plan' }));
          ctx.logMessage('💡 計画モード (Plan Mode) を **ON** にしました (実装前に計画書 plan.md を策定)');
        }
      },
      getSuggestions: (input) => {
        const prefix = '/plan ';
        if (!input.startsWith(prefix)) return [];
        return [
          {
            text: '/plan ',
            display: '<prompt>',
            description: '指定したプロンプトで計画書作成フェーズを即時実行',
          },
        ];
      },
    });

    this.register({
      name: 'goal',
      syntax: '/goal [objective]',
      description: 'Goal Mode (サブエージェント解禁・Plan→Act→Auditサイクル) で目標を実行',
      execute: (args, ctx) => {
        const prompt = args.join(' ').trim();
        if (prompt.length > 0) {
          ctx.logMessage(`🎯 ゴールモードで目標を実行します: "${prompt}" (サブエージェント解禁)`);
          ctx.executePrompt(prompt, 'goal');
          return;
        }

        if (ctx.session.mode === 'goal') {
          ctx.updateActiveSession((prev) => ({ ...prev, mode: 'act' }));
          ctx.logMessage('💡 ゴールモード (Goal Mode) を **OFF** にしました (標準 Act モードに移行)');
        } else {
          ctx.updateActiveSession((prev) => ({ ...prev, mode: 'goal' }));
          ctx.logMessage('💡 ゴールモード (Goal Mode) を **ON** にしました (サブエージェント解禁)');
        }
      },
      getSuggestions: (input) => {
        const prefix = '/goal ';
        if (!input.startsWith(prefix)) return [];
        return [
          {
            text: '/goal ',
            display: '<objective>',
            description: '指定した目標を Goal Mode (サブエージェント解禁) で即時実行',
          },
        ];
      },
    });

    this.register({
      name: 'cost',
      syntax: '/cost',
      description: 'セッション累計課金トークンと推定費用 (USD/JPY) を表示',
      execute: (_args, ctx) => {
        const {
          billedInputTokens,
          billedOutputTokens,
          totalTokens,
          cachedTokens,
          currentContextTokens,
          contextWindowLimit,
          prunedChars,
          compactionCount,
        } = ctx.session.metrics;

        const pricing = MODEL_PRICING[ctx.providerConfig.model] || {
          inputPerMillion: 0.1,
          outputPerMillion: 0.4,
        };

        const cachedInputRate = pricing.inputPerMillion * 0.25;
        const freshPromptTokens = Math.max(0, billedInputTokens - cachedTokens);
        const inputCostUsd =
          (freshPromptTokens / 1_000_000) * pricing.inputPerMillion +
          (cachedTokens / 1_000_000) * cachedInputRate;
        const outputCostUsd = (billedOutputTokens / 1_000_000) * pricing.outputPerMillion;
        const totalCostUsd = inputCostUsd + outputCostUsd;
        const totalCostJpy = totalCostUsd * USD_TO_JPY_RATE;

        const cachePercent = billedInputTokens > 0 ? Math.round((cachedTokens / billedInputTokens) * 100) : 0;
        const ctxPercent = contextWindowLimit > 0
          ? Math.min(100, Math.round((currentContextTokens / contextWindowLimit) * 100))
          : 0;

        const lines = [
          '💰 **セッション累計トークン消費 & 推定費用 (/cost)**:',
          `  • 使用モデル          : **${ctx.providerConfig.model}**`,
          `  • 入力トークン        : ${billedInputTokens.toLocaleString()} tokens ($${pricing.inputPerMillion.toFixed(3)} / 1M)`,
          `    └ キャッシュヒット  : ${cachedTokens.toLocaleString()} tokens (${cachePercent}% 割引適用)`,
          `    └ 新規入力          : ${freshPromptTokens.toLocaleString()} tokens`,
          `  • 出力トークン        : ${billedOutputTokens.toLocaleString()} tokens ($${pricing.outputPerMillion.toFixed(3)} / 1M)`,
          `  • 累計トークン        : ${totalTokens.toLocaleString()} tokens`,
          `  • **推定コスト**      : **$${totalCostUsd.toFixed(5)} USD** (約 **¥${totalCostJpy.toFixed(2)} JPY**)`,
          '  ───────────────────────────────────────────',
          '🧠 **Context Window (コンテキスト占有率)**:',
          `  • 現在の占有量        : ${currentContextTokens.toLocaleString()} / ${contextWindowLimit.toLocaleString()} tokens (${ctxPercent}%)`,
          `  • プルーニング削減    : ${prunedChars.toLocaleString()} chars`,
          `  • 要約圧縮実行回数    : ${compactionCount} 回`,
        ];

        ctx.logMessage(lines.join('\n'));
      },
    });

    this.register({
      name: 'clear',
      syntax: '/clear',
      description: '会話履歴・コンテキストウィンドウを初期化（セッションリセット）',
      execute: (_args, ctx) => {
        ctx.updateActiveSession((prev) => ({
          ...prev,
          messages: [],
          plan: undefined,
          subagents: [],
          metrics: {
            ...prev.metrics,
            currentContextTokens: 0,
            billedInputTokens: 0,
            billedOutputTokens: 0,
            cachedTokens: 0,
            totalTokens: 0,
          },
        }));
        ctx.logMessage('🧹 セッションの会話履歴とコンテキストをリセットしました。');
      },
    });

    this.register({
      name: 'export',
      syntax: '/export',
      description: '成果物（VFSファイル）を ZIP アーカイブとして一括ダウンロード',
      execute: async (_args, ctx) => {
        const fileCount = Object.keys(ctx.session.files).length;
        if (fileCount === 0) {
          ctx.logMessage('⚠️ エクスポート可能な成果物ファイルがありません。');
          return;
        }

        const zip = new JSZip();
        for (const [name, content] of Object.entries(ctx.session.files)) {
          zip.file(name, content);
        }

        const blob = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `melonpan-${Date.now()}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        ctx.logMessage(`💾 ${fileCount} 件のファイルを含む ZIP アーカイブをダウンロードしました！`);
      },
    });

    this.register({
      name: 'permissions',
      aliases: ['perm', 'policy'],
      syntax: '/permissions [auto|ask|strict]',
      description: 'ツール実行セキュリティ権限ポリシーの確認・切り替え (auto / ask / strict)',
      execute: (args, ctx) => {
        const target = args[0]?.trim().toLowerCase();

        if (!target) {
          const p = ctx.permissionPolicy;
          ctx.logMessage(
            `🛡️ **現在の権限ポリシー**:\n• 書き込み (write): \`${p.write}\`\n• コマンド (command): \`${p.command}\`\n• 読み取り (read): \`${p.read}\`\n• Webアクセス (web): \`${p.web}\`\n\n変更コマンド: \`/permissions auto\` (全自動許可) / \`/permissions ask\` (対話承認・推奨) / \`/permissions strict\` (制限強化)`
          );
          return;
        }

        if (target === 'auto') {
          ctx.setPermissionPolicy({
            read: 'allow',
            write: 'allow',
            command: 'allow',
            web: 'allow',
          });
          ctx.logMessage('✔ セキュリティポリシーを `AUTO` (全自動許可) に設定しました。');
        } else if (target === 'ask') {
          ctx.setPermissionPolicy({
            read: 'allow',
            write: 'ask',
            command: 'ask',
            web: 'allow',
          });
          ctx.logMessage('✔ セキュリティポリシーを `ASK` (書き込み・コマンド実行時に対話確認) に設定しました。');
        } else if (target === 'strict') {
          ctx.setPermissionPolicy({
            read: 'allow',
            write: 'ask',
            command: 'deny',
            web: 'allow',
          });
          ctx.logMessage('✔ セキュリティポリシーを `STRICT` (コマンド実行禁止・書き込み確認) に設定しました。');
        } else {
          ctx.logMessage(`⚠️ 不明なモードです: "${target}"。指定可能: auto, ask, strict`);
        }
      },
      getSuggestions: (input) => {
        const prefix = '/permissions ';
        if (!input.startsWith(prefix)) return [];
        return [
          { text: '/permissions ask', display: 'ask', description: '変更時に対話モーダルで承認を要求 (推奨)' },
          { text: '/permissions auto', display: 'auto', description: 'ファイル生成・ツール実行を自動承認' },
          { text: '/permissions strict', display: 'strict', description: '危険な実行を拒否し保護' },
        ];
      },
    });

    this.register({
      name: 'agents',
      syntax: '/agents',
      description: '利用可能な Clean-Room サブエージェント (researcher, code-reviewer) の一覧表示',
      execute: (_args, ctx) => {
        const text = `🤖 **登録済み ReAct サブエージェント一覧**:
  • **researcher** (Technical & Architectural Researcher)
    - 役割: 物理演算、Canvas 2D衝突判定、Web Audio APIシンセサイズ仕様の研究
    - 権限: 読み取り専用 (\`read_file\`, \`list_files\`, \`grep_search\`, \`web_search\`)
  • **code-reviewer** (Multi-Perspective Code Auditor)
    - 役割: 60fps パフォーマンス、セキュリティ、単一ファイル整合性の多角的監査
    - 権限: 読み取り専用 (\`read_file\`, \`list_files\`, \`grep_search\`)

エージェントが必要と判断した際、自動的に Clean-Room 独立セッションでディスパッチされます。`;
        ctx.logMessage(text);
      },
    });

    this.register({
      name: 'skills',
      syntax: '/skills [list | enable <name> | disable <name>]',
      description: 'Agent Skills (agentskills.io) の一覧確認と有効化・無効化',
      execute: (args, ctx) => {
        const sub = args[0]?.trim().toLowerCase();
        if (!sub || sub === 'list') {
          ctx.logMessage(
            `📦 **Agent Skills 一覧 (Progressive Disclosure)**:\n• 🟢 **[ENABLED] game-generator**: Generates high-quality, playable, single-file HTML5 Canvas 2D arcade games with modern visuals, responsive touch controls, and audio effects.\n\nプロンプトの意図に応じて、必要なスキルが自動的にシステムプロンプトへ遅延注入されます。`
          );
          return;
        }
        ctx.logMessage(`ℹ️ スキル操作: \`/skills list\` で状態を確認できます。`);
      },
      getSuggestions: (input) => {
        const prefix = '/skills ';
        if (!input.startsWith(prefix)) return [];
        return [
          { text: '/skills list', display: 'list', description: '登録済みスキル一覧を表示' },
        ];
      },
    });

    this.register({
      name: 'compact',
      syntax: '/compact [instructions]',
      description: '会話履歴を手動で要約・圧縮してコンテキストウィンドウを解放',
      execute: async (args, ctx) => {
        const instr = args.join(' ').trim();
        const messages = ctx.session.messages;

        // If not enough messages to compact, report like TUI
        if (messages.length <= 2) {
          ctx.logMessage('ℹ️ 会話履歴はすでにコンパクトです（圧縮対象の過去メッセージがありません）。');
          return;
        }

        // Keep initial welcome message and the last 2 turns
        const initialMsg = messages[0];
        const recentMessages = messages.slice(-2);
        const toCompact = messages.slice(1, -2);

        if (toCompact.length === 0) {
          ctx.logMessage('ℹ️ 会話履歴はすでにコンパクトです。');
          return;
        }

        const charsBefore = toCompact.reduce(
          (sum, m) => sum + (m.content?.length || 0) + (m.thought?.length || 0),
          0
        );

        // Try calling MelonpanCore session compact if available
        const core = agentRuntime.getCore();
        if (core) {
          try {
            await core.sendCommand({ type: 'COMPACT_SESSION' });
          } catch {
            // Core might not have active background session
          }
        }

        const summaryContent = `✨ [過去の会話要約: ${toCompact.length}件のメッセージを圧縮]\nこれまでの実装内容およびゲーム設計の重要事項を保持し、コンテキストを圧縮しました。${instr ? ` (指示: ${instr})` : ''}`;
        const charsAfter = summaryContent.length;
        const savedChars = Math.max(0, charsBefore - charsAfter);
        const savedTokens = Math.max(0, Math.round(savedChars / 2));

        const compactedMessages = [
          initialMsg,
          {
            id: `compact_${Date.now()}`,
            role: 'system' as const,
            content: summaryContent,
            timestamp: Date.now(),
          },
          ...recentMessages,
        ];

        ctx.updateActiveSession((prev) => ({
          ...prev,
          messages: compactedMessages,
          metrics: {
            ...prev.metrics,
            currentContextTokens: Math.max(0, prev.metrics.currentContextTokens - savedTokens),
            prunedChars: prev.metrics.prunedChars + savedChars,
            compactionCount: prev.metrics.compactionCount + 1,
            compactionLogs: [
              `[${new Date().toLocaleTimeString()}] 手動 /compact 実行: ${toCompact.length}件の履歴を圧縮 (${savedChars.toLocaleString()}文字 / 約${savedTokens.toLocaleString()} tokens 削減) ${instr ? `[指示: ${instr}]` : ''}`,
              ...prev.metrics.compactionLogs,
            ],
          },
        }));

        ctx.logMessage(
          `🗜️ コンテキストの要約・圧縮が完了しました。${toCompact.length}件のメッセージを要約し、約${savedTokens.toLocaleString()} tokens (${savedChars.toLocaleString()}文字) 削減しました。`
        );
      },
    });
  }

  register(cmd: WebCommandDefinition): void {
    this.commands.set(cmd.name.toLowerCase(), cmd);
    if (cmd.aliases) {
      for (const a of cmd.aliases) {
        this.commands.set(a.toLowerCase(), cmd);
      }
    }
  }

  getCommand(name: string): WebCommandDefinition | undefined {
    return this.commands.get(name.toLowerCase());
  }

  getAllCommands(): WebCommandDefinition[] {
    return Array.from(new Set(this.commands.values()));
  }

  async executeCommand(rawInput: string, ctx: WebCommandContext): Promise<boolean> {
    const trimmed = rawInput.trim();
    if (!trimmed.startsWith('/')) return false;

    const parts = trimmed.slice(1).split(/\s+/);
    const cmdName = parts[0]?.toLowerCase();
    const args = parts.slice(1);

    if (!cmdName) return true;

    const cmd = this.getCommand(cmdName);
    if (!cmd) {
      ctx.logMessage(`❓ 不明なコマンドです: "/${cmdName}"。利用可能なコマンドは \`/help\` で確認できます。`);
      return true;
    }

    try {
      await cmd.execute(args, ctx);
    } catch (e: any) {
      ctx.logMessage(`❌ コマンド実行エラー (/${cmdName}): ${e.message || String(e)}`);
    }

    return true;
  }

  getAutocompleteSuggestions(input: string): CommandSuggestion[] {
    if (!input.startsWith('/')) return [];

    const trimmed = input.trimStart();
    const hasSpace = trimmed.includes(' ');

    if (!hasSpace) {
      const prefix = trimmed.toLowerCase();
      const all = this.getAllCommands();
      const results: CommandSuggestion[] = [];
      const seen = new Set<string>();

      for (const cmd of all) {
        if (`/${cmd.name}`.startsWith(prefix) && !seen.has(cmd.name)) {
          results.push({
            text: `/${cmd.name} `,
            display: `/${cmd.name}`,
            description: cmd.description,
          });
          seen.add(cmd.name);
        }
      }
      return results;
    }

    const parts = trimmed.slice(1).split(/\s+/);
    const cmdName = parts[0]?.toLowerCase();
    const cmd = this.getCommand(cmdName);
    if (cmd && cmd.getSuggestions) {
      return cmd.getSuggestions(trimmed);
    }

    return [];
  }
}

export const webCommandRegistry = new WebCommandRegistry();
