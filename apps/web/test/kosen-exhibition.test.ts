import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  renderTextWithRuby,
  KANJI_RUBY_DICT,
  DEFAULT_MODEL_TIERS,
  DEFAULT_EXHIBITION_SETTINGS,
  DEFAULT_SUPABASE_URL,
  getSupabaseCredentials,
  fetchModelTiers,
  saveModelTiers,
  fetchExhibitionSettings,
  saveExhibitionSettings,
  createKosenSession,
  updateKosenSession,
  getKosenSession,
  listKosenSessions,
  deleteKosenSession,
  appendKosenEvent,
  listKosenEvents,
  publishKosenGame,
  listPublicKosenGames,
  toggleGamePublicVisibility,
  deleteKosenGame,
  isSessionStatusExpired,
  generateToppingsForPrompt,
  expandPromptWithAI,
  QUICK_EXPANSION_FRAGMENTS,
  AI_HELPER_STEPS,
  composeHelperPrompt,
  generateGameSummaryAndTitle,
  buildInteractiveFallbackGameHtml,
  checkStaffPasskeySession,
  signInWithStaffPasskey,
  registerStaffPasskey,
  signOutStaff,
  invokeKosenAiProxy,
  checkServerApiKeyStatus,
  saveServerApiKey,
} from '../src/modules/kosen';

