import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import {
  Sparkles,
  Mic,
  MicOff,
  Wand2,
  Check,
  ChevronRight,
  ChevronLeft,
  ShieldCheck,
  Users,
  Zap,
  Brain,
  Rocket,
  Share2,
  QrCode,
  Play,
  RotateCcw,
  Gamepad2,
  Trophy,
  ExternalLink,
  Volume2,
} from 'lucide-react';
import { HandDrawnFilter } from '../../../components/HandDrawnFilter';
import { WobblyButton } from '../../../components/WobblyButton';
import { WobblyCard } from '../../../components/WobblyCard';
import { SandboxViewer } from '../../../components/SandboxViewer';
import { useAgeContext, RubyText } from '../age-context';
import {
  AgeGroup,
  DEFAULT_EXHIBITION_SETTINGS,
  DEFAULT_MODEL_TIERS,
  ExhibitionSettings,
  KosenSessionRecord,
  KosenTopping,
  ModelTier,
  ModelTiersMap,
} from '../types';
import { fetchExhibitionSettings, fetchModelTiers } from '../supabase';
import {
  AI_HELPER_STEPS,
  composeHelperPrompt,
  expandPromptWithAI,
  generateToppingsForPrompt,
  PromptExpansionOption,
  QUICK_EXPANSION_FRAGMENTS,
} from '../toppings-service';
import { useSpeechInput } from '../speech-input';
import { startKosenGeneration } from '../kosen-runner';

type WizardStep =
  | 'age'
  | 'terms'
  | 'prompt'
  | 'toppings'
  | 'model'
  | 'confirm'
  | 'qrcode';

const STEP_LABELS: Array<{ id: WizardStep; label: string }> = [
  { id: 'age', label: '① 年齢選択' },
  { id: 'terms', label: '② 利用規約' },
  { id: 'prompt', label: '③ アイデア入力' },
  { id: 'toppings', label: '④ トッピング' },
  { id: 'model', label: '⑤ モデル選択' },
  { id: 'confirm', label: '⑥ 最終確認' },
  { id: 'qrcode', label: '⑦ QRコード＆生成' },
];

