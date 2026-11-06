import { KosenTopping } from './types';
import { ProviderType } from '../../types';
import { createProviderInstance, getStoredApiKeys } from '../../services/provider-factory';
import { createServerGenerationProvider } from './server-provider';
import { fetchExhibitionSettings, invokeKosenAiProxy } from './supabase';

/**
 * Curated topping database categorized by game genre keywords so even when offline or before
 * API key setup, 10 tailored, super-exciting toppings are proposed immediately.
 */
const TOPPING_POOL: KosenTopping[] = [
  {
    id: 'top_fireworks',
    emoji: '🎆',
    text: '敵を倒したり得点するとカラフルな花火が打ち上がる',
    category: 'effect',
  },
  {
    id: 'top_combo_fever',
    emoji: '🔥',
    text: '連続コンボで画面が虹色に光るフィーバーモード',
    category: 'mechanic',
  },
  {
    id: 'top_giant_powerup',
    emoji: '🍄',
    text: 'アイテムを取ると主人公が巨大化して無敵になる',
    category: 'powerup',
  },
  {
    id: 'top_giant_boss',
    emoji: '👾',
    text: 'スコアが貯まるとHPバー付きの巨大ボスが出現する',
    category: 'boss',
  },
  {
    id: 'top_magnet',
    emoji: '🧲',
    text: '周りのコインやアイテムを自動で吸い寄せるマグネット',
    category: 'powerup',
  },
  {
    id: 'top_double_jump',
    emoji: '🪽',
    text: '空中でもう一度跳べる二段ジャンプとダッシュ移動',
    category: 'action',
  },
  {
    id: 'top_time_slow',
    emoji: '⏱️',
    text: 'ピンチの時に周囲の時間がスローになるマトリックス演出',
    category: 'mechanic',
  },
  {
    id: 'top_sound_synth',
    emoji: '🎵',
    text: 'ピコピコ音が鳴るレトロゲーム風の楽しい効果音（Web Audio）',
    category: 'audio',
  },
  {
    id: 'top_weather',
    emoji: '🌠',
    text: '背景で流れ星や雪が降ったり昼と夜が変化する演出',
    category: 'visual',
  },
  {
    id: 'top_secret_chest',
    emoji: '🎁',
    text: '時々ステージに現れるレアな秘密の宝箱ボーナス',
    category: 'bonus',
  },
  {
    id: 'top_homing_laser',
    emoji: '⚡',
    text: '敵を自動で追いかけるホーミングレーザー必殺技',
    category: 'shooting',
  },
  {
    id: 'top_multiball',
    emoji: '🎱',
    text: '玉が3つに分裂して一気に壊せるマルチボール機能',
    category: 'breaker',
  },
  {
    id: 'top_gravity_flip',
    emoji: '🙃',
    text: 'ボタンを押すと天井と床の重力が反転するギミック',
    category: 'action',
  },
  {
    id: 'top_pet_helper',
    emoji: '🐾',
    text: '一緒に戦ったりアイテムを拾ってくれる可愛い仲間キャラ',
    category: 'helper',
  },
  {
    id: 'top_screen_shake',
    emoji: '💥',
    text: '大爆発のときに画面が揺れる大迫力のカメラシェイク',
    category: 'effect',
  },
];

/**
 * Generates up to 10 fun "toppings" (extra game mechanics/effects) tailored to the user's prompt.
 * Uses configured LLM (from exhibition settings or options) if an API key is available;
 * otherwise uses intelligent keyword-aware selection.
 */
