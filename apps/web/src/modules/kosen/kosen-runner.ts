import { invokeKosenAiProxy } from './supabase.js';
import { AgentRuntime } from '../../services/agent-runtime';
import { createInitialSession } from '../../services/session-storage';
import { getStoredApiKeys } from '../../services/provider-factory';
import { createServerGenerationProvider } from './server-provider';
import type { ServerKeyProvider } from './supabase';
import { ProviderConfig } from '../../types';
import {
  AgeGroup,
  KosenSessionRecord,
  ModelTierConfig,
} from './types';
import {
  appendKosenEvent,
  createKosenSession,
  fetchExhibitionSettings,
  publishKosenGame,
  updateKosenSession,
} from './supabase';
import {
  buildInteractiveFallbackGameHtml,
  generateGameSummaryAndTitle,
} from './toppings-service';

interface ActiveGenerationJob {
  sessionId: string;
  runtime: AgentRuntime;
  aborted: boolean;
  log: (event: string, tool?: string) => void;
}

const activeJobs = new Map<string, ActiveGenerationJob>();

export function stopKosenGenerationJob(sessionId: string): void {
  const job = activeJobs.get(sessionId);
  if (job) {
    job.aborted = true;
    job.log('cancelled');
    job.runtime.cancelCurrentTask();
    activeJobs.delete(sessionId);
  }
  updateKosenSession(sessionId, {
    status: 'cancelled',
    error_message: '管理者によってセッションが停止されました。',
    completed_at: new Date().toISOString(),
  }).catch(() => {});
}