export function KioskWizardPage() {
  const { ageGroup, isRubyMode, setAgeGroup, setIsRubyMode } = useAgeContext();

  const [step, setStep] = useState<WizardStep>('age');
  const [showGuardianModal, setShowGuardianModal] = useState(false);
  const [termsAgreed, setTermsAgreed] = useState(false);

  // Step 3: Prompt & AI Helper
  const [prompt, setPrompt] = useState('');
  const [isHelperOpen, setIsHelperOpen] = useState(false);
  const [helperSelections, setHelperSelections] = useState<[number, number, number]>([0, 0, 0]);
  const [expansionOptions, setExpansionOptions] = useState<PromptExpansionOption[]>([]);
  const [isLoadingExpansions, setIsLoadingExpansions] = useState(false);
  const [helperMode, setHelperMode] = useState<'expand' | 'scratch'>('expand');

  // Step 4: Toppings
  const [proposedToppings, setProposedToppings] = useState<KosenTopping[]>([]);
  const [selectedToppings, setSelectedToppings] = useState<string[]>([]);
  const [isLoadingToppings, setIsLoadingToppings] = useState(false);

  // Step 5: Model Tier & Exhibition Settings
  const [modelTiers, setModelTiers] = useState<ModelTiersMap>(DEFAULT_MODEL_TIERS);
  const [exhibitionSettings, setExhibitionSettings] = useState<ExhibitionSettings>(
    DEFAULT_EXHIBITION_SETTINGS
  );
  const [selectedTier, setSelectedTier] = useState<ModelTier>('think');

  // Step 6: Confirmation & Sharing
  const [sharePublicly, setSharePublicly] = useState(true);
  const [gameTitle, setGameTitle] = useState('');

  // Step 7: Active Session & Live Generation Preview
  const [createdSession, setCreatedSession] = useState<KosenSessionRecord | null>(null);
  const [liveThought, setLiveThought] = useState('');
  const [liveCode, setLiveCode] = useState('');
  const [liveStatus, setLiveStatus] = useState<KosenSessionRecord['status']>('pending');

  // Voice input hook powered by gemini-3.5-transcribe
  const speech = useSpeechInput((finalText) => {
    setPrompt((prev) => (prev ? `${prev} ${finalText}` : finalText));
  }, exhibitionSettings.transcribeModel || 'gemini-3.5-transcribe');

  useEffect(() => {
    fetchModelTiers().then(setModelTiers).catch(() => {});
    fetchExhibitionSettings()
      .then((s) => {
        setExhibitionSettings(s);
        if (step === 'age') {
          setSharePublicly(s.allowPublicSharing);
        }
      })
      .catch(() => {});
  }, [step]);

  // Handlers
  const handleSelectAge = (selected: AgeGroup) => {
    setAgeGroup(selected);
    if (selected === 'under12') {
      setShowGuardianModal(true);
    } else {
      setStep('terms');
    }
  };

  const handleConfirmGuardianModal = () => {
    setShowGuardianModal(false);
    setStep('terms');
  };

  const handleAgreeTerms = () => {
    setTermsAgreed(true);
    setStep('prompt');
  };

  const handleProceedToToppings = async () => {
    if (!prompt.trim()) return;
    if (speech.isListening) speech.stopListening();
    setStep('toppings');
    setIsLoadingToppings(true);
    try {
      const list = await generateToppingsForPrompt(prompt, 10, {
        model: exhibitionSettings.toppingsModel || 'gemini-3.5-flash',
        provider: exhibitionSettings.toppingsProvider || 'gemini',
      });
      setProposedToppings(list);
    } finally {
      setIsLoadingToppings(false);
    }
  };

  const toggleTopping = (text: string) => {
    setSelectedToppings((prev) =>
      prev.includes(text) ? prev.filter((t) => t !== text) : [...prev, text]
    );
  };

  const handleOpenHelper = async () => {
    setIsHelperOpen(true);
    if (prompt.trim()) {
      setHelperMode('expand');
      setIsLoadingExpansions(true);
      try {
        const opts = await expandPromptWithAI(prompt, {
          model: exhibitionSettings.helperModel || 'gemini-3.5-flash',
          provider: exhibitionSettings.helperProvider || 'gemini',
        });
        setExpansionOptions(opts);
      } finally {
        setIsLoadingExpansions(false);
      }
    } else {
      setHelperMode('scratch');
    }
  };

  const handleApplyHelper = () => {
    const g = AI_HELPER_STEPS[0].options[helperSelections[0]].promptFragment;
    const c = AI_HELPER_STEPS[1].options[helperSelections[1]].promptFragment;
    const w = AI_HELPER_STEPS[2].options[helperSelections[2]].promptFragment;
    const synthesized = composeHelperPrompt(g, c, w, prompt);
    setPrompt(synthesized);
    setIsHelperOpen(false);
  };

  const handleApplyExpansionOption = (opt: PromptExpansionOption) => {
    setPrompt(opt.expandedPrompt);
    setIsHelperOpen(false);
  };

  const handleAppendFragment = (text: string) => {
    setPrompt((prev) => (prev ? `${prev.trim()}、さらに${text}` : text));
  };

  const handleStartGeneration = async () => {
    const tierCfg = modelTiers[selectedTier] || DEFAULT_MODEL_TIERS[selectedTier];
    setLiveThought('AIゲームクリエイターを起動しています...');
    setLiveCode('');
    setLiveStatus('running');
    setStep('qrcode');

    const session = await startKosenGeneration({
      ageGroup: ageGroup || 'over13',
      prompt,
      toppings: selectedToppings,
      tierConfig: tierCfg,
      isPublic: sharePublicly,
      gameTitle: gameTitle.trim() || undefined,
      onProgress: (upd) => {
        if (upd.thought) setLiveThought(upd.thought);
        if (upd.code) setLiveCode(upd.code);
        if (upd.status) setLiveStatus(upd.status);
      },
    });

    setCreatedSession(session);
  };

  const handleResetWizard = () => {
    setStep('age');
    setTermsAgreed(false);
    setPrompt('');
    setSelectedToppings([]);
    setGameTitle('');
    setCreatedSession(null);
    setLiveThought('');
    setLiveCode('');
    setLiveStatus('pending');
  };

  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173';
  const statusUrl = createdSession
    ? `${origin}/status/${createdSession.id}`
    : `${origin}/status/demo`;
  const galleryUrl = `${origin}/gallery`;

  return (
    <div className="min-h-screen w-full bg-[var(--background)] text-[var(--foreground)] flex flex-col font-sans select-none">
      <HandDrawnFilter />

      {/* Top Navigation Bar */}
      <header className="px-4 sm:px-8 py-3.5 bg-[var(--card)] border-b-2 border-[var(--stroke)] flex flex-wrap items-center justify-between gap-3 sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <span className="text-3xl">🍈</span>
          <div>
            <h1 className="text-lg sm:text-xl font-bold tracking-tight">
              <RubyText text={exhibitionSettings.boothName || '高専祭 AIゲームクリエイター体験'} />
            </h1>
            <p className="text-xs opacity-75">
              <RubyText text="あなたのアイデアから世界にひとつだけのゲームを作ろう！" />
            </p>
          </div>
        </div>

        {/* Ruby Toggle & Quick Links */}
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            onClick={() => setIsRubyMode(!isRubyMode)}
            className={[
              'px-3 py-1.5 rounded-full text-xs font-bold border-2 border-[var(--stroke)] transition-all cursor-pointer',
              isRubyMode
                ? 'bg-[var(--accent)] text-white'
                : 'bg-[var(--background)] text-[var(--foreground)] opacity-80',
            ].join(' ')}
          >
            {isRubyMode ? '🟢 ふりがな ON (0〜12さい)' : '⚪ ふりがな OFF (13さい〜)'}
          </button>

          <Link
            to="/gallery"
            className="px-3 py-1.5 rounded-full text-xs font-bold border-2 border-[var(--stroke)] bg-[var(--background)] hover:bg-black/5 flex items-center gap-1"
          >
            <Trophy size={14} className="text-[var(--accent)]" />
            <RubyText text="みんなのゲーム" />
          </Link>

        </div>
      </header>

      {/* Stepper Indicator */}
      <div className="bg-[var(--card)]/50 border-b border-[var(--stroke)]/20 px-4 py-2.5 overflow-x-auto">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-2 min-w-[540px]">
          {STEP_LABELS.map((s, idx) => {
            const currentIdx = STEP_LABELS.findIndex((item) => item.id === step);
            const isActive = s.id === step;
            const isDone = idx < currentIdx;
            return (
              <div
                key={s.id}
                className={[
                  'flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold transition-all',
                  isActive
                    ? 'bg-[var(--accent)] text-white shadow-sm scale-105'
                    : isDone
                    ? 'bg-[var(--warm-success)]/20 text-[var(--warm-success)]'
                    : 'opacity-45',
                ].join(' ')}
              >
                {isDone && <Check size={12} />}
                <RubyText text={s.label} />
              </div>
            );
          })}
        </div>
      </div>

      {/* Main Step Container */}
      <main className={`flex-1 w-full mx-auto p-4 sm:p-8 flex flex-col justify-center ${step === 'age' ? '' : 'max-w-4xl'}`}>
        {/* ─── STEP 1: AGE SELECTION ─── */}
        {step === 'age' && (
          <div className="flex-1 w-full flex flex-col justify-center gap-8 text-center">
            <div className="space-y-2">
              <span className="inline-block px-4 py-1 rounded-full bg-[var(--warm-badge)] text-xs font-bold">
                STEP 1 / 7
              </span>
              <h2 className="text-2xl sm:text-3xl font-bold">
                <RubyText text="あなたの年齢（ねんれい）をえらんでね！" />
              </h2>
              <p className="text-sm opacity-75">
                <RubyText text="0〜12歳をえらぶと、すべての漢字に「ふりがな」がつくよ！" />
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 w-full flex-1 max-h-[32rem] pt-2">
              {/* 0 - 12 button */}
              <button
                type="button"
                onClick={() => handleSelectAge('under12')}
                className="group p-8 rounded-3xl border-3 border-[var(--stroke)] bg-[var(--background)] hover:bg-[#fff3dc] rough-shadow hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer flex flex-col items-center justify-center gap-4"
              >
                <span className="text-6xl group-hover:scale-110 transition-transform">🐣</span>
                <div className="space-y-1">
                  <div className="text-2xl sm:text-3xl font-extrabold text-[var(--accent)]">
                    0〜12<ruby>歳<rt className="text-xs">さい</rt></ruby>
                  </div>
                  <p className="text-xs font-bold opacity-80">
                    （小学生以下・かんじにふりがながつくよ）
                  </p>
                </div>
              </button>

              {/* 13+ button */}
              <button
                type="button"
                onClick={() => handleSelectAge('over13')}
                className="group p-8 rounded-3xl border-3 border-[var(--stroke)] bg-[var(--background)] hover:bg-[#f2ece1] rough-shadow hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer flex flex-col items-center justify-center gap-4"
              >
                <span className="text-6xl group-hover:scale-110 transition-transform">🐔</span>
                <div className="space-y-1">
                  <div className="text-2xl sm:text-3xl font-extrabold">13歳以上</div>
                  <p className="text-xs font-bold opacity-80">
                    （中学生・高校生・高専生・大人の方）
                  </p>
                </div>
              </button>
            </div>
          </div>
        )}

        {/* ─── STEP 2: TERMS OF USE ─── */}
        {step === 'terms' && (
          <WobblyCard className="p-6 sm:p-10 space-y-6">
            <div className="flex items-center justify-between">
              <span className="px-3 py-1 rounded-full bg-[var(--warm-badge)] text-xs font-bold">
                STEP 2 / 7
              </span>
              <WobblyButton variant="ghost" size="sm" onClick={() => setStep('age')}>
                <ChevronLeft size={16} />
                <RubyText text="年齢選択に戻る" />
              </WobblyButton>
            </div>

            <div className="space-y-3">
              <h2 className="text-2xl font-bold flex items-center gap-2">
                <ShieldCheck className="text-[var(--accent)]" size={28} />
                <RubyText text="利用規約（りようきやく）の確認" />
              </h2>

              {/* Special notice required for 0-12 years old */}
              {ageGroup === 'under12' && (
                <div className="p-4 rounded-2xl border-2 border-[var(--accent)] bg-[#fff3dc] text-[var(--foreground)] flex items-center gap-3 shadow-sm">
                  <Users size={28} className="text-[var(--accent)] shrink-0" />
                  <div className="text-base sm:text-lg font-extrabold text-[var(--accent)]">
                    <RubyText
                      text="ここは保護者の人に手伝ってもらってね"
                      forceRuby={true}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Full Terms of Use Text */}
            <div className="p-5 rounded-2xl border-2 border-[var(--stroke)]/60 bg-[var(--background)] max-h-72 overflow-y-auto space-y-4 text-sm leading-relaxed">
              <h3 className="font-bold text-base">
                <RubyText text="【高専祭 AIゲーム制作体験 利用規約（全文）】" />
              </h3>
              <p>
                <RubyText text="第1条（目的）本システムは、高専祭の展示ブースにおいて、来場者がAI（人工知能）を使ったゲーム制作を体験し、楽しみながらプログラミングやAIの仕組みに触れていただくための体験システムです。" />
              </p>
              <p>
                <RubyText text="第2条（個人情報の入力禁止）ゲームのアイデア（プロンプト）や作品名を入力する際、あなたや他の人の本名、住所、電話番号、学校名などの個人情報は絶対に入力しないでください。" />
              </p>
              <p>
                <RubyText text="第3条（作品の公開と共有）確認画面で「みんなとゲームを共有する」を選んだ場合、作成されたゲームと作品名は「みんなのゲーム公開ページ」に掲載され、他の来場者もスマートフォンや会場端末から遊べるようになります。不適切な表現が含まれる場合、スタッフの判断で非公開または削除することがあります。" />
              </p>
              <p>
                <RubyText text="第4条（生成状況ページの自動消去）スマートフォンから確認できるリアルタイム生成状況ページは、ゲーム完成から5分後に自動的に消えます。完成後も遊びたい場合は「みんなのゲーム公開ページ」からアクセスしてください。" />
              </p>
              <p>
                <RubyText text="第5条（免責事項）AIが自動生成するプログラムのため、意図しない動作やバグが発生する場合があります。困ったときは近くのスタッフにお気軽にお声がけください。" />
              </p>
            </div>

            <div className="flex justify-center pt-2">
              <WobblyButton
                variant="primary"
                size="lg"
                onClick={handleAgreeTerms}
                className="w-full sm:w-auto min-w-[260px] text-lg py-4"
              >
                <Check size={22} />
                <RubyText text="規約に同意して進む" />
              </WobblyButton>
            </div>
          </WobblyCard>
        )}

        {/* ─── STEP 3: PROMPT INPUT (WITH MIC & AI HELPER) ─── */}
        {step === 'prompt' && (
          <WobblyCard className="p-6 sm:p-10 space-y-6">
            <div className="flex items-center justify-between">
              <span className="px-3 py-1 rounded-full bg-[var(--warm-badge)] text-xs font-bold">
                STEP 3 / 7
              </span>
              <WobblyButton variant="ghost" size="sm" onClick={() => setStep('terms')}>
                <ChevronLeft size={16} />
                <RubyText text="前に戻る" />
              </WobblyButton>
            </div>

            <div className="text-center space-y-2">
              <h2 className="text-2xl sm:text-3xl font-bold">
                <RubyText text="どんなゲームを作りたい？" />
              </h2>
              <p className="text-sm opacity-75">
                <RubyText text="真ん中のボックスに入力するか、マイクボタンでお話ししてね！" />
              </p>
            </div>

            {/* Center Prompt Input Box */}
            <div className="space-y-3">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={4}
                placeholder="例：空飛ぶメロンパンが宇宙でイチゴを集めながらエイリアンをよけるアクションゲーム！"
                className="w-full p-5 rounded-3xl border-3 border-[var(--stroke)] bg-[var(--background)] text-lg font-medium focus:outline-none focus:ring-4 focus:ring-[var(--accent)]/30 resize-none rough-shadow"
              />
              {speech.isListening && (
                <div className="p-3.5 rounded-2xl bg-[#fff3dc] border-2 border-[var(--accent)] text-sm font-bold flex flex-col sm:flex-row items-center justify-center gap-2 animate-pulse">
                  <div className="flex items-center gap-2">
                    <Volume2 size={18} className="text-[var(--accent)]" />
                    <span>
                      {speech.isTranscribing
                        ? `✨ AI (${speech.modelUsed}) が音声を解析しています...`
                        : '🎙️ お話し中... マイクに向かって話してね！'}
                    </span>
                  </div>
                  {speech.interimTranscript && (
                    <span className="text-xs opacity-80 font-mono">
                      ({speech.interimTranscript})
                    </span>
                  )}
                </div>
              )}
              {speech.error && (
                <p className="text-xs text-[var(--warm-error)] text-center font-bold">
                  {speech.error}
                </p>
              )}
            </div>

            {/* Vertically Stacked Mic Button and AI Helper Button as requested */}
            <div className="flex flex-col items-center gap-4 pt-2">
              {/* 1. Microphone Button (Voice Input powered by gemini-3.5-transcribe) */}
              <WobblyButton
                variant={speech.isListening ? 'danger' : 'secondary'}
                size="lg"
                onClick={speech.toggleListening}
                className="w-full max-w-md py-4 text-base font-bold"
              >
                {speech.isTranscribing ? (
                  <>
                    <Sparkles size={22} className="animate-spin text-[var(--accent)]" />
                    <RubyText text={`✨ 文字起こし中 (${speech.modelUsed})...`} />
                  </>
                ) : speech.isRecording ? (
                  <>
                    <MicOff size={22} />
                    <RubyText text="音声入力をストップして文字にする" />
                  </>
                ) : (
                  <>
                    <Mic size={22} className="text-[var(--accent)]" />
                    <RubyText text="🎤 マイクボタン（声で入力する）" />
                  </>
                )}
              </WobblyButton>

              {/* 2. AI Helper Button below Mic Button */}
              <WobblyButton
                variant="outline"
                size="lg"
                onClick={handleOpenHelper}
                className="w-full max-w-md py-3.5 text-base font-bold border-2 border-dashed"
              >
                <Wand2 size={20} className="text-[var(--accent)]" />
                <RubyText
                  text={
                    prompt.trim()
                      ? '✨ AIにアイデアを拡張・パワーアップしてもらう！'
                      : '✨ AIにお手伝いしてもらう（かんたん作成）'
                  }
                />
              </WobblyButton>
            </div>

            {/* Next Step Button */}
            <div className="flex justify-end pt-4 border-t border-[var(--stroke)]/20">
              <WobblyButton
                variant="primary"
                size="lg"
                disabled={!prompt.trim()}
                onClick={handleProceedToToppings}
                className="w-full sm:w-auto min-w-[220px]"
              >
                <RubyText text="次へ（トッピングを選ぶ）" />
                <ChevronRight size={20} />
              </WobblyButton>
            </div>
          </WobblyCard>
        )}

        {/* ─── STEP 4: TOPPINGS PAGE (UP TO 10 AI PROPOSALS, MULTI-SELECT) ─── */}
        {step === 'toppings' && (
          <WobblyCard className="p-6 sm:p-10 space-y-6">
            <div className="flex items-center justify-between">
              <span className="px-3 py-1 rounded-full bg-[var(--warm-badge)] text-xs font-bold">
                STEP 4 / 7
              </span>
              <WobblyButton variant="ghost" size="sm" onClick={() => setStep('prompt')}>
                <ChevronLeft size={16} />
                <RubyText text="アイデア入力に戻る" />
              </WobblyButton>
            </div>

            <div className="space-y-1">
              <h2 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
                <Sparkles className="text-[var(--accent)]" size={28} />
                <RubyText text="ゲームに「トッピング」を追加しよう！" />
              </h2>
              <p className="text-sm opacity-75">
                <RubyText text="あなたのアイデアに合わせてAIが10個の面白そうな要素を提案したよ！好きなだけ選んでね（複数選択OK）" />
              </p>
            </div>

            {isLoadingToppings ? (
              <div className="py-12 text-center space-y-3">
                <div className="inline-block w-10 h-10 border-4 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
                <p className="font-bold text-sm">
                  <RubyText text="AIが面白そうなトッピングを10個考えています..." />
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {proposedToppings.slice(0, 10).map((item) => {
                  const isSelected = selectedToppings.includes(item.text);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => toggleTopping(item.text)}
                      className={[
                        'p-4 rounded-2xl border-2 text-left transition-all cursor-pointer flex items-center gap-3',
                        isSelected
                          ? 'border-[var(--accent)] bg-[#fff3dc] shadow-md scale-[1.01]'
                          : 'border-[var(--stroke)]/50 bg-[var(--background)] hover:bg-black/5',
                      ].join(' ')}
                    >
                      <span className="text-2xl shrink-0">{item.emoji}</span>
                      <span className="flex-1 text-sm font-bold leading-snug">
                        <RubyText text={item.text} />
                      </span>
                      <div
                        className={[
                          'w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0',
                          isSelected
                            ? 'bg-[var(--accent)] border-[var(--accent)] text-white'
                            : 'border-[var(--stroke)]/40',
                        ].join(' ')}
                      >
                        {isSelected && <Check size={14} />}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="flex items-center justify-between pt-4 border-t border-[var(--stroke)]/20">
              <div className="text-xs font-bold opacity-80">
                <RubyText text={`選択中: ${selectedToppings.length} 個`} />
              </div>
              <WobblyButton
                variant="primary"
                size="lg"
                onClick={() => setStep('model')}
                className="min-w-[200px]"
              >
                <RubyText text="次へ（モデル選択）" />
                <ChevronRight size={20} />
              </WobblyButton>
            </div>
          </WobblyCard>
        )}

        {/* ─── STEP 5: MODEL SELECTION (FAST / THINK / ULTRA) ─── */}
        {step === 'model' && (
          <WobblyCard className="p-6 sm:p-10 space-y-6">
            <div className="flex items-center justify-between">
              <span className="px-3 py-1 rounded-full bg-[var(--warm-badge)] text-xs font-bold">
                STEP 5 / 7
              </span>
              <WobblyButton variant="ghost" size="sm" onClick={() => setStep('toppings')}>
                <ChevronLeft size={16} />
                <RubyText text="トッピング選択に戻る" />
              </WobblyButton>
            </div>

            <div className="space-y-1 text-center">
              <h2 className="text-2xl sm:text-3xl font-bold">
                <RubyText text="AIの「考え方モード」を選ぼう！" />
              </h2>
              <p className="text-sm opacity-75">
                <RubyText text="「高速」「思考」「超思考」の3つから選べるよ！" />
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
              {(
                [
                  {
                    tier: 'fast' as ModelTier,
                    title: '高速',
                    subtitle: 'スピード重視！',
                    icon: <Zap size={32} className="text-[#e69f00]" />,
                    badge: '約10〜20秒',
                  },
                  {
                    tier: 'think' as ModelTier,
                    title: '思考',
                    subtitle: 'おすすめバランス！',
                    icon: <Brain size={32} className="text-[var(--accent)]" />,
                    badge: '人気 No.1',
                  },
                  {
                    tier: 'ultra' as ModelTier,
                    title: '超思考',
                    subtitle: 'じっくり本格派！',
                    icon: <Rocket size={32} className="text-[#3c7d58]" />,
                    badge: 'ハイクオリティ',
                  },
                ] as const
              ).map((card) => {
                const cfg = modelTiers[card.tier] || DEFAULT_MODEL_TIERS[card.tier];
                const isSelected = selectedTier === card.tier;
                return (
                  <button
                    key={card.tier}
                    type="button"
                    onClick={() => setSelectedTier(card.tier)}
                    className={[
                      'p-6 rounded-3xl border-3 text-left transition-all cursor-pointer flex flex-col justify-between gap-4',
                      isSelected
                        ? 'border-[var(--accent)] bg-[#fff3dc] rough-shadow scale-[1.02]'
                        : 'border-[var(--stroke)]/60 bg-[var(--background)] hover:bg-black/5',
                    ].join(' ')}
                  >
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="p-3 rounded-2xl bg-[var(--card)] border border-[var(--stroke)]/30">
                          {card.icon}
                        </div>
                        <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-[var(--warm-badge)]">
                          <RubyText text={card.badge} />
                        </span>
                      </div>
                      <div>
                        <h3 className="text-xl font-extrabold">
                          <RubyText text={card.title} />
                        </h3>
                        <p className="text-xs font-bold text-[var(--accent)]">
                          <RubyText text={card.subtitle} />
                        </p>
                      </div>
                      <p className="text-xs opacity-80 leading-relaxed">
                        <RubyText text={cfg.description} />
                      </p>
                    </div>

                    <div className="pt-2 border-t border-[var(--stroke)]/20 flex items-center justify-between text-[11px] font-mono opacity-65">
                      <span>{cfg.model}</span>
                      {isSelected && (
                        <span className="text-[var(--accent)] font-sans font-bold">● 選択中</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="flex justify-end pt-4 border-t border-[var(--stroke)]/20">
              <WobblyButton
                variant="primary"
                size="lg"
                onClick={() => setStep('confirm')}
                className="min-w-[200px]"
              >
                <RubyText text="次へ（内容の確認）" />
                <ChevronRight size={20} />
              </WobblyButton>
            </div>
          </WobblyCard>
        )}

        {/* ─── STEP 6: CONFIRMATION & PUBLIC SHARING ─── */}
        {step === 'confirm' && (
          <WobblyCard className="p-6 sm:p-10 space-y-6">
            <div className="flex items-center justify-between">
              <span className="px-3 py-1 rounded-full bg-[var(--warm-badge)] text-xs font-bold">
                STEP 6 / 7
              </span>
              <WobblyButton variant="ghost" size="sm" onClick={() => setStep('model')}>
                <ChevronLeft size={16} />
                <RubyText text="モデル選択に戻る" />
              </WobblyButton>
            </div>

            <div className="space-y-1">
              <h2 className="text-2xl sm:text-3xl font-bold">
                <RubyText text="作成するゲームの確認" />
              </h2>
              <p className="text-sm opacity-75">
                <RubyText text="内容を確認して、ゲーム生成をスタートしよう！" />
              </p>
            </div>

            {/* Summary Box */}
            <div className="p-5 rounded-2xl border-2 border-[var(--stroke)] bg-[var(--background)] space-y-4">
              <div>
                <div className="text-xs font-bold opacity-60 mb-1">
                  <RubyText text="◆ 作りたいゲームの内容" />
                </div>
                <div className="text-base font-bold">{prompt}</div>
              </div>

              <div>
                <div className="text-xs font-bold opacity-60 mb-1">
                  <RubyText text="◆ 追加トッピング要素" />
                </div>
                {selectedToppings.length === 0 ? (
                  <div className="text-sm opacity-70">
                    <RubyText text="なし（シンプル構成）" />
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {selectedToppings.map((t, idx) => (
                      <span
                        key={idx}
                        className="px-3 py-1 rounded-full bg-[#fff3dc] border border-[var(--accent)] text-xs font-bold"
                      >
                        <RubyText text={t} />
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <div className="text-xs font-bold opacity-60 mb-1">
                  <RubyText text="◆ 選択したAIモデル" />
                </div>
                <div className="text-sm font-bold flex items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-full bg-[var(--accent)] text-white text-xs">
                    <RubyText
                      text={
                        selectedTier === 'fast'
                          ? '高速'
                          : selectedTier === 'think'
                          ? '思考'
                          : '超思考'
                      }
                    />
                  </span>
                  <span className="font-mono text-xs opacity-75">
                    ({modelTiers[selectedTier]?.model})
                  </span>
                </div>
              </div>
            </div>

            {/* Public Sharing Option & Game Title */}
            <div className="p-5 rounded-2xl border-2 border-[var(--stroke)] bg-[var(--background)] space-y-4">
              <label className="flex items-center justify-between cursor-pointer">
                <div className="flex items-center gap-3">
                  <Share2 className="text-[var(--accent)]" size={22} />
                  <div>
                    <div className="font-bold text-base">
                      <RubyText text="みんなとゲームを共有する（公開ページにのせる）" />
                    </div>
                    <div className="text-xs opacity-70">
                      <RubyText text="ONにすると「みんなのゲーム公開ページ」でスマホから遊べるようになるよ！" />
                    </div>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={sharePublicly}
                  onChange={(e) => setSharePublicly(e.target.checked)}
                  className="w-6 h-6 accent-[var(--accent)] cursor-pointer"
                />
              </label>

              {sharePublicly && (
                <div className="pt-2 border-t border-[var(--stroke)]/20 space-y-2">
                  <label className="block text-sm font-bold">
                    <RubyText text="作品名（ゲームのなまえ）を入力してね：" />
                  </label>
                  <input
                    type="text"
                    value={gameTitle}
                    onChange={(e) => setGameTitle(e.target.value)}
                    placeholder="例：メロンパン大冒険！（空欄ならAIが自動で名前をつけるよ）"
                    className="w-full px-4 py-3 rounded-2xl border-2 border-[var(--stroke)] bg-[var(--card)] text-base font-bold focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  />
                </div>
              )}
            </div>

            <div className="flex justify-center pt-2">
              <WobblyButton
                variant="primary"
                size="lg"
                onClick={handleStartGeneration}
                className="w-full sm:w-auto min-w-[280px] py-4 text-lg font-extrabold"
              >
                <Play size={22} fill="currentColor" />
                <RubyText text="ゲーム生成を開始する！" />
              </WobblyButton>
            </div>
          </WobblyCard>
        )}

        {/* ─── STEP 7: QR CODE PAGE & REALTIME PREVIEW ─── */}
        {step === 'qrcode' && (
          <div className="space-y-6">
            <WobblyCard className="p-6 sm:p-8 space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <QrCode className="text-[var(--accent)]" size={28} />
                  <h2 className="text-2xl font-bold">
                    <RubyText text="スマホでQRコードを読み取ってね！" />
                  </h2>
                </div>
                <WobblyButton variant="secondary" size="sm" onClick={handleResetWizard}>
                  <RotateCcw size={15} />
                  <RubyText text="最初に戻る（新しい体験者へ）" />
                </WobblyButton>
              </div>

              {/* Dual QR Codes Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* QR 1: Realtime Generation Status Page */}
                <div className="p-5 rounded-3xl border-2 border-[var(--stroke)] bg-[var(--background)] flex flex-col items-center text-center space-y-3">
                  <span className="px-3 py-1 rounded-full bg-[var(--accent)] text-white text-xs font-bold">
                    📱 リアルタイム実況 QR
                  </span>
                  <h3 className="font-bold text-lg">
                    <RubyText text="あなたのゲームの生成状況ページ" />
                  </h3>
                  <p className="text-xs opacity-75">
                    <RubyText text="AIが考えている様子やプログラムが作られる様子をスマホでリアルタイムに見れるよ！（完了5分後に消えます）" />
                  </p>
                  <div className="p-4 bg-white rounded-2xl border-2 border-[var(--stroke)] shadow-sm">
                    <QRCodeSVG value={statusUrl} size={168} level="M" />
                  </div>
                  <Link
                    to={createdSession ? `/status/${createdSession.id}` : '/status/demo'}
                    target="_blank"
                    className="text-xs font-bold text-[var(--accent)] underline flex items-center gap-1"
                  >
                    <RubyText text="生成状況ページを開く" />
                    <ExternalLink size={12} />
                  </Link>
                </div>

                {/* QR 2: Public Games Gallery Page */}
                <div className="p-5 rounded-3xl border-2 border-[var(--stroke)] bg-[var(--background)] flex flex-col items-center text-center space-y-3">
                  <span className="px-3 py-1 rounded-full bg-[var(--warm-success)] text-white text-xs font-bold">
                    🏆 全体公開ギャラリー QR
                  </span>
                  <h3 className="font-bold text-lg">
                    <RubyText text="みんなのゲーム公開ページ" />
                  </h3>
                  <p className="text-xs opacity-75">
                    <RubyText text="あなたやみんなが作ったゲームが公開されているページだよ！スマホからいつでも遊べます！" />
                  </p>
                  <div className="p-4 bg-white rounded-2xl border-2 border-[var(--stroke)] shadow-sm">
                    <QRCodeSVG value={galleryUrl} size={168} level="M" />
                  </div>
                  <Link
                    to="/gallery"
                    target="_blank"
                    className="text-xs font-bold text-[var(--warm-success)] underline flex items-center gap-1"
                  >
                    <RubyText text="みんなのゲーム公開ページを開く" />
                    <ExternalLink size={12} />
                  </Link>
                </div>
              </div>

              {/* Live Status Bar on Kiosk */}
              <div className="p-4 rounded-2xl border-2 border-[var(--stroke)] bg-[var(--background)] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold flex items-center gap-2">
                    <span
                      className={[
                        'w-2.5 h-2.5 rounded-full',
                        liveStatus === 'completed'
                          ? 'bg-[var(--warm-success)]'
                          : liveStatus === 'failed' || liveStatus === 'cancelled'
                          ? 'bg-[var(--warm-error)]'
                          : 'bg-[var(--accent)] animate-ping',
                      ].join(' ')}
                    />
                    <RubyText
                      text={
                        liveStatus === 'completed'
                          ? '🎉 ゲームが完成しました！下の画面でもすぐ遊べるよ！'
                          : liveStatus === 'failed'
                          ? 'ゲーム生成に失敗しました。スタッフにお知らせください。'
                          : liveStatus === 'cancelled'
                          ? 'ゲーム生成が停止されました。'
                          : '⚡ AIがリアルタイムにゲームを組み立てています...'
                      }
                    />
                  </span>
                </div>
                <p className="text-xs font-mono opacity-80 line-clamp-2">{liveThought}</p>
              </div>
            </WobblyCard>

            {/* Playable Preview right on the Kiosk once HTML is available */}
            {liveCode && (
              <WobblyCard className="p-4 h-[520px] flex flex-col">
                <div className="text-sm font-bold mb-2 flex items-center gap-2">
                  <Gamepad2 size={18} className="text-[var(--accent)]" />
                  <RubyText text="体験端末プレビュー（ここでテストプレイできます）" />
                </div>
                <div className="flex-1 rounded-2xl overflow-hidden border-2 border-[var(--stroke)]">
                  <SandboxViewer
                    htmlContent={liveCode}
                    files={{ 'index.html': liveCode }}
                    onFixError={() => {}}
                  />
                </div>
              </WobblyCard>
            )}
          </div>
        )}
      </main>

      {/* ─── MODAL: 0-12 GUARDIAN / STAFF SUPERVISION NOTICE ─── */}
      {showGuardianModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <WobblyCard className="max-w-lg w-full p-8 text-center space-y-6 animate-in zoom-in-95">
            <div className="text-6xl">👨‍👩‍👧</div>
            <h3 className="text-xl sm:text-2xl font-extrabold leading-relaxed">
              <RubyText
                text="この先は、保護者の人かスタッフの人に見守ってもらいながら進めてね！"
                forceRuby={true}
              />
            </h3>
            <p className="text-sm opacity-80">
              <RubyText
                text="わからないことがあったら、いつでも近くのお兄さん・お姉さん（スタッフ）を呼んでね！"
                forceRuby={true}
              />
            </p>
            <div className="pt-2">
              <WobblyButton
                variant="primary"
                size="lg"
                onClick={handleConfirmGuardianModal}
                className="w-full py-4 text-lg font-bold"
              >
                <Check size={22} />
                <RubyText text="わかった！（次へ進む）" forceRuby={true} />
              </WobblyButton>
            </div>
          </WobblyCard>
        </div>
      )}

      {/* ─── MODAL: AI HELPER WIZARD ─── */}
      {isHelperOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <WobblyCard className="max-w-2xl w-full p-6 sm:p-8 space-y-6 my-8">
            <div className="flex items-center justify-between border-b border-[var(--stroke)]/20 pb-3">
              <div className="flex items-center gap-2">
                <Wand2 className="text-[var(--accent)]" />
                <h3 className="text-xl font-bold">
                  <RubyText
                    text={
                      helperMode === 'expand'
                        ? 'AIアイデア拡張・パワーアップ'
                        : 'AIアイデアお手伝いモード'
                    }
                  />
                </h3>
              </div>
              <WobblyButton variant="ghost" size="sm" onClick={() => setIsHelperOpen(false)}>
                ✕ 閉じる
              </WobblyButton>
            </div>

            {/* Mode Toggle when a prompt is already entered */}
            {prompt.trim() && (
              <div className="flex items-center gap-2 p-1.5 rounded-2xl bg-[var(--background)] border border-[var(--stroke)]/40 text-xs font-bold">
                <button
                  type="button"
                  onClick={() => setHelperMode('expand')}
                  className={[
                    'flex-1 py-2 px-3 rounded-xl transition-all cursor-pointer',
                    helperMode === 'expand'
                      ? 'bg-[var(--accent)] text-white shadow-sm'
                      : 'opacity-70 hover:opacity-100',
                  ].join(' ')}
                >
                  💡 今のアイデアを拡張する（おすすめ）
                </button>
                <button
                  type="button"
                  onClick={() => setHelperMode('scratch')}
                  className={[
                    'flex-1 py-2 px-3 rounded-xl transition-all cursor-pointer',
                    helperMode === 'scratch'
                      ? 'bg-[var(--accent)] text-white shadow-sm'
                      : 'opacity-70 hover:opacity-100',
                  ].join(' ')}
                >
                  🔄 ゼロから質問で作る
                </button>
              </div>
            )}

            {/* ─── MODE A: PROMPT EXPANSION MODE ─── */}
            {helperMode === 'expand' && (
              <div className="space-y-5">
                {/* Current Prompt Preview Box */}
                <div className="p-3.5 rounded-2xl bg-[var(--background)] border border-[var(--stroke)]/40 text-xs space-y-1">
                  <span className="font-bold text-[var(--accent)]">
                    <RubyText text="現在入力されているアイデア:" />
                  </span>
                  <p className="font-bold text-sm text-[var(--foreground)]">“{prompt}”</p>
                </div>

                {isLoadingExpansions ? (
                  <div className="py-12 text-center space-y-3">
                    <div className="inline-block w-9 h-9 border-4 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
                    <p className="font-bold text-sm">
                      <RubyText
                        text={`AI (${
                          exhibitionSettings.helperModel || 'gemini-3.5-flash'
                        }) が3つの拡張プランを考えています...`}
                      />
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="text-xs font-bold opacity-80">
                      <RubyText text="◆ AIが提案するアイデア拡張プラン（タップして選択）：" />
                    </div>

                    <div className="space-y-3">
                      {expansionOptions.map((opt) => (
                        <div
                          key={opt.id}
                          className="p-4 rounded-2xl border-2 border-[var(--stroke)]/60 bg-[var(--background)] hover:border-[var(--accent)] hover:bg-[#fff9ed] transition-all space-y-2 flex flex-col justify-between"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="text-2xl">{opt.emoji}</span>
                              <div>
                                <h4 className="font-extrabold text-sm sm:text-base">
                                  <RubyText text={opt.title} />
                                </h4>
                                <p className="text-xs text-[var(--accent)] font-bold">
                                  <RubyText text={opt.summary} />
                                </p>
                              </div>
                            </div>
                            <WobblyButton
                              variant="primary"
                              size="sm"
                              onClick={() => handleApplyExpansionOption(opt)}
                            >
                              <Sparkles size={14} />
                              <RubyText text="この案にする！" />
                            </WobblyButton>
                          </div>
                          <p className="text-xs opacity-85 leading-relaxed bg-[var(--card)] p-2.5 rounded-xl border border-[var(--stroke)]/20">
                            {opt.expandedPrompt}
                          </p>
                        </div>
                      ))}
                    </div>

                    {/* Quick Suggestion Chips */}
                    <div className="pt-3 border-t border-[var(--stroke)]/20 space-y-2">
                      <div className="text-xs font-bold opacity-75">
                        <RubyText text="◆ さらにワンタップで追加できるギミック要素：" />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {QUICK_EXPANSION_FRAGMENTS.map((frag) => (
                          <button
                            key={frag.id}
                            type="button"
                            onClick={() => handleAppendFragment(frag.text)}
                            className="px-3 py-1.5 rounded-full border border-[var(--stroke)]/50 bg-[var(--background)] hover:bg-[#fff3dc] hover:border-[var(--accent)] text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5"
                          >
                            <span>{frag.emoji}</span>
                            <span>{frag.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ─── MODE B: SCRATCH SELECTION QUESTIONS ─── */}
            {helperMode === 'scratch' && (
              <div className="space-y-5">
                {AI_HELPER_STEPS.map((group, groupIdx) => (
                  <div key={groupIdx} className="space-y-2">
                    <div className="text-sm font-bold">
                      {groupIdx + 1}. <RubyText text={group.stepTitle} />
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                      {group.options.map((opt, optIdx) => {
                        const active = helperSelections[groupIdx] === optIdx;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => {
                              const next: [number, number, number] = [...helperSelections] as any;
                              next[groupIdx] = optIdx;
                              setHelperSelections(next);
                            }}
                            className={[
                              'p-3 rounded-2xl border-2 text-center transition-all cursor-pointer flex flex-col items-center gap-1',
                              active
                                ? 'border-[var(--accent)] bg-[#fff3dc] font-bold scale-105'
                                : 'border-[var(--stroke)]/40 bg-[var(--background)] opacity-80',
                            ].join(' ')}
                          >
                            <span className="text-2xl">{opt.emoji}</span>
                            <span className="text-xs">
                              <RubyText text={opt.label} />
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}

                <div className="flex justify-end gap-3 pt-3 border-t border-[var(--stroke)]/20">
                  <WobblyButton variant="secondary" onClick={() => setIsHelperOpen(false)}>
                    <RubyText text="キャンセル" />
                  </WobblyButton>
                  <WobblyButton variant="primary" onClick={handleApplyHelper}>
                    <Sparkles size={16} />
                    <RubyText text="このアイデアを入力する！" />
                  </WobblyButton>
                </div>
              </div>
            )}
          </WobblyCard>
        </div>
      )}
    </div>
  );
}