export async function generateToppingsForPrompt(
  prompt: string,
  maxCount = 10,
  options?: { model?: string; provider?: ProviderType }
): Promise<KosenTopping[]> {
  const trimmed = prompt.trim();
  const keys = getStoredApiKeys();

  let targetProvider: ProviderType = options?.provider || 'gemini';
  let targetModel: string = options?.model || '';

  if (!targetModel) {
    try {
      const settings = await fetchExhibitionSettings();
      targetModel = settings.toppingsModel || 'gemini-3.5-flash';
      targetProvider = settings.toppingsProvider || 'gemini';
    } catch {
      targetModel = 'gemini-3.5-flash';
    }
  }

  // The legacy toppings proxy accepts Gemini requests only.
  if (targetProvider === 'gemini') try {
    const proxyRes = await invokeKosenAiProxy<{ toppings: KosenTopping[] }>('toppings', {
      model: targetModel,
      prompt: trimmed,
      maxCount,
    });
    if (proxyRes?.toppings && Array.isArray(proxyRes.toppings) && proxyRes.toppings.length > 0) {
      return proxyRes.toppings.slice(0, maxCount);
    }
  } catch (err) {
    console.warn('Supabase Edge Function toppings proxy failed, attempting local fallback:', err);
  }

  // Check if we have an API key for the target provider, or find any available provider
  let provId: ProviderType = targetProvider;
  let provKey = keys[provId];
  const useServerProvider = targetProvider === 'openrouter' || targetProvider === 'surplus';
  if (!provKey && !useServerProvider) {
    const fallback = (
      [
        ['gemini', targetModel || 'gemini-3.5-flash'],
        ['openai', 'gpt-4o-mini'],
        ['anthropic', 'claude-3-5-haiku'],
        ['groq', 'llama-3.3-70b-versatile'],
        ['openrouter', 'meta-llama/llama-3.2-3b-instruct:free'],
      ] as const
    ).find(([p]) => Boolean(keys[p]));
    if (fallback) {
      provId = fallback[0];
      provKey = keys[provId];
      if (provId !== targetProvider) {
        targetModel = fallback[1];
      }
    }
  }

  // Try live LLM generation if any provider API key is configured
  if (provKey || useServerProvider) {
    try {
      const provider = useServerProvider
        ? createServerGenerationProvider(targetProvider as 'openrouter' | 'surplus')
        : createProviderInstance(provId, targetModel, provKey);
      if (provider) {
        const sysPrompt =
          'あなたは文化祭のゲーム制作アシスタントです。ユーザーの作りたいゲームに対して、追加するとさらに面白くなる「トッピング要素（ギミックや演出）」を10個提案してください。JSON配列のみで出力してください: [{"emoji":"💥","text":"短い説明(25文字以内)"}]';
        let rawText = '';
        for await (const chunk of provider.streamChat({
          model: targetModel,
          systemInstruction: sysPrompt,
          messages: [
            {
              role: 'user',
              parts: [{ text: `作りたいゲーム: ${trimmed}\n10個のトッピングをJSON配列で出力して:` }],
            },
          ],
        })) {
          if (chunk.type === 'text_delta' && chunk.delta) {
            rawText += chunk.delta;
          }
        }
        const jsonMatch = rawText.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed.slice(0, maxCount).map((item: any, idx: number) => ({
              id: `ai_top_${idx}_${Date.now()}`,
              emoji: String(item.emoji || '✨'),
              text: String(item.text || ''),
            }));
          }
        }
      }
    } catch (e) {
      console.warn('Live AI topping suggestion failed, using smart heuristic fallback:', e);
    }
  }

  // Smart context-aware selection from TOPPING_POOL + dynamic prompt-specific toppings
  const dynamicToppings: KosenTopping[] = [];

  if (/シューティング|宇宙|ビーム|レーザー|敵|撃/.test(trimmed)) {
    dynamicToppings.push(
      { id: 'dyn_1', emoji: '⚡', text: '敵を自動で追尾するホーミングレーザー必殺技' },
      { id: 'dyn_2', emoji: '🛡️', text: '3回まで攻撃を防げるエネルギーバリア' }
    );
  } else if (/ブロック|玉|跳ね|反射|崩し|ボール/.test(trimmed)) {
    dynamicToppings.push(
      { id: 'dyn_1', emoji: '🎱', text: 'ボールが3個に増えるマルチボールフィーバー' },
      { id: 'dyn_2', emoji: '🔥', text: 'ブロックを貫通するファイヤーボール変化' }
    );
  } else if (/ジャンプ|走る|ラン|避ける|アクション|迷路/.test(trimmed)) {
    dynamicToppings.push(
      { id: 'dyn_1', emoji: '🪽', text: '空中でさらにもう1回跳べる二段ジャンプ' },
      { id: 'dyn_2', emoji: '💨', text: '障害物をすり抜ける無敵ダッシュスキル' }
    );
  } else if (/パズル|落ち物|揃える|クイズ|頭脳/.test(trimmed)) {
    dynamicToppings.push(
      { id: 'dyn_1', emoji: '💣', text: '周囲を一気に消せるレインボー爆弾ピース' },
      { id: 'dyn_2', emoji: '💡', text: 'ピンチの時に一番良い場所を光って教えるヒント機能' }
    );
  }

  const combined = [...dynamicToppings, ...TOPPING_POOL];
  const seen = new Set<string>();
  const result: KosenTopping[] = [];

  for (const item of combined) {
    if (!seen.has(item.text) && result.length < maxCount) {
      seen.add(item.text);
      result.push(item);
    }
  }

  return result.slice(0, maxCount);
}

