import { useState } from 'react';
import {
  Sparkles,
  ToggleLeft,
  ToggleRight,
  ChevronDown,
  ChevronRight,
  FileText,
  Tag,
} from 'lucide-react';
import { SkillInfo } from '../types';

import {
  ANTI_AI_SLOP_SKILL_MD,
  GAME_ARCHITECTURE_SKILL_MD,
  RESPONSIVE_DESIGN_SKILL_MD,
  PHYSICS_ENGINE_SKILL_MD,
  THREEJS_3D_SKILL_MD,
} from '../services/embedded-skills';

const DEFAULT_SKILLS: SkillInfo[] = [
  {
    name: 'anti-ai-slop',
    description:
      'AI特有の紋切り型ネオン・過剰発光・パーティクル乱用を防止し、テーマに合った自然な配色とデザインを強制（デフォルト常時ON）',
    enabled: true,
    metadata: { version: '1.0.0', activation: 'default-on', license: 'MIT' },
    body: ANTI_AI_SLOP_SKILL_MD,
  },
  {
    name: 'game-architecture',
    description:
      'ゲームループ、ステートマシン (READY/PLAYING/GAMEOVER/RESTART)、Web Audio効果音、単一HTML5構成の基幹設計（デフォルト常時ON）',
    enabled: true,
    metadata: { version: '1.0.0', activation: 'default-on', license: 'MIT' },
    body: GAME_ARCHITECTURE_SKILL_MD,
  },
  {
    name: 'responsive-design',
    description:
      'スマートフォン（仮想パッド・マルチタッチ・タッチ追従）とPC（キーボード・マウス）の両対応および画面比率スケーリング（デフォルト常時ON）',
    enabled: true,
    metadata: { version: '1.0.0', activation: 'default-on', license: 'MIT' },
    body: RESPONSIVE_DESIGN_SKILL_MD,
  },
  {
    name: 'physics-engine',
    description:
      '異常な速度防止（Velocity Clamping）、壁抜け防止（Substepping）、フレームレート非依存の物理演算強化（プロンプト連動）',
    enabled: true,
    metadata: { version: '1.0.0', activation: 'prompt-driven', license: 'MIT' },
    body: PHYSICS_ENGINE_SKILL_MD,
  },
  {
    name: 'threejs-3d',
    description:
      'Three.jsを用いた複合プロシージャル3Dモデリング（THREE.Group）、ライティング・影、スムーズなカメラ制御（プロンプト連動）',
    enabled: true,
    metadata: { version: '1.0.0', activation: 'prompt-driven', license: 'MIT' },
    body: THREEJS_3D_SKILL_MD,
  },
];

export function SkillInspector() {
  const [skills, setSkills] = useState<SkillInfo[]>(DEFAULT_SKILLS);
  const [selectedSkill, setSelectedSkill] = useState<SkillInfo>(DEFAULT_SKILLS[0]);

  const toggleSkill = (name: string) => {
    setSkills((prev) =>
      prev.map((s) => (s.name === name ? { ...s, enabled: !s.enabled } : s))
    );
  };

  return (
    <div className="flex h-full bg-[var(--card)] select-none">
      {/* Skill List */}
      <div className="w-60 border-r-2 border-[var(--stroke)] bg-[var(--background)]/50 flex flex-col">
        <div className="p-3 border-b-2 border-[var(--stroke)] font-bold text-xs flex items-center justify-between opacity-80">
          <span>インデックス済みスキル</span>
          <span className="text-[11px] font-mono">{skills.length} skills</span>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
          {skills.map((s) => {
            const isSelected = selectedSkill.name === s.name;

            return (
              <div
                key={s.name}
                onClick={() => setSelectedSkill(s)}
                className={[
                  'p-2.5 rounded-xl border-2 transition-all cursor-pointer flex items-center justify-between',
                  isSelected
                    ? 'border-[var(--stroke)] bg-[var(--aesthetic-white)] rough-shadow-sm'
                    : 'border-transparent hover:bg-black/5 opacity-80',
                ].join(' ')}
              >
                <div className="truncate mr-2">
                  <div className="font-bold text-xs flex items-center gap-1.5">
                    <Sparkles size={12} className="text-[var(--accent)]" />
                    <span>{s.name}</span>
                  </div>
                  <div className="text-[10px] opacity-60 truncate">{s.description}</div>
                </div>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleSkill(s.name);
                  }}
                  className="p-1 hover:scale-110 transition-transform"
                  title={s.enabled ? '無効化' : '有効化'}
                >
                  {s.enabled ? (
                    <ToggleRight size={20} className="text-[var(--warm-success)]" />
                  ) : (
                    <ToggleLeft size={20} className="opacity-40" />
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Skill Detail View */}
      <div className="flex-1 overflow-y-auto p-5 bg-[var(--background)] space-y-4 text-xs">
        <div className="flex items-center justify-between border-b-2 border-[var(--stroke)] pb-3">
          <div>
            <h3 className="font-bold text-base flex items-center gap-2">
              <Sparkles size={16} className="text-[var(--accent)]" />
              {selectedSkill.name}
            </h3>
            <p className="opacity-70 mt-1 leading-relaxed text-xs">{selectedSkill.description}</p>
          </div>

          <span
            className={[
              'px-2.5 py-1 rounded-full text-xs font-semibold',
              selectedSkill.enabled
                ? 'bg-[#dcfce7] text-[#15803d] border border-[#22c55e]'
                : 'bg-black/10 opacity-60',
            ].join(' ')}
          >
            {selectedSkill.enabled ? '有効 (Active)' : '無効 (Disabled)'}
          </span>
        </div>

        {/* Triggers */}
        {selectedSkill.metadata?.triggers && (
          <div>
            <div className="font-bold opacity-75 mb-1.5 flex items-center gap-1.5">
              <Tag size={13} />
              発火トリガー語彙:
            </div>
            <div className="flex flex-wrap gap-1.5">
              {selectedSkill.metadata.triggers.split(',').map((t: string) => (
                <span
                  key={t}
                  className="px-2 py-0.5 rounded-lg bg-[var(--card)] border border-[var(--stroke)]/30 font-mono text-[11px]"
                >
                  {t.trim()}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Instruction Body */}
        <div>
          <div className="font-bold opacity-75 mb-1.5 flex items-center gap-1.5">
            <FileText size={13} />
            オンデマンド注入指示本文 (Markdown):
          </div>
          <pre className="p-4 rounded-xl bg-[var(--card)] border-2 border-[var(--stroke)] font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
            {selectedSkill.body}
          </pre>
        </div>
      </div>
    </div>
  );
}
