import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { AgeGroup } from './types';

interface AgeContextValue {
  ageGroup: AgeGroup | null;
  isRubyMode: boolean;
  setAgeGroup: (group: AgeGroup | null) => void;
  setIsRubyMode: (enabled: boolean) => void;
}

const AGE_STORAGE_KEY = 'melonpan_kosen_age_group_v1';

const AgeContext = createContext<AgeContextValue>({
  ageGroup: null,
  isRubyMode: false,
  setAgeGroup: () => {},
  setIsRubyMode: () => {},
});

export function AgeProvider({ children }: { children: ReactNode }) {
  const [ageGroup, setAgeGroupState] = useState<AgeGroup | null>(() => {
    try {
      const saved = localStorage.getItem(AGE_STORAGE_KEY);
      if (saved === 'under12' || saved === 'over13') return saved;
    } catch {}
    return null;
  });

  const [isRubyMode, setIsRubyMode] = useState<boolean>(() => ageGroup === 'under12');

  const setAgeGroup = (group: AgeGroup | null) => {
    setAgeGroupState(group);
    const shouldRuby = group === 'under12';
    setIsRubyMode(shouldRuby);
    try {
      if (group) {
        localStorage.setItem(AGE_STORAGE_KEY, group);
      } else {
        localStorage.removeItem(AGE_STORAGE_KEY);
      }
    } catch {}
  };

  useEffect(() => {
    setIsRubyMode(ageGroup === 'under12');
  }, [ageGroup]);

  return (
    <AgeContext.Provider value={{ ageGroup, isRubyMode, setAgeGroup, setIsRubyMode }}>
      {children}
    </AgeContext.Provider>
  );
}

export function useAgeContext(): AgeContextValue {
  return useContext(AgeContext);
}

/**
 * Dictionary of common Kanji words used across the Kosen Exhibition UI and AI outputs.
 * Sorted from longest to shortest when building regex so compound words match before single chars.
 */