/**
 * Interactive AI Helper templates for visitors who want help coming up with a prompt.
 */
export interface HelperChoiceGroup {
  stepTitle: string;
  options: Array<{ id: string; emoji: string; label: string; promptFragment: string }>;
}

export const AI_HELPER_STEPS: HelperChoiceGroup[] = [
  {
    stepTitle: 'どんなジャンルのゲームにする？',
    options: [
      {
        id: 'genre_action',
        emoji: '🏃',
        label: 'ジャンプ＆アクション',
        promptFragment: '障害物をタイミングよくジャンプして進む横スクロールのアクションゲーム',
      },
      {
        id: 'genre_shooting',
        emoji: '🚀',
        label: '爽快シューティング',
        promptFragment: '次々に現れる敵をビームで撃ち落としてハイスコアを狙うシューティングゲーム',
      },
      {
        id: 'genre_breaker',
        emoji: '🧱',
        label: 'キラキラブロック崩し',
        promptFragment: 'ボールをパドルで跳ね返してカラフルなブロックを全部壊すブロック崩しゲーム',
      },
      {
        id: 'genre_catcher',
        emoji: '🧺',
        label: 'アイテムキャッチ',
        promptFragment: '空から降ってくるお宝やフルーツをカゴでキャッチして爆弾を避けるゲーム',
      },
    ],
  },
  {
    stepTitle: '主人公（キャラクター）はだれにする？',
    options: [
      {
        id: 'char_melonpan',
        emoji: '🍈',
        label: '空飛ぶメロンパン',
        promptFragment: '主人公は焼きたての可愛いメロンパンで、',
      },
      {
        id: 'char_cat',
        emoji: '🐱',
        label: '宇宙ネコ忍者',
        promptFragment: '主人公はマントをつけたカッコいい宇宙ネコ忍者で、',
      },
      {
        id: 'char_robot',
        emoji: '🤖',
        label: '高専メカ・ロボット',
        promptFragment: '主人公はレーザーとジェット噴射がついた高専ロボで、',
      },
      {
        id: 'char_dragon',
        emoji: '🐲',
        label: 'ちびっこドラゴン',
        promptFragment: '主人公は炎を吐く元気なちびっこドラゴンで、',
      },
    ],
  },
  {
    stepTitle: 'どんな世界（ステージ）で遊ぶ？',
    options: [
      {
        id: 'world_space',
        emoji: '🌌',
        label: 'キラキラ宇宙ステージ',
        promptFragment: '星や隕石が輝く宇宙空間を舞台にして作って！',
      },
      {
        id: 'world_sweets',
        emoji: '🍭',
        label: 'お菓子の国ステージ',
        promptFragment: 'クッキーやキャンディが並ぶカラフルなお菓子の国を舞台にして作って！',
      },
      {
        id: 'world_cyber',
        emoji: '⚡',
        label: 'サイバーネオン都市',
        promptFragment: 'ネオンが光る近未来のサイバー都市を舞台にして作って！',
      },
      {
        id: 'world_festival',
        emoji: '🏮',
        label: 'にぎやか高専祭会場',
        promptFragment: '屋台や花火が盛り上がる高専祭のお祭り会場を舞台にして作って！',
      },
    ],
  },
];

export function composeHelperPrompt(
  genreFragment: string,
  charFragment: string,
  worldFragment: string,
  basePrompt?: string
): string {
  const synthesized = `${charFragment}${genreFragment}。${worldFragment}`;
  if (basePrompt && basePrompt.trim()) {
    return `${basePrompt.trim()}、さらに${synthesized}`;
  }
  return synthesized;
}

export interface PromptExpansionOption {
  id: string;
  title: string;
  emoji: string;
  summary: string;
  expandedPrompt: string;
}

