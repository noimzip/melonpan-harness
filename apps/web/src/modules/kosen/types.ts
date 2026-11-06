import { ProviderType } from '../../types';

export type AgeGroup = 'under12' | 'over13';
export type ModelTier = 'fast' | 'think' | 'ultra';
export type KosenSessionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface ModelTierConfig {
  tier: ModelTier;
  label: string;
  provider: ProviderType;
  model: string;
  thinkingEffort: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  description: string;
}

export type ModelTiersMap = Record<ModelTier, ModelTierConfig>;

export interface ExhibitionSettings {
  boothName: string;
  statusExpireMinutes: number;
  allowPublicSharing: boolean;
  enableVoiceInput: boolean;
  // Models configured from admin panel
  helperModel: string;
  helperProvider: ProviderType;
  toppingsModel: string;
  toppingsProvider: ProviderType;
  transcribeModel: string;
  transcribeProvider: ProviderType;
}

export interface KosenTopping {
  id: string;
  emoji: string;
  text: string;
  rubyText?: string;
  category?: string;
}

export interface KosenSessionRecord {
  id: string;
  age_group: AgeGroup;
  prompt: string;
  toppings: string[];
  model_tier: ModelTier;
  model_name: string;
  provider: ProviderType;
  thinking_effort: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  is_public: boolean;
  game_title: string | null;
  game_description: string | null;
  current_code: string;
  current_thought: string;
  turn_count: number;
  status: KosenSessionStatus;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  expires_at: string | null;
}

export interface KosenEventRecord {
  id: number;
  session_id: string;
  event_type: 'thought' | 'tool_call' | 'tool_result' | 'file_change' | 'complete' | 'error' | 'status';
  payload: {
    thought?: string;
    toolName?: string;
    args?: Record<string, any>;
    output?: string;
    filePath?: string;
    codePreview?: string;
    lineCount?: number;
    message?: string;
    summary?: string;
  };
  created_at: string;
}

export interface KosenGameRecord {
  id: string;
  session_id: string | null;
  title: string;
  description: string;
  html_content: string;
  age_group: AgeGroup;
  model_tier: ModelTier;
  toppings: string[];
  is_public: boolean;
  play_count: number;
  created_at: string;
}

export const DEFAULT_MODEL_TIERS: ModelTiersMap = {
  fast: {
    tier: 'fast',
    label: '高速 (Fast)',
    provider: 'gemini',
    model: 'gemini-3.5-flash-lite',
    thinkingEffort: 'minimal',
    description: 'サクッと完成！待ち時間が短く、すぐに遊べるシンプルで軽快なゲームを作ります。',
  },
  think: {
    tier: 'think',
    label: '思考 (Think)',
    provider: 'gemini',
    model: 'gemini-3.8-flash',
    thinkingEffort: 'medium',
    description: 'バランス重視！しっかり考えて面白いギミックや綺麗なエフェクトを実装します。',
  },
  ultra: {
    tier: 'ultra',
    label: '超思考 (Ultra)',
    provider: 'gemini',
    model: 'gemini-4-argon',
    thinkingEffort: 'high',
    description: '究極のこだわり！複雑な物理演算やボス戦、凝った演出まで徹底的に作り込みます。',
  },
};

export const DEFAULT_EXHIBITION_SETTINGS: ExhibitionSettings = {
  boothName: '高専祭 AIゲームクリエイター体験ブース',
  statusExpireMinutes: 5,
  allowPublicSharing: true,
  enableVoiceInput: true,
  helperModel: 'gemini-3.5-flash',
  helperProvider: 'gemini',
  toppingsModel: 'gemini-3.5-flash',
  toppingsProvider: 'gemini',
  transcribeModel: 'gemini-3.5-transcribe',
  transcribeProvider: 'gemini',
};