export const KANJI_RUBY_DICT: Array<[string, string]> = [
  ['高専祭', 'こうせんさい'],
  ['保護者', 'ほごしゃ'],
  ['利用規約', 'りようきやく'],
  ['体験者', 'たいけんしゃ'],
  ['来場者', 'らいじょうしゃ'],
  ['管理者', 'かんりしゃ'],
  ['現在時刻', 'げんざいじこく'],
  ['公開日時', 'こうかいにちじ'],
  ['作品名', 'さくひんめい'],
  ['作品概要', 'さくひんがいよう'],
  ['生成状況', 'せいせいじょうきょう'],
  ['追加要素', 'ついかようそ'],
  ['複数選択', 'ふくすうせんたく'],
  ['音声入力', 'おんせいにゅうりょく'],
  ['超思考', 'ちょうしこう'],
  ['無制限', 'むせいげん'],
  ['効果音', 'こうかおん'],
  ['必殺技', 'ひっさつわざ'],
  ['障害物', 'しょうがいぶつ'],
  ['制限時間', 'せいげんじかん'],
  ['重力反転', 'じゅうりょくはんてん'],
  ['二段ジャンプ', 'にだんじゃんぷ'],
  ['巨大ボス', 'きょだいぼす'],
  ['物理演算', 'ぶつりえんざん'],
  ['自動生成', 'じどうせいせい'],
  ['個人情報', 'こじんじょうほう'],
  ['注意事項', 'ちゅういじこう'],
  ['免責事項', 'めんせきじこう'],
  ['知的財産', 'ちてきざいさん'],
  ['公序良俗', 'こうじょりょうぞく'],
  ['不適切', 'ふてきせつ'],
  ['緊急停止', 'きんきゅうていし'],
  ['非公開', 'ひこうかい'],
  ['再生成', 'さいせいせい'],
  ['見守', 'みまも'],
  ['手伝', 'てつだ'],
  ['年齢', 'ねんれい'],
  ['選択', 'せんたく'],
  ['同意', 'どうい'],
  ['規約', 'きやく'],
  ['全文', 'ぜんぶん'],
  ['入力', 'にゅうりょく'],
  ['提案', 'ていあん'],
  ['高速', 'こうそく'],
  ['思考', 'しこう'],
  ['確認', 'かくにん'],
  ['共有', 'きょうゆう'],
  ['公開', 'こうかい'],
  ['開始', 'かいし'],
  ['状況', 'じょうきょう'],
  ['完了', 'かんりょう'],
  ['作成', 'さくせい'],
  ['生成', 'せいせい'],
  ['作品', 'さくひん'],
  ['概要', 'がいよう'],
  ['内容', 'ないよう'],
  ['要素', 'ようそ'],
  ['追加', 'ついか'],
  ['変更', 'へんこう'],
  ['管理', 'かんり'],
  ['動作', 'どうさ'],
  ['画面', 'がめん'],
  ['体験', 'たいけん'],
  ['展示', 'てんじ'],
  ['設定', 'せってい'],
  ['保存', 'ほぞん'],
  ['削除', 'さくじょ'],
  ['停止', 'ていし'],
  ['実行', 'じっこう'],
  ['待機', 'たいき'],
  ['失敗', 'しっぱい'],
  ['成功', 'せいこう'],
  ['読取', 'よみと'],
  ['読み取', 'よみと'],
  ['自動', 'じどう'],
  ['消滅', 'しょうめつ'],
  ['終了', 'しゅうりょう'],
  ['時間', 'じかん'],
  ['経過', 'けいか'],
  ['残り', 'のこ'],
  ['宇宙', 'うちゅう'],
  ['冒険', 'ぼうけん'],
  ['迷路', 'めいろ'],
  ['弾幕', 'だんまく'],
  ['人工知能', 'じんこうちのう'],
  ['電話番号', 'でんわばんごう'],
  ['学校名', 'がっこうめい'],
  ['小学生', 'しょうがくせい'],
  ['中学生', 'ちゅうがくせい'],
  ['高校生', 'こうこうせい'],
  ['高専生', 'こうせんせい'],
  ['進行中', 'しんこうちゅう'],
  ['テストプレイ', 'てすとぷれい'],
  ['お兄さん', 'おにいさん'],
  ['お姉さん', 'おねえさん'],
  ['お話し', 'おはなし'],
  ['お話', 'おはなし'],
  ['声', 'こえ'],
  ['お宝', 'おたから'],
  ['爆弾', 'ばくだん'],
  ['爆発', 'ばくはつ'],
  ['無敵', 'むてき'],
  ['巨大', 'きょだい'],
  ['加速', 'かそく'],
  ['得点', 'とくてん'],
  ['倍増', 'ばいぞう'],
  ['連続', 'れんぞく'],
  ['撃破', 'げきは'],
  ['出現', 'しゅつげん'],
  ['操作', 'そうさ'],
  ['移動', 'いどう'],
  ['発射', 'はっしゃ'],
  ['回避', 'かいひ'],
  ['挑戦', 'ちょうせん'],
  ['記録', 'きろく'],
  ['最高', 'さいこう'],
  ['簡単', 'かんたん'],
  ['複雑', 'ふくざつ'],
  ['究極', 'きゅうきょく'],
  ['演出', 'えんしゅつ'],
  ['音楽', 'おんがく'],
  ['背景', 'はいけい'],
  ['変化', 'へんか'],
  ['天気', 'てんき'],
  ['仲間', 'なかま'],
  ['変身', 'へんしん'],
  ['合体', 'がったい'],
  ['復活', 'ふっかつ'],
  ['秘密', 'ひみつ'],
  ['宝箱', 'たからばこ'],
  ['魔法', 'まほう'],
  ['忍者', 'にんじゃ'],
  ['勇者', 'ゆうしゃ'],
  ['魔王', 'まおう'],
  ['怪獣', 'かいじゅう'],
  ['動物', 'どうぶつ'],
  ['料理', 'りょうり'],
  ['お菓子', 'おかし'],
  ['花火', 'はなび'],
  ['虹色', 'にじいろ'],
  ['世界', 'せかい'],
  ['最初', 'さいしょ'],
  ['最後', 'さいご'],
  ['最終', 'さいしゅう'],
  ['人気', 'にんき'],
  ['重視', 'じゅうし'],
  ['本格派', 'ほんかくは'],
  ['考え方', 'かんがえかた'],
  ['使い方', 'つかいかた'],
  ['遊び方', 'あそびかた'],
  ['仕組み', 'しくみ'],
  ['本名', 'ほんみょう'],
  ['住所', 'じゅうしょ'],
  ['絶対', 'ぜったい'],
  ['掲載', 'けいさい'],
  ['表現', 'ひょうげん'],
  ['判断', 'はんだん'],
  ['消去', 'しょうきょ'],
  ['意図', 'いと'],
  ['発生', 'はっせい'],
  ['場合', 'ばあい'],
  ['気軽', 'きがる'],
  ['真ん中', 'まんなか'],
  ['向かって', 'むかって'],
  ['合わせて', 'あわせて'],
  ['好きな', 'すきな'],
  ['好き', 'すき'],
  ['構成', 'こうせい'],
  ['名前', 'なまえ'],
  ['空欄', 'くうらん'],
  ['様子', 'ようす'],
  ['完成', 'かんせい'],
  ['大人', 'おとな'],
  ['近く', 'ちかく'],
  ['呼んで', 'よんで'],
  ['呼ぶ', 'よぶ'],
  ['閉じる', 'とじる'],
  ['開く', 'ひらく'],
  ['触れて', 'ふれて'],
  ['使う', 'つかう'],
  ['使った', 'つかった'],
  ['光る', 'ひかる'],
  ['跳ねる', 'はねる'],
  ['崩し', 'くずし'],
  ['走る', 'はしる'],
  ['飛ぶ', 'とぶ'],
  ['泳ぐ', 'およぐ'],
  ['守る', 'まもる'],
  ['戦う', 'たたかう'],
  ['集める', 'あつめる'],
  ['避ける', 'よける'],
  ['当てる', 'あてる'],
  ['押す', 'おす'],
  ['戻る', 'もどる'],
  ['進む', 'すすむ'],
  ['進めて', 'すすめて'],
  ['選ぶ', 'えらぶ'],
  ['選んで', 'えらんで'],
  ['選ぼう', 'えらぼう'],
  ['選んだ', 'えらんだ'],
  ['話す', 'はなす'],
  ['話して', 'はなして'],
  ['作る', 'つくる'],
  ['作って', 'つくって'],
  ['作ろう', 'つくろう'],
  ['作った', 'つくった'],
  ['作られる', 'つくられる'],
  ['遊ぶ', 'あそぶ'],
  ['遊んで', 'あそんで'],
  ['遊べる', 'あそべる'],
  ['遊べます', 'あそべます'],
  ['見る', 'みる'],
  ['見て', 'みて'],
  ['見れる', 'みれる'],
  ['書く', 'かく'],
  ['書いて', 'かいて'],
  ['消える', 'きえる'],
  ['消えます', 'きえます'],
  ['考えて', 'かんがえて'],
  ['考える', 'かんがえる'],
  ['組み立てて', 'くみたてて'],
  ['載せる', 'のせる'],
  ['歳', 'さい'],
  ['以上', 'いじょう'],
  ['以下', 'いか'],
  ['人', 'ひと'],
  ['先', 'さき'],
  ['次', 'つぎ'],
  ['前', 'まえ'],
  ['今', 'いま'],
  ['下', 'した'],
  ['上', 'うえ'],
  ['中', 'なか'],
  ['外', 'そと'],
  ['分', 'ふん'],
  ['秒', 'びょう'],
  ['回', 'かい'],
  ['個', 'こ'],
  ['条', 'じょう'],
  ['第', 'だい'],
  ['本', 'ほん'],
  ['他', 'ほか'],
  ['際', 'さい'],
  ['敵', 'てき'],
  ['玉', 'たま'],
  ['壁', 'かべ'],
  ['床', 'ゆか'],
  ['空', 'そら'],
  ['海', 'うみ'],
  ['星', 'ほし'],
  ['炎', 'ほのお'],
  ['氷', 'こおり'],
  ['雷', 'かみなり'],
  ['風', 'かぜ'],
  ['光', 'ひかり'],
  ['闇', 'やみ'],
];