export const QUICK_EXPANSION_FRAGMENTS = [
  { id: 'frag_boss', emoji: '👾', label: '巨大ボス戦を追加', text: '途中で強力な巨大ボスが出現して激しいバトルになる' },
  { id: 'frag_fever', emoji: '🌈', label: '虹色フィーバーモード', text: '連続コンボで画面が虹色に輝く無敵フィーバータイムが発生する' },
  { id: 'frag_space', emoji: '🌌', label: '宇宙ステージ化', text: '背景で星屑や隕石が流れるキラキラの宇宙空間が舞台になる' },
  { id: 'frag_magnet', emoji: '🧲', label: 'お宝マグネット', text: '周りのコインやフルーツを自動で吸い寄せるアイテムが登場する' },
  { id: 'frag_music', emoji: '🎵', label: 'ノリノリBGM演出', text: 'ゲームの進行に合わせてテンポアップするレトロピコピコBGMを鳴らす' },
  { id: 'frag_laser', emoji: '⚡', label: 'ド派手レーザー必殺技', text: 'ゲージが満タンになると画面全体を薙ぎ払うビーム必殺技が撃てる' },
];

/**
 * Expands a pre-existing user prompt with richer ideas, mechanics, and story elements
 * using the configured Helper LLM model (or smart fallback).
 */
export async function expandPromptWithAI(
  currentPrompt: string,
  options?: { model?: string; provider?: ProviderType }
): Promise<PromptExpansionOption[]> {
  const trimmed = currentPrompt.trim();
  const keys = getStoredApiKeys();

  let targetProvider: ProviderType = options?.provider || 'gemini';
  let targetModel: string = options?.model || '';

  if (!targetModel) {
    try {
      const settings = await fetchExhibitionSettings();
      targetModel = settings.helperModel || 'gemini-3.5-flash';
      targetProvider = settings.helperProvider || 'gemini';
    } catch {
      targetModel = 'gemini-3.5-flash';
    }
  }

  // 1. Try Supabase Edge Function AI Proxy (Server-side API Key) first
  if (trimmed && targetProvider === 'gemini') {
    try {
      const proxyRes = await invokeKosenAiProxy<{ options: PromptExpansionOption[] }>('expand', {
        model: targetModel,
        prompt: trimmed,
      });
      if (proxyRes?.options && Array.isArray(proxyRes.options) && proxyRes.options.length >= 2) {
        return proxyRes.options.slice(0, 3);
      }
    } catch (err) {
      console.warn('Supabase Edge Function expand proxy failed, attempting local fallback:', err);
    }
  }

  // Find usable API key
  let provId: ProviderType = targetProvider;
  let provKey = keys[provId];
  const useServerProvider = targetProvider === 'openrouter' || targetProvider === 'surplus';
  if (!provKey && !useServerProvider) {
    const fallback = (
      [
        ['gemini', targetModel || 'gemini-3.5-flash'],
        ['openai', 'gpt-4o-mini'],
        ['anthropic', 'claude-3-5-haiku'],
        ['groq', 'llama-3.3-70b-versatile'],
        ['openrouter', 'meta-llama/llama-3.2-3b-instruct:free'],
      ] as const
    ).find(([p]) => Boolean(keys[p]));
    if (fallback) {
      provId = fallback[0];
      provKey = keys[provId];
      if (provId !== targetProvider) {
        targetModel = fallback[1];
      }
    }
  }

  if ((provKey || useServerProvider) && trimmed) {
    try {
      const provider = useServerProvider
        ? createServerGenerationProvider(targetProvider as 'openrouter' | 'surplus')
        : createProviderInstance(provId, targetModel, provKey);
      if (provider) {
        const sysPrompt = `あなたは高専祭（文化祭）の体験ゲーム制作を盛り上げるプロのゲームプランナーAIです。
ユーザーが入力したゲームの初期アイデアをもとに、さらに面白く、展示で注目を集める「3つの魅力的な拡張・肉付け案」を提案してください。
必ず以下のJSON配列形式のみを出力してください:
[
  {
    "title": "短い案タイトル(12文字以内)",
    "emoji": "絵文字1つ",
    "summary": "追加される魅力(25文字以内)",
    "expandedPrompt": "元のアイデアを活かしつつ自然に肉付けした完成プロンプト(80〜140文字程度)"
  }
]`;

        let rawText = '';
        for await (const chunk of provider.streamChat({
          model: targetModel,
          systemInstruction: sysPrompt,
          messages: [
            {
              role: 'user',
              parts: [
                {
                  text: `ユーザーの入力した初期アイデア: 「${trimmed}」\nこのアイデアをベースに、3つの異なる方向性（1: ギミック・必殺技強化、2: 世界観・キャラクター強化、3: お祭りフィーバー・ハイスコア強化）で拡張したJSON配列を出力してください:`,
                },
              ],
            },
          ],
        })) {
          if (chunk.type === 'text_delta' && chunk.delta) {
            rawText += chunk.delta;
          }
        }

        const jsonMatch = rawText.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (Array.isArray(parsed) && parsed.length >= 2) {
            return parsed.slice(0, 3).map((item: any, idx: number) => ({
              id: `ai_exp_${idx}_${Date.now()}`,
              title: String(item.title || `拡張プラン ${idx + 1}`),
              emoji: String(item.emoji || '✨'),
              summary: String(item.summary || 'アイデアをさらにパワーアップ！'),
              expandedPrompt: String(item.expandedPrompt || `${trimmed}、さらに面白いギミックを追加！`),
            }));
          }
        }
      }
    } catch (err) {
      console.warn('AI prompt expansion failed, using rule-based generator:', err);
    }
  }

  // Rule-based fallback based on user's prompt keywords
  return [
    {
      id: 'fallback_exp_1',
      title: '必殺技＆ギミック特化案',
      emoji: '⚡',
      summary: 'ゲージを溜めて画面全体の敵を爽快に吹き飛ばす！',
      expandedPrompt: `${trimmed}。さらにゲージが満タンになると画面全体を吹き飛ばすド派手な必殺技が発動し、連続コンボでスコアが跳ね上がるスリリングな仕掛けをプラス！`,
    },
    {
      id: 'fallback_exp_2',
      title: '世界観＆巨大ボス特化案',
      emoji: '👑',
      summary: 'ステージの奥に巨大なボスが出現し熱いバトルに！',
      expandedPrompt: `${trimmed}。さらにステージを進むと背景が変化して大迫力の巨大ボスが出現！ボスの弱点を狙ってアイテムを駆使しながら立ち向かう冒険ストーリーに！`,
    },
    {
      id: 'fallback_exp_3',
      title: '高専祭フィーバー特化案',
      emoji: '🎉',
      summary: 'お宝やフルーツが大量に降ってきて虹色に光る！',
      expandedPrompt: `${trimmed}。さらに高専祭のお祭りフィーバータイムが発生し、周囲のアイテムをマグネットで一気に吸い寄せながら花火が打ち上がる最高潮の演出を追加！`,
    },
  ];
}