describe('Kosen Exhibition System Suite', () => {
  beforeEach(() => {
    // These cases exercise offline fallback behavior and must not mutate the live exhibition.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'AI proxy unavailable in offline test' }), { status: 401, headers: { 'Content-Type': 'application/json' } })));
    const store: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store[k] || null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
      clear: () => {
        for (const k in store) delete store[k];
      },
    });
  });

  describe('1. Age Selection & Furigana (Ruby) System', () => {
    it('strips ruby annotations when isRubyMode is false (13+ mode)', () => {
      const text = 'この先は、{保護者|ほごしゃ}の人かスタッフの人に見守ってもらいながら進めてね！';
      const rendered = renderTextWithRuby(text, false);
      expect(rendered).toBe('この先は、保護者の人かスタッフの人に見守ってもらいながら進めてね！');
    });

    it('annotates Kanji words with <ruby> elements when isRubyMode is true (0-12 mode)', () => {
      const text = 'この先は、保護者の人かスタッフの人に見守ってもらいながら進めてね！';
      const nodes = renderTextWithRuby(text, true) as any[];
      expect(Array.isArray(nodes)).toBe(true);
      const serialized = JSON.stringify(nodes);
      expect(serialized).toContain('保護者');
      expect(serialized).toContain('ほごしゃ');
      expect(serialized).toContain('見守');
      expect(serialized).toContain('みまも');
      expect(serialized).toContain('進めて');
      expect(serialized).toContain('すすめて');
    });

    it('normalizes inline HTML <ruby> tags properly in both modes', () => {
      const htmlRuby = '<ruby>高専祭<rt>こうせんさい</rt></ruby>へようこそ';
      expect(renderTextWithRuby(htmlRuby, false)).toBe('高専祭へようこそ');
      const rubyNodes = renderTextWithRuby(htmlRuby, true);
      expect(JSON.stringify(rubyNodes)).toContain('こうせんさい');
    });

    it('contains comprehensive dictionary entries for exhibition UI terms and pure hiragana/katakana readings', () => {
      const keys = KANJI_RUBY_DICT.map(([k]) => k);
      expect(keys).toContain('保護者');
      expect(keys).toContain('利用規約');
      expect(keys).toContain('音声入力');
      expect(keys).toContain('超思考');
      expect(keys).toContain('作品名');
      expect(keys).toContain('公開日時');
      expect(keys).toContain('お兄さん');
      expect(keys).toContain('お姉さん');
      expect(keys).toContain('人工知能');

      // Every reading in KANJI_RUBY_DICT must not contain unannotated Kanji
      for (const [kanji, reading] of KANJI_RUBY_DICT) {
        expect(/[\u4e00-\u9faf]/.test(reading), `Reading for ${kanji} contains Kanji: ${reading}`).toBe(false);
      }
    });
  });

  describe('2. Prompt Helper & Toppings Suggestion System (Max 10, Multi-select)', () => {
    it('composes a full game prompt from 3 AI helper choices', () => {
      const g = AI_HELPER_STEPS[0].options[0].promptFragment;
      const c = AI_HELPER_STEPS[1].options[0].promptFragment;
      const w = AI_HELPER_STEPS[2].options[0].promptFragment;
      const composed = composeHelperPrompt(g, c, w);
      expect(composed).toContain('メロンパン');
      expect(composed).toContain('アクションゲーム');
      expect(composed).toContain('宇宙空間');

      // Test extension when a pre-existing prompt is provided
      const extended = composeHelperPrompt(g, c, w, 'ねこの冒険');
      expect(extended).toContain('ねこの冒険');
      expect(extended).toContain('さらに');
    });

    it('expands pre-existing user prompt into 3 rich enhancement options using expandPromptWithAI', async () => {
      const basePrompt = '空飛ぶメロンパンのアクションゲーム';
      const options = await expandPromptWithAI(basePrompt, {
        model: 'gemini-3.5-flash',
        provider: 'gemini',
      });

      expect(options.length).toBe(3);
      for (const opt of options) {
        expect(opt.title).toBeTruthy();
        expect(opt.emoji).toBeTruthy();
        expect(opt.summary).toBeTruthy();
        expect(opt.expandedPrompt).toContain(basePrompt);
      }

      expect(QUICK_EXPANSION_FRAGMENTS.length).toBeGreaterThan(0);
      expect(QUICK_EXPANSION_FRAGMENTS[0].label).toContain('巨大ボス戦');
    });

    it('proposes up to 10 relevant toppings based on user prompt', async () => {
      const toppings = await generateToppingsForPrompt('宇宙でビームを撃つシューティングゲーム', 10);
      expect(toppings.length).toBe(10);
      expect(toppings[0].text).toContain('ホーミングレーザー');
      // Ensure all 10 toppings are unique
      const uniqueTexts = new Set(toppings.map((t) => t.text));
      expect(uniqueTexts.size).toBe(10);
    });

    it('adapts toppings dynamically for block breaker prompts', async () => {
      const toppings = await generateToppingsForPrompt('メロンパンが跳ねるブロック崩し', 10);
      expect(toppings.length).toBeLessThanOrEqual(10);
      expect(toppings.some((t) => t.text.includes('マルチボール'))).toBe(true);
    });

    it('generates game title and AI summary description for gallery', async () => {
      const res = await generateGameSummaryAndTitle({
        prompt: 'ネオンが光る宇宙シューティング',
        toppings: ['🎆 カラフル花火', '👾 巨大ボス'],
        userTitle: '',
      });
      expect(res.title.length).toBeGreaterThan(0);
      expect(res.description).toContain('ネオンが光る宇宙シューティング');
      expect(res.description).toContain('カラフル花火');
    });

    it('respects user-provided game title when sharing publicly', async () => {
      const res = await generateGameSummaryAndTitle({
        prompt: 'ジャンプゲーム',
        toppings: [],
        userTitle: 'ぼくの最強ジャンプ！',
      });
      expect(res.title).toBe('ぼくの最強ジャンプ！');
    });

    it('builds a complete playable HTML5 Canvas game fallback when offline (shooting, runner, breaker)', () => {
      const htmlShooting = buildInteractiveFallbackGameHtml({
        title: 'テストゲーム',
        prompt: '宇宙シューティング',
        toppings: ['ホーミングレーザー'],
      });
      expect(htmlShooting).toContain('<!DOCTYPE html>');
      expect(htmlShooting).toContain('<canvas id="gameCanvas"');
      expect(htmlShooting).toContain('テストゲーム');

      const htmlRunner = buildInteractiveFallbackGameHtml({
        title: 'ジャンプゲーム',
        prompt: '障害物をジャンプして避けるアクション',
        toppings: ['二段ジャンプ'],
      });
      expect(htmlRunner).toContain('const mode = "runner"');
      expect(htmlRunner).toContain('Side-scrolling Jump Action Mode');
    });
  });

  describe('3. 5-Minute Post-Completion Expiration Logic for Status Page', () => {
    it('does not expire while session is still running or pending', () => {
      const now = Date.now();
      const check = isSessionStatusExpired(
        {
          status: 'running',
          completed_at: null,
          expires_at: null,
        },
        now,
        5
      );
      expect(check.expired).toBe(false);
      expect(check.remainingSeconds).toBe(300);
    });

    it('computes accurate countdown before 5 minutes have elapsed after completion', () => {
      const completedTime = new Date('2026-11-06T10:00:00Z').getTime();
      const expiresAtIso = new Date(completedTime + 5 * 60 * 1000).toISOString();
      // 2 minutes after completion -> 180 seconds remaining
      const twoMinsLater = completedTime + 2 * 60 * 1000;
      const check = isSessionStatusExpired(
        {
          status: 'completed',
          completed_at: new Date(completedTime).toISOString(),
          expires_at: expiresAtIso,
        },
        twoMinsLater,
        5
      );
      expect(check.expired).toBe(false);
      expect(check.remainingSeconds).toBe(180);
    });

    it('expires immediately once 5 minutes have passed after completion', () => {
      const completedTime = new Date('2026-11-06T10:00:00Z').getTime();
      const expiresAtIso = new Date(completedTime + 5 * 60 * 1000).toISOString();
      const fiveMinsAndOneSecLater = completedTime + 5 * 60 * 1000 + 1000;
      const check = isSessionStatusExpired(
        {
          status: 'completed',
          completed_at: new Date(completedTime).toISOString(),
          expires_at: expiresAtIso,
        },
        fiveMinsAndOneSecLater,
        5
      );
      expect(check.expired).toBe(true);
      expect(check.remainingSeconds).toBe(0);
    });
  });

  describe('4. Supabase Configuration, Sessions, Events & Gallery Integration', () => {
    it('configures valid Supabase project URL for melonpan-kosen', () => {
      const creds = getSupabaseCredentials();
      expect(creds.url).toBe(DEFAULT_SUPABASE_URL);
      expect(creds.url).toContain('supabase.co');
      expect(creds.anonKey.length).toBeGreaterThan(20);
    });

    it('manages model tiers (fast, think, ultra) and persists admin changes', async () => {
      const initial = await fetchModelTiers();
      expect(initial.fast).toBeDefined();
      expect(initial.think).toBeDefined();
      expect(initial.ultra).toBeDefined();

      const updated = {
        ...initial,
        fast: {
          ...initial.fast,
          model: 'gemini-3.8-flash',
        },
      };
      await saveModelTiers(updated);
      const reloaded = await fetchModelTiers();
      expect(reloaded.fast.model).toBe('gemini-3.8-flash');

      // Restore default
      await saveModelTiers(DEFAULT_MODEL_TIERS);
    });

    it('persists helper, toppings, and transcribe models in exhibition settings', async () => {
      const current = await fetchExhibitionSettings();
      expect(current.transcribeModel).toBe('gemini-3.5-transcribe');
      expect(current.helperModel).toBeDefined();
      expect(current.toppingsModel).toBeDefined();

      const updated = {
        ...current,
        helperModel: 'gemini-3.8-flash',
        toppingsModel: 'gemini-3.8-flash',
        transcribeModel: 'gemini-3.5-transcribe',
      };
      await saveExhibitionSettings(updated);
      const fetched = await fetchExhibitionSettings();
      expect(fetched.helperModel).toBe('gemini-3.8-flash');
      expect(fetched.toppingsModel).toBe('gemini-3.8-flash');
      expect(fetched.transcribeModel).toBe('gemini-3.5-transcribe');
    });

    it('creates session, logs realtime events, and publishes game to gallery', async () => {
      const session = await createKosenSession({
        ageGroup: 'under12',
        prompt: 'テスト用メロンパンジャンプゲーム',
        toppings: ['✨ キラキラ虹色エフェクト'],
        modelTier: 'fast',
        modelName: 'gemini-3.5-flash-lite',
        provider: 'gemini',
        thinkingEffort: 'minimal',
        isPublic: true,
        gameTitle: 'テストメロンパン号',
      });

      expect(session.id).toBeTruthy();
      expect(session.age_group).toBe('under12');

      await updateKosenSession(session.id, {
        current_thought: 'テスト思考中...',
        turn_count: 2,
      });

      const fetched = await getKosenSession(session.id);
      expect(fetched?.id).toBe(session.id);

      const ev = await appendKosenEvent(session.id, 'thought', {
        thought: 'イベントログ記録テスト',
      });
      expect(ev.session_id).toBe(session.id);

      const events = await listKosenEvents(session.id);
      expect(events.length).toBeGreaterThan(0);

      const game = await publishKosenGame({
        sessionId: session.id,
        title: 'テストメロンパン号',
        description: 'AIが生成したテスト用概要です。',
        htmlContent: '<!DOCTYPE html><html><body>Game</body></html>',
        ageGroup: 'under12',
        modelTier: 'fast',
        toppings: ['✨ キラキラ虹色エフェクト'],
        isPublic: true,
      });

      expect(game.title).toBe('テストメロンパン号');

      const publicGames = await listPublicKosenGames(false);
      expect(publicGames.some((g) => g.title === 'テストメロンパン号')).toBe(true);

      // Admin moderation: toggle visibility and clean up test game and session
      await toggleGamePublicVisibility(game.id, false);
      await deleteKosenGame(game.id);
      await deleteKosenSession(session.id);
    });

    it('manages staff passkey sessions and handles sign out safely', async () => {
      // In Node/Vitest test environment without WebAuthn browser hardware, check graceful degradation
      const initialSession = await checkStaffPasskeySession();
      // Initially, returns PasskeySessionInfo
      expect(typeof initialSession).toBe('object');
      expect(typeof initialSession.isAuthenticated).toBe('boolean');

      await signOutStaff();
      const afterSignOut = await checkStaffPasskeySession();
      expect(afterSignOut.isAuthenticated).toBe(false);
    });

    it('interacts with server-side API key proxy checks without exposing credentials', async () => {
      const status = await checkServerApiKeyStatus();
      expect(status).toHaveProperty('configured');
      expect(status).toHaveProperty('maskedKey');
      expect(typeof status.configured).toBe('boolean');

      // Test safe handling of invokeKosenAiProxy calls
      try {
        const proxyResult = await invokeKosenAiProxy('toppings', {
          prompt: 'メロンパンのジャンプゲーム',
          count: 5,
        });
        if (proxyResult !== null) {
          expect(Array.isArray(proxyResult)).toBe(true);
        }
      } catch (err: any) {
        // If GEMINI_API_KEY is not yet populated in the Supabase test project environment,
        // it must reject with a clean server-side configuration message, never leaking tokens
        expect(err.message).toMatch(/(GEMINI_API_KEY|Edge Function|AI proxy)/i);
      }
    });
  });
});
