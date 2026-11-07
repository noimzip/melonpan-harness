import { getStoredApiKeys } from '../../services/provider-factory.js';
import { getKosenSession } from './supabase.js';
import { startKosenGeneration } from './kosen-runner.js';
import type { ModelTierConfig } from './types.js';

const pending = new Set<string>();

/** Start a fresh attempt so the original failure and its diagnostics remain inspectable. */
export async function retryKosenGeneration(sessionId: string, config: ModelTierConfig) {
  if (pending.has(sessionId)) throw new Error('再生成の開始処理中です。');
  if (!config.model.trim()) throw new Error('モデル名を入力してください。');
  if (!['gemini', 'openrouter', 'surplus'].includes(config.provider) && !getStoredApiKeys()[config.provider]) {
    throw new Error('選択したプロバイダの API キーを管理画面で設定してください。');
  }
  pending.add(sessionId);
  try {
    const source = await getKosenSession(sessionId);
    if (!source) throw new Error('元のセッションが見つかりません。');
    if (source.status !== 'failed' && source.status !== 'cancelled') {
      throw new Error('失敗または中断したセッションのみ再生成できます。');
    }
    return await startKosenGeneration({
      ageGroup: source.age_group, prompt: source.prompt, toppings: [...source.toppings],
      isPublic: source.is_public, gameTitle: source.game_title || undefined,
      tierConfig: { ...config, tier: source.model_tier, model: config.model.trim() },
    });
  } finally { pending.delete(sessionId); }
}