/**
 * Generates an automatic title and 2-3 sentence summary description of the generated game
 * for the public gallery (`/gallery`).
 */
export async function generateGameSummaryAndTitle(params: {
  prompt: string;
  toppings: string[];
  userTitle?: string;
}): Promise<{ title: string; description: string }> {
  const cleanTitle = params.userTitle?.trim();
  const toppingSummary =
    params.toppings.length > 0
      ? `さらに「${params.toppings.slice(0, 3).join('」「')}」などの追加ギミックを搭載！`
      : '直感的な操作で誰でもすぐにハイスコアを目指せます！';

  const defaultTitle =
    cleanTitle ||
    (params.prompt.includes('メロンパン')
      ? 'メロンパン・ドリームアドベンチャー'
      : params.prompt.includes('宇宙') || params.prompt.includes('シューティング')
      ? 'ギャラクシー・スターシューター'
      : params.prompt.includes('ブロック')
      ? 'ネオン・ブロックブレイカーDX'
      : 'わくわく高専祭オリジナルゲーム');

  const defaultDescription = `「${params.prompt.slice(0, 70)}${
    params.prompt.length > 70 ? '...' : ''
  }」をテーマにAIが自動生成したオリジナルHTML5ゲームです。${toppingSummary}`;

  // 1. Try Supabase Edge Function AI Proxy (Server-side API Key) first
  try {
    const proxyRes = await invokeKosenAiProxy<{ title: string; description: string }>('summary', {
      prompt: params.prompt,
      toppings: params.toppings,
      userTitle: cleanTitle,
    });
    if (proxyRes?.title && proxyRes?.description) {
      return {
        title: cleanTitle || proxyRes.title,
        description: proxyRes.description,
      };
    }
  } catch (err) {
    console.warn('Supabase Edge Function summary proxy failed, attempting local fallback:', err);
  }

  const keys = getStoredApiKeys();
  const activeProviderEntry = (
    [
      ['gemini', 'gemini-3.5-flash-lite'],
      ['openai', 'gpt-4o-mini'],
      ['anthropic', 'claude-3-5-haiku'],
      ['groq', 'llama-3.3-70b-versatile'],
      ['openrouter', 'meta-llama/llama-3.2-3b-instruct:free'],
    ] as const
  ).find(([prov]) => Boolean(keys[prov]));

  if (activeProviderEntry) {
    const [provId, defaultModel] = activeProviderEntry;
    try {
      const provider = createProviderInstance(provId, defaultModel, keys[provId]);
      if (provider) {
        let rawText = '';
        for await (const chunk of provider.streamChat({
          model: defaultModel,
          systemInstruction:
            'あなたは高専祭のゲーム展示紹介AIです。プロンプトと追加要素から、魅力的な「作品名(title)」と「作品概要(description: 80〜120文字程度)」をJSON形式 {"title":"...","description":"..."} で出力してください。',
          messages: [
            {
              role: 'user',
              parts: [
                {
                  text: `プロンプト: ${params.prompt}\nトッピング: ${params.toppings.join(', ')}\n希望タイトル: ${cleanTitle || '(自動命名)'}`,
                },
              ],
            },
          ],
        })) {
          if (chunk.type === 'text_delta' && chunk.delta) {
            rawText += chunk.delta;
          }
        }
        const match = rawText.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          return {
            title: cleanTitle || parsed.title || defaultTitle,
            description: parsed.description || defaultDescription,
          };
        }
      }
    } catch {}
  }

  return {
    title: defaultTitle,
    description: defaultDescription,
  };
}