export async function startKosenGeneration(params: {
  ageGroup: AgeGroup;
  prompt: string;
  toppings: string[];
  tierConfig: ModelTierConfig;
  isPublic: boolean;
  gameTitle?: string;
  onProgress?: (update: {
    thought?: string;
    code?: string;
    status?: KosenSessionRecord['status'];
    turnCount?: number;
  }) => void;
}): Promise<KosenSessionRecord> {
  const settings = await fetchExhibitionSettings();
  const expireMinutes = settings.statusExpireMinutes || 5;

  // 1. Create session record in Supabase
  const sessionRecord = await createKosenSession({
    ageGroup: params.ageGroup,
    prompt: params.prompt,
    toppings: params.toppings,
    modelTier: params.tierConfig.tier,
    modelName: params.tierConfig.model,
    provider: params.tierConfig.provider,
    thinkingEffort: params.tierConfig.thinkingEffort,
    isPublic: params.isPublic,
    gameTitle: params.gameTitle,
  });

  const sessionId = sessionRecord.id;
  const log = (event: string, tool?: string) => {
    void (async () => {
      try { await invokeKosenAiProxy('append_generation_log', {
        session_id: sessionId, provider: params.tierConfig.provider, model: params.tierConfig.model,
        event, details: { tool },
      }); } catch { console.error('Generation log persistence failed'); }
    })();
  };
  log('started');

  // 2. Run generation asynchronously so kiosk immediately transitions to QR code page
  (async () => {
    const runtime = new AgentRuntime();
    runtime.setPermissionPolicy({
      read: 'allow',
      write: 'allow',
      command: 'allow',
      web: 'allow',
    });

    const job: ActiveGenerationJob = {
      sessionId,
      runtime,
      aborted: false,
      log,
    };
    activeJobs.set(sessionId, job);

    const fullPromptParts = [
      `【高専祭 ゲーム制作リクエスト】`,
      `作りたいゲーム: ${params.prompt}`,
    ];
    if (params.toppings.length > 0) {
      fullPromptParts.push(
        `追加トッピング要素 (必ずゲーム内に楽しく実装してください):\n${params.toppings
          .map((t) => `- ${t}`)
          .join('\n')}`
      );
    }
    if (params.gameTitle) {
      fullPromptParts.push(`作品タイトル: ${params.gameTitle}`);
    }
    fullPromptParts.push(
      `単一ファイルの HTML5 Canvas 2D ゲーム (index.html) として、PCのマウス・キーボードとスマホのタッチ操作の両方で楽しく遊べるように作成してください。`
    );

    const fullPrompt = fullPromptParts.join('\n\n');
    const storedKeys = getStoredApiKeys();
    const apiKey = storedKeys[params.tierConfig.provider] || '';
    const useServer = !apiKey && ['gemini', 'openrouter', 'surplus'].includes(params.tierConfig.provider);
    const serverProvider = useServer ? createServerGenerationProvider(params.tierConfig.provider as ServerKeyProvider, sessionId) : undefined;
    let generationError = ''; 

    let latestCode = '';
    let latestThought = 'ゲームの構成とアイデアを設計しています...';
    let turnCount = 0;

    await appendKosenEvent(sessionId, 'status', {
      message: `AIモデル (${params.tierConfig.label}: ${params.tierConfig.model}) でゲーム生成を開始しました！`,
    });

    try {
      if (serverProvider || apiKey) {
        // Real LLM execution via MelonpanCore
        const webSession = createInitialSession(
          params.gameTitle || '高専祭ゲーム',
          params.tierConfig.model
        );
        const providerConfig: ProviderConfig = {
          provider: params.tierConfig.provider,
          model: params.tierConfig.model,
          apiKey,
          baseUrl: '',
          thinkingEffort: params.tierConfig.thinkingEffort,
          bridgeUrl: '',
        };

        let lastSyncTime = 0;
        await runtime.executeTurn(fullPrompt, webSession, providerConfig, {
          onMessageUpdate: (msg) => {
            if (msg.thought && msg.thought !== latestThought) {
              latestThought = msg.thought;
              params.onProgress?.({ thought: latestThought, status: 'running' });
              const now = Date.now();
              if (now - lastSyncTime > 1200) {
                lastSyncTime = now;
                updateKosenSession(sessionId, {
                  current_thought: latestThought.slice(-1500),
                }).catch(() => {});
              }
            }
          },
          onToolCallUpdate: (tc) => {
            log('tool', tc.name);
            turnCount++;
            params.onProgress?.({ turnCount, status: 'running' });
            appendKosenEvent(sessionId, 'tool_call', {
              toolName: tc.name,
              args: tc.args,
              message: `ツール実行: ${tc.name}`,
            }).catch(() => {});
          },
          onFileChange: (path, content) => {
            if (path.endsWith('.html') || !latestCode) {
              latestCode = content;
              const lineCount = content.split('\n').length;
              params.onProgress?.({ code: latestCode, status: 'running' });
              updateKosenSession(sessionId, {
                current_code: latestCode,
                turn_count: turnCount,
              }).catch(() => {});
              appendKosenEvent(sessionId, 'file_change', {
                filePath: path,
                lineCount,
                codePreview: content.slice(0, 600),
                message: `${path} を更新しました (${lineCount} 行)`,
              }).catch(() => {});
            }
          },
          onPlanUpdate: () => {},
          onSubagentUpdate: () => {},
          onPermissionRequest: (req) => req.resolve('always_allow'),
          onMetricsUpdate: () => {},
          onEvent: (ev) => {
            if (ev.type === 'ERROR') generationError = ev.payload.error?.message || String(ev.payload.error);
            if (ev.type === 'THOUGHT' && ev.payload?.thought) {
              appendKosenEvent(sessionId, 'thought', {
                thought: ev.payload.thought,
              }).catch(() => {});
            }
          },
        }, serverProvider, true);
      }

      if (job.aborted) return;
      if (generationError) throw new Error(generationError);
      if ((serverProvider || apiKey) && (!latestCode || !latestCode.toLowerCase().includes('<html'))) {
        throw new Error('ゲーム生成が完了しましたが、HTML ファイルが作成されませんでした。');
      }

      // If no API key was configured or LLM didn't produce HTML, run interactive progressive simulation so the kiosk & QR status page work seamlessly
      if (!latestCode || !latestCode.includes('<html')) {
        const { title: autoTitle } = await generateGameSummaryAndTitle({
          prompt: params.prompt,
          toppings: params.toppings,
          userTitle: params.gameTitle,
        });

        const finalHtml = buildInteractiveFallbackGameHtml({
          title: autoTitle,
          prompt: params.prompt,
          toppings: params.toppings,
        });

        const simulationSteps = [
          {
            thought: `ユーザーのプロンプト「${params.prompt}」とトッピング（${
              params.toppings.length
            }個）を分析中... ゲームループとCanvas 2Dレンダラーを設計します。`,
            codeSliceRatio: 0.25,
          },
          {
            thought: `プレイヤーの操作系（マウス・タッチ・キーボード）と物理演算・当たり判定ロジックを実装しています...`,
            codeSliceRatio: 0.6,
          },
          {
            thought: `パーティクルエフェクト、コンボ倍率、スコアHUD表示を組み込み、全体の動作バランスを仕上げています！`,
            codeSliceRatio: 1.0,
          },
        ];

        for (let i = 0; i < simulationSteps.length; i++) {
          if (job.aborted) return;
          const step = simulationSteps[i];
          turnCount = i + 1;
          latestThought = step.thought;
          const partialCode = finalHtml.slice(
            0,
            Math.floor(finalHtml.length * step.codeSliceRatio)
          );
          latestCode = partialCode;

          params.onProgress?.({
            thought: latestThought,
            code: latestCode,
            turnCount,
            status: 'running',
          });

          await updateKosenSession(sessionId, {
            current_thought: latestThought,
            current_code: latestCode,
            turn_count: turnCount,
          });

          await appendKosenEvent(sessionId, 'thought', {
            thought: latestThought,
          });

          await appendKosenEvent(sessionId, 'file_change', {
            filePath: 'index.html',
            lineCount: latestCode.split('\n').length,
            codePreview: latestCode.slice(-500),
            message: `index.html を生成中 (${Math.round(step.codeSliceRatio * 100)}%)`,
          });

          await new Promise((r) => setTimeout(r, 1100));
        }
      }

      // Generate final title & AI summary
      const { title: finalTitle, description: finalDesc } = await generateGameSummaryAndTitle({
        prompt: params.prompt,
        toppings: params.toppings,
        userTitle: params.gameTitle,
      });

      const completedAt = new Date();
      const expiresAt = new Date(completedAt.getTime() + expireMinutes * 60 * 1000);

      await updateKosenSession(sessionId, {
        status: 'completed',
        game_title: finalTitle,
        game_description: finalDesc,
        current_code: latestCode,
        current_thought: `✨ ゲーム「${finalTitle}」が完成しました！`,
        completed_at: completedAt.toISOString(),
        expires_at: expiresAt.toISOString(),
      });

      await appendKosenEvent(sessionId, 'complete', {
        summary: `ゲーム「${finalTitle}」の生成が完了しました！（このページは完了${expireMinutes}分後に自動で閉じます）`,
      });

      // Publish to kosen_games table
      await publishKosenGame({
        sessionId,
        title: finalTitle,
        description: finalDesc,
        htmlContent: latestCode,
        ageGroup: params.ageGroup,
        modelTier: params.tierConfig.tier,
        toppings: params.toppings,
        isPublic: params.isPublic,
      });

      log('completed');
      params.onProgress?.({
        thought: `✨ ゲーム「${finalTitle}」が完成しました！`,
        code: latestCode,
        status: 'completed',
      });
    } catch (err: any) {
      if (job.aborted) return;
      log('failed');
      const errMsg = err?.message || String(err);
      await updateKosenSession(sessionId, {
        status: 'failed',
        error_message: errMsg,
        completed_at: new Date().toISOString(),
      });
      await appendKosenEvent(sessionId, 'error', {
        message: `エラーが発生しました: ${errMsg}`,
      });
      params.onProgress?.({ thought: `ゲーム生成に失敗しました: ${errMsg}`, status: 'failed' });
    } finally {
      activeJobs.delete(sessionId);
    }
  })();

  return sessionRecord;
}