// Sort dictionary longest key first
const SORTED_DICT = [...KANJI_RUBY_DICT].sort((a, b) => b[0].length - a[0].length);

/**
 * Converts plain text or text containing inline `<ruby>漢字<rt>かんじ</rt></ruby>`
 * or `{漢字|かんじ}` notation into React elements with `<ruby>` tags when isRubyMode is active.
 * When isRubyMode is false, strips ruby annotations and returns clean text.
 */
export function renderTextWithRuby(text: string, isRubyMode: boolean): ReactNode {
  if (!text) return text;

  // First normalize any HTML <ruby>X<rt>Y</rt></ruby> into {X|Y}
  const normalized = text.replace(
    /<ruby>\s*([^<]+?)\s*<rt>\s*([^<]+?)\s*<\/rt>\s*<\/ruby>/gi,
    '{$1|$2}'
  );

  if (!isRubyMode) {
    // Strip {Kanji|Reading} -> Kanji
    return normalized.replace(/\{([^|{}]+)\|([^{}]+)\}/g, '$1');
  }

  // Apply automatic dictionary annotations on segments outside existing {X|Y} blocks
  const segments = normalized.split(/(\{[^|{}]+\|[^{}]+\})/g);
  const annotatedSegments: string[] = segments.map((seg) => {
    if (seg.startsWith('{') && seg.endsWith('}') && seg.includes('|')) {
      return seg;
    }
    let current = seg;
    // Use placeholders so we don't double-replace inside already matched words
    const replacements: Array<{ token: string; replacement: string }> = [];
    SORTED_DICT.forEach(([kanji, reading], idx) => {
      if (current.includes(kanji)) {
        const token = `__RUBY_${idx}__`;
        replacements.push({ token, replacement: `{${kanji}|${reading}}` });
        current = current.split(kanji).join(token);
      }
    });
    for (const r of replacements) {
      current = current.split(r.token).join(r.replacement);
    }
    return current;
  });

  const combined = annotatedSegments.join('');
  const parts = combined.split(/(\{[^|{}]+\|[^{}]+\})/g);

  return parts.map((part, index) => {
    const match = part.match(/^\{([^|{}]+)\|([^{}]+)\}$/);
    if (match) {
      return (
        <ruby key={index} className="ruby-annotated mx-[1px]">
          {match[1]}
          <rt className="text-[0.62em] text-[var(--accent)] font-normal select-none leading-none">
            {match[2]}
          </rt>
        </ruby>
      );
    }
    return <React.Fragment key={index}>{part}</React.Fragment>;
  });
}

/**
 * Component wrapper that renders text with automatic or explicit furigana in under-12 mode.
 */
export function RubyText({
  children,
  text,
  forceRuby,
  className = '',
}: {
  children?: string;
  text?: string;
  forceRuby?: boolean;
  className?: string;
}) {
  const { isRubyMode } = useAgeContext();
  const activeRuby = forceRuby !== undefined ? forceRuby : isRubyMode;
  const content = text ?? (typeof children === 'string' ? children : '');

  return <span className={className}>{renderTextWithRuby(content, activeRuby)}</span>;
}

/**
 * Explicit single-word `<Ruby>` component as specified in plan.
 */
export function Ruby({
  text,
  rt,
  children,
}: {
  text?: string;
  rt: string;
  children?: ReactNode;
}) {
  const { isRubyMode } = useAgeContext();
  const body = text ?? children;
  if (!isRubyMode) return <>{body}</>;
  return (
    <ruby className="ruby-annotated mx-[1px]">
      {body}
      <rt className="text-[0.62em] text-[var(--accent)] font-normal select-none leading-none">
        {rt}
      </rt>
    </ruby>
  );
}