/**
 * Generates a complete, playable, rich HTML5 Canvas game deterministically when no LLM API key
 * is set in the browser (Exhibition Offline/Demo Fallback), customized to the user's prompt & toppings!
 */
export function buildInteractiveFallbackGameHtml(params: {
  title: string;
  prompt: string;
  toppings: string[];
}): string {
  const safeTitle = params.title.replace(/[<>"']/g, '');
  const safePrompt = params.prompt.replace(/[<>"']/g, '');
  const toppingsJson = JSON.stringify(params.toppings);
  const isShooting = /シューティング|宇宙|ビーム|レーザー|敵|撃/.test(params.prompt);
  const isRunner = /ジャンプ|走る|ラン|避ける|アクション/.test(params.prompt);

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <title>${safeTitle}</title>
  <style>
    * { box-sizing: border-box; user-select: none; -webkit-user-select: none; }
    body {
      margin: 0;
      padding: 0;
      background: radial-gradient(circle at center, #2b1d16 0%, #120c09 100%);
      color: #fffaf1;
      font-family: 'Hiragino Maru Gothic ProN', 'Yu Gothic', sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      overflow: hidden;
      touch-action: none;
    }
    #hud {
      position: absolute;
      top: 10px;
      left: 50%;
      transform: translateX(-50%);
      width: min(500px, 94vw);
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 16px;
      background: rgba(59, 39, 29, 0.85);
      border: 2px solid #c47c4a;
      border-radius: 999px;
      font-weight: bold;
      z-index: 10;
      box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    }
    canvas {
      border: 3px solid #c47c4a;
      border-radius: 20px;
      background: linear-gradient(180deg, #1e1410 0%, #0d0806 100%);
      box-shadow: 0 10px 30px rgba(0,0,0,0.6);
      max-width: 96vw;
      max-height: 82vh;
    }
    #controls {
      margin-top: 8px;
      font-size: 12px;
      opacity: 0.8;
      text-align: center;
    }
  </style>
</head>
<body>
  <div id="hud">
    <span>🍈 ${safeTitle}</span>
    <span id="scoreDisp">SCORE: 0</span>
    <span id="comboDisp">COMBO x1</span>
  </div>
  <canvas id="gameCanvas" width="480" height="640"></canvas>
  <div id="controls">🖱️マウス / 📱タッチスライド / ⌨️左右キー＆スペースで操作！</div>
  <script>
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    const scoreDisp = document.getElementById('scoreDisp');
    const comboDisp = document.getElementById('comboDisp');
    const toppings = ${toppingsJson};
    const mode = ${isShooting ? '"shooting"' : isRunner ? '"runner"' : '"breaker"'};

    let score = 0;
    let combo = 1;
    let frame = 0;
    let playerX = 240;
    let playerY = 560;
    let playerVy = 0;
    let isJumping = false;
    let particles = [];
    let stars = Array.from({ length: 45 }, () => ({
      x: Math.random() * 480,
      y: Math.random() * 640,
      s: Math.random() * 2.5 + 0.5,
      v: Math.random() * 1.5 + 0.4
    }));

    // Mode entities
    let ball = { x: 240, y: 340, vx: 4.2, vy: -5.2, r: 14 };
    let blocks = [];
    let bullets = [];
    let enemies = [];

    function initBlocks() {
      blocks = [];
      const colors = ['#ff6b8b', '#ffb86c', '#f1fa8c', '#50fa7b', '#8be9fd', '#bd93f9'];
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 6; c++) {
          blocks.push({
            x: 34 + c * 70,
            y: 85 + r * 34,
            w: 62,
            h: 24,
            color: colors[r % colors.length],
            alive: true
          });
        }
      }
    }
    initBlocks();

    function spawnFirework(x, y, color) {
      for (let i = 0; i < 18; i++) {
        const ang = (Math.PI * 2 * i) / 18;
        const spd = Math.random() * 4.5 + 1.5;
        particles.push({
          x, y,
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd,
          life: 35,
          color: color || ('hsl(' + Math.floor(Math.random() * 360) + ', 90%, 65%)')
        });
      }
    }

    function pointerMove(clientX) {
      const rect = canvas.getBoundingClientRect();
      playerX = Math.max(40, Math.min(440, (clientX - rect.left) * (canvas.width / rect.width)));
    }

    window.addEventListener('mousemove', (e) => pointerMove(e.clientX));
    window.addEventListener('touchmove', (e) => {
      if (e.touches[0]) pointerMove(e.touches[0].clientX);
    }, { passive: true });
    window.addEventListener('touchstart', (e) => {
      if (e.touches[0]) pointerMove(e.touches[0].clientX);
      if (mode === 'runner' && !isJumping) { playerVy = -12; isJumping = true; }
    }, { passive: true });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') playerX = Math.max(40, playerX - 32);
      if (e.key === 'ArrowRight') playerX = Math.min(440, playerX + 32);
      if (e.key === ' ' && mode === 'runner' && !isJumping) { playerVy = -12; isJumping = true; }
    });

    function update() {
      frame++;
      // Stars
      for (const st of stars) {
        st.y += st.v;
        if (st.y > 640) { st.y = 0; st.x = Math.random() * 480; }
      }

      if (mode === 'shooting') {
        if (frame % 12 === 0) {
          bullets.push({ x: playerX - 12, y: playerY - 20, vy: -9 });
          bullets.push({ x: playerX + 12, y: playerY - 20, vy: -9 });
        }
        if (frame % 35 === 0) {
          enemies.push({
            x: 40 + Math.random() * 400,
            y: -20,
            r: 20,
            vy: 2.2 + Math.random() * 2,
            color: 'hsl(' + Math.floor(Math.random() * 360) + ',85%,65%)'
          });
        }
        bullets.forEach(b => b.y += b.vy);
        bullets = bullets.filter(b => b.y > -20);
        enemies.forEach(en => {
          en.y += en.vy;
          bullets.forEach(b => {
            if (Math.hypot(en.x - b.x, en.y - b.y) < en.r + 6) {
              en.hit = true;
              b.y = -100;
              score += 50 * combo;
              combo = Math.min(10, combo + 1);
              spawnFirework(en.x, en.y, en.color);
            }
          });
          if (en.y > 650) combo = 1;
        });
        enemies = enemies.filter(en => !en.hit && en.y <= 650);
      } else if (mode === 'runner') {
        // Side-scrolling Jump Action Mode
        playerY += playerVy;
        playerVy += 0.65;
        if (playerY >= 520) {
          playerY = 520;
          playerVy = 0;
          isJumping = false;
        }
        if (frame % 55 === 0) {
          enemies.push({
            x: 500,
            y: Math.random() > 0.35 ? 520 : 430,
            r: 18,
            vx: -4.8,
            isCoin: Math.random() > 0.45,
            color: '#50fa7b'
          });
        }
        enemies.forEach(en => {
          en.x += en.vx;
          if (Math.hypot(en.x - playerX, en.y - playerY) < en.r + 22) {
            en.hit = true;
            if (en.isCoin) {
              score += 40 * combo;
              combo = Math.min(10, combo + 1);
              spawnFirework(en.x, en.y, '#f1fa8c');
            } else {
              combo = 1;
              spawnFirework(playerX, playerY, '#ff5555');
            }
          } else if (en.x < -20 && !en.isCoin && !en.passed) {
            en.passed = true;
            score += 15 * combo;
          }
        });
        enemies = enemies.filter(en => !en.hit && en.x > -40);
      } else {
        // Breaker bounce
        ball.x += ball.vx;
        ball.y += ball.vy;
        if (ball.x < ball.r || ball.x > 480 - ball.r) ball.vx *= -1;
        if (ball.y < 60) ball.vy *= -1;

        if (ball.y + ball.r >= playerY - 10 && ball.y - ball.r <= playerY + 14 && Math.abs(ball.x - playerX) < 62 && ball.vy > 0) {
          ball.vy = -Math.abs(ball.vy) * 1.02;
          ball.vx = (ball.x - playerX) * 0.14;
          score += 10 * combo;
          spawnFirework(ball.x, playerY - 10, '#f3c677');
        }

        if (ball.y > 650) {
          ball.x = playerX;
          ball.y = 320;
          ball.vy = -5.2;
          combo = 1;
        }

        let aliveCount = 0;
        for (const blk of blocks) {
          if (!blk.alive) continue;
          aliveCount++;
          if (ball.x + ball.r > blk.x && ball.x - ball.r < blk.x + blk.w && ball.y + ball.r > blk.y && ball.y - ball.r < blk.y + blk.h) {
            blk.alive = false;
            ball.vy *= -1;
            score += 30 * combo;
            combo = Math.min(12, combo + 1);
            spawnFirework(blk.x + blk.w / 2, blk.y + blk.h / 2, blk.color);
          }
        }
        if (aliveCount === 0) initBlocks();
      }

      // Particles
      particles.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.life--;
      });
      particles = particles.filter(p => p.life > 0);

      scoreDisp.textContent = 'SCORE: ' + score;
      comboDisp.textContent = 'COMBO x' + combo;
    }

    function draw() {
      ctx.clearRect(0, 0, 480, 640);
      // Stars
      ctx.fillStyle = 'rgba(255, 250, 241, 0.6)';
      for (const st of stars) {
        ctx.beginPath();
        ctx.arc(st.x, st.y, st.s, 0, Math.PI * 2);
        ctx.fill();
      }

      if (mode === 'shooting') {
        // Player ship
        ctx.fillStyle = '#f3c677';
        ctx.beginPath();
        ctx.arc(playerX, playerY, 22, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#8be9fd';
        bullets.forEach(b => ctx.fillRect(b.x - 3, b.y - 8, 6, 16));
        enemies.forEach(en => {
          ctx.fillStyle = en.color;
          ctx.beginPath();
          ctx.arc(en.x, en.y, en.r, 0, Math.PI * 2);
          ctx.fill();
        });
      } else if (mode === 'runner') {
        // Ground line
        ctx.strokeStyle = '#c47c4a';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(0, 544);
        ctx.lineTo(480, 544);
        ctx.stroke();
        // Jumping Melonpan Hero
        ctx.fillStyle = '#f3c677';
        ctx.beginPath();
        ctx.arc(playerX, playerY, 22, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#8c5327';
        ctx.lineWidth = 2.5;
        ctx.stroke();
        // Obstacles & Coins
        enemies.forEach(en => {
          ctx.fillStyle = en.isCoin ? '#f1fa8c' : '#ff6b8b';
          ctx.beginPath();
          ctx.arc(en.x, en.y, en.r, 0, Math.PI * 2);
          ctx.fill();
        });
      } else {
        // Blocks
        for (const blk of blocks) {
          if (!blk.alive) continue;
          ctx.fillStyle = blk.color;
          ctx.beginPath();
          ctx.roundRect(blk.x, blk.y, blk.w, blk.h, 8);
          ctx.fill();
        }
        // Paddle
        ctx.fillStyle = '#c47c4a';
        ctx.beginPath();
        ctx.roundRect(playerX - 55, playerY - 8, 110, 18, 9);
        ctx.fill();
        // Melonpan Ball
        ctx.fillStyle = '#f3c677';
        ctx.beginPath();
        ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#8c5327';
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }

      // Particles
      for (const p of particles) {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = Math.max(0, p.life / 35);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Active toppings badge at bottom
      if (toppings.length > 0) {
        ctx.fillStyle = 'rgba(255,250,241,0.55)';
        ctx.font = '11px sans-serif';
        ctx.fillText('トッピング: ' + toppings.slice(0, 2).join(' / '), 16, 626);
      }
    }

    function loop() {
      update();
      draw();
      requestAnimationFrame(loop);
    }
    loop();
  </script>
</body>
</html>`;
}
