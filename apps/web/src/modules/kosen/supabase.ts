import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  AgeGroup,
  DEFAULT_EXHIBITION_SETTINGS,
  DEFAULT_MODEL_TIERS,
  ExhibitionSettings,
  KosenEventRecord,
  KosenGameRecord,
  KosenSessionRecord,
  KosenSessionStatus,
  ModelTier,
  ModelTiersMap,
} from './types';

// Newly created Supabase project for Melonpan Kosen Exhibition (`melonpan-kosen`)
export const DEFAULT_SUPABASE_URL = 'https://zopgfuuodhaegzogimbu.supabase.co';
export const DEFAULT_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpvcGdmdXVvZGhhZWd6b2dpbWJ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM5MTUxMjMsImV4cCI6MjEwOTQ5MTEyM30.Yf-le6eFRoVSUq1HEkO16wei2luD-Vg6JrQl31yBFkI';

const LOCAL_SESSIONS_KEY = 'melonpan_kosen_local_sessions_v1';
const LOCAL_EVENTS_KEY = 'melonpan_kosen_local_events_v1';
const LOCAL_GAMES_KEY = 'melonpan_kosen_local_games_v1';
const LOCAL_TIERS_KEY = 'melonpan_kosen_local_tiers_v1';
const LOCAL_SETTINGS_KEY = 'melonpan_kosen_local_settings_v1';

let supabaseInstance: SupabaseClient | null = null;

export function getSupabaseCredentials(): { url: string; anonKey: string } {
  const envUrl =
    (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_SUPABASE_URL) ||
    DEFAULT_SUPABASE_URL;
  const envKey =
    (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_SUPABASE_ANON_KEY) ||
    DEFAULT_SUPABASE_ANON_KEY;
  return { url: envUrl, anonKey: envKey };
}

export function getSupabaseClient(): SupabaseClient {
  if (!supabaseInstance) {
    const { url, anonKey } = getSupabaseCredentials();
    supabaseInstance = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // Enable WebAuthn Passkeys support in Supabase Auth
        // @ts-ignore experimental option in latest supabase-js
        experimental: { passkey: true },
      },
    });
  }
  return supabaseInstance;
}

// ─── Passkey (WebAuthn) Server-side Authentication ──────────────────────────

export interface PasskeySessionInfo {
  isAuthenticated: boolean;
  userId: string | null;
  email: string | null;
  amr?: any[];
}

function bufferToBase64URL(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64URLToBuffer(base64URL: string): Uint8Array {
  const base64 = base64URL.replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4));
  const binary = atob(base64 + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function checkStaffPasskeySession(): Promise<PasskeySessionInfo> {
  try {
    const supabase = getSupabaseClient();
    // 1. Primary: Check official Supabase Auth session
    try {
      const { data: authData } = await supabase.auth.getUser();
      if (authData?.user?.email === 'staff@kosen.local' && authData.user.email_confirmed_at) {
        return { isAuthenticated: true, userId: authData.user.id, email: authData.user.email };
      }
    } catch {
      // The separately verified legacy session may still be usable without a Supabase session.
    }

    // 2. Fallback: Check local staff token if previously authenticated via Edge Function
    const staffToken =
      (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('kosen_staff_token')) ||
      (typeof localStorage !== 'undefined' && localStorage.getItem('kosen_staff_token'));

    if (staffToken) {
      const res = await invokeKosenAiProxy<{ valid: boolean; email?: string }>(
        'passkey_verify_session',
        { staffToken }
      );

      if (res?.valid) {
        return {
          isAuthenticated: true,
          userId: 'staff_user',
          email: res.email || 'staff@kosen.local',
        };
      }
    }
  } catch {}
  return { isAuthenticated: false, userId: null, email: null };
}

export async function signInWithStaffPasskey(): Promise<{
  success: boolean;
  error?: string;
  user?: any;
}> {
  try {
    if (typeof window === 'undefined' || !navigator.credentials || !window.PublicKeyCredential) {
      return {
        success: false,
        error: 'お使いのブラウザまたは端末はパスキー（WebAuthn）生体認証に対応していません。',
      };
    }

    const supabase = getSupabaseClient();

    // 1. Primary: Official Supabase Auth signInWithPasskey()
    try {
      const { data, error } = await (supabase.auth as any).signInWithPasskey();
      if (!error && data?.session) {
        if (data.user?.email !== 'staff@kosen.local' || !data.user?.email_confirmed_at) {
          await supabase.auth.signOut();
          return { success: false, error: 'このアカウントはスタッフとして登録されていません。' };
        }
        sessionStorage.setItem('melonpan_kosen_admin_auth', '1');
        return { success: true, user: data.user };
      }

      if (error) {
        const errorMsg = error.message || '';
        if (
          errorMsg.includes('cancelled') ||
          errorMsg.includes('abort') ||
          error.name === 'NotAllowedError'
        ) {
          return { success: false, error: '認証がキャンセルされました。' };
        }
        console.warn('Official passkey signIn returned error, attempting fallback:', error);
      }
    } catch (err: any) {
      console.warn('Official passkey signIn threw error, attempting fallback:', err);
    }

    // 2. Fallback: Secure Edge Function passkey proxy (WebAuthn)
    const challengeData = await invokeKosenAiProxy<{
      challenge: string;
      existingCredentials: Array<{ id: string; displayName?: string }>;
    }>('passkey_get_challenge', {});

    if (!challengeData?.challenge) {
      return {
        success: false,
        error:
          'Supabase Auth の Passkeys がまだ有効化されていません。Supabase Dashboard (Authentication -> Passkeys) で有効化してください。',
      };
    }

    const challengeBuffer = base64URLToBuffer(challengeData.challenge);
    const allowCredentials: PublicKeyCredentialDescriptor[] = (
      challengeData.existingCredentials || []
    ).map((c) => ({
      id: base64URLToBuffer(c.id) as any,
      type: 'public-key' as const,
    }));

    const assertion = (await navigator.credentials.get({
      publicKey: {
        challenge: challengeBuffer as any,
        rpId: window.location.hostname,
        allowCredentials: allowCredentials.length > 0 ? allowCredentials : undefined,
        userVerification: 'required',
        timeout: 60000,
      },
    })) as PublicKeyCredential;

    if (!assertion) {
      return { success: false, error: '認証がキャンセルされました。' };
    }

    const rawIdB64 = bufferToBase64URL(assertion.rawId);
    const response = assertion.response as AuthenticatorAssertionResponse;
    const signatureB64 = bufferToBase64URL(response.signature);

    const loginResult = await invokeKosenAiProxy<{
      success: boolean;
      staffToken: string;
      email: string;
      error?: string;
    }>('passkey_login', {
      challenge: challengeData.challenge,
      credentialId: rawIdB64,
      signature: signatureB64,
      clientDataJSON: bufferToBase64URL(response.clientDataJSON),
      authenticatorData: bufferToBase64URL(response.authenticatorData),
    });

    if (loginResult?.success && loginResult.staffToken) {
      sessionStorage.setItem('kosen_staff_token', loginResult.staffToken);
      sessionStorage.setItem('melonpan_kosen_admin_auth', '1');
      return { success: true, user: { email: loginResult.email } };
    }

    return {
      success: false,
      error: loginResult?.error || 'パスキー検証に失敗しました。',
    };
  } catch (err: any) {
    if (err?.name === 'NotAllowedError') {
      return { success: false, error: 'パスキー認証がキャンセルされました。' };
    }
    return {
      success: false,
      error: err?.message || 'パスキー認証に失敗しました。',
    };
  }
}

export async function registerStaffPasskey(
  displayName = '高専祭スタッフ端末',
  enrollmentSecret?: string
): Promise<{
  success: boolean;
  error?: string;
  passkeyId?: string;
}> {
  try {
    if (typeof window === 'undefined' || !navigator.credentials || !window.PublicKeyCredential) {
      return {
        success: false,
        error: 'お使いのブラウザまたは端末はパスキー（WebAuthn）登録に対応していません。',
      };
    }

    const supabase = getSupabaseClient();

    // 1. Ensure staff user session exists in Supabase Auth (guarded by enrollmentSecret)
    const { data: authData } = await supabase.auth.getSession();
    if (authData?.session?.user && authData.session.user.email !== 'staff@kosen.local') {
      return { success: false, error: 'このアカウントはスタッフとして登録されていません。' };
    }
    if (!authData?.session?.user) {
      const tokenRes = await invokeKosenAiProxy<{
        success: boolean;
        token_hash: string;
        email: string;
        error?: string;
      }>('get_staff_enrollment_token', {
        email: 'staff@kosen.local',
        enrollmentSecret: enrollmentSecret?.trim(),
      });

      if (!tokenRes?.token_hash) {
        return {
          success: false,
          error:
            tokenRes?.error ||
            'スタッフ登録用シークレットキーが正しくありません。部外者による登録は拒否されました。',
        };
      }

      const { error: verifyErr } = await supabase.auth.verifyOtp({
        token_hash: tokenRes.token_hash,
        type: 'magiclink',
      });
      if (verifyErr) {
        console.warn('Failed to exchange magiclink OTP token:', verifyErr);
        return {
          success: false,
          error: 'スタッフ認証トークンの検証に失敗しました。',
        };
      }
    }

    // 2. Primary attempt: Official Supabase Auth registerPasskey()
    try {
      const { data: regData, error: regErr } = await (supabase.auth as any).registerPasskey();
      if (!regErr && regData) {
        sessionStorage.setItem('melonpan_kosen_admin_auth', '1');
        return {
          success: true,
          passkeyId: regData.id,
        };
      }
      if (regErr) {
        if (
          regErr.message?.includes('cancelled') ||
          regErr.message?.includes('abort') ||
          regErr.name === 'NotAllowedError'
        ) {
          return { success: false, error: 'パスキー登録がキャンセルされました。' };
        }
        console.warn('Official registerPasskey returned error, attempting fallback:', regErr);
      }
    } catch (err: any) {
      console.warn('Official registerPasskey failed, attempting fallback:', err);
    }

    return {
      success: false,
      error: '安全なパスキー登録を利用できません。Supabase Auth のパスキー設定を確認してください。',
    };
  } catch (err: any) {
    if (err?.name === 'NotAllowedError') {
      return { success: false, error: 'パスキー登録がキャンセルされました。' };
    }
    return {
      success: false,
      error: err?.message || 'パスキーの登録に失敗しました。',
    };
  }
}

export async function signOutStaff(): Promise<void> {
  try {
    sessionStorage.removeItem('kosen_staff_token');
    sessionStorage.removeItem('melonpan_kosen_admin_auth');
    localStorage.removeItem('kosen_staff_token');
    const supabase = getSupabaseClient();
    await supabase.auth.signOut().catch(() => {});
  } catch {}
}

// ─── Supabase Edge Function AI Proxy (Server-side API Key Management) ────────

export async function invokeKosenAiProxy<T = any>(
  action:
    | 'transcribe'
    | 'toppings'
    | 'expand'
    | 'summary'
    | 'chat'
    | 'save_server_key'
    | 'save_enrollment_secret'
    | 'get_enrollment_secret_status'
    | 'check_key_status'
    | 'get_staff_enrollment_token'
    | 'passkey_get_challenge'
    | 'passkey_register'
    | 'passkey_login'
    | 'passkey_verify_session',
  payload: any
): Promise<T> {
  const { url, anonKey } = getSupabaseCredentials();
  const functionUrl = `${url}/functions/v1/kosen-ai-proxy`;

  const supabase = getSupabaseClient();
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token || anonKey;

  const res = await fetch(functionUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      apikey: anonKey,
      ...(typeof sessionStorage !== 'undefined' && sessionStorage.getItem('kosen_staff_token')
        ? { 'x-kosen-staff-token': sessionStorage.getItem('kosen_staff_token')! } : {}),
    },
    body: JSON.stringify({ action, payload }),
  });

  if (!res.ok) {
    const errJson = await res.json().catch(() => ({}));
    throw new Error(errJson.error || `AI proxy error (${res.status})`);
  }

  return (await res.json()) as T;
}

export async function checkServerApiKeyStatus(provider: ServerKeyProvider = 'gemini'): Promise<{
  configured: boolean;
  maskedKey: string | null;
  unavailable?: boolean;
}> {
  try {
    return await invokeKosenAiProxy('check_key_status', { provider });
  } catch {
    return { configured: false, maskedKey: null, unavailable: true };
  }
}

export type ServerKeyProvider = 'gemini' | 'openrouter' | 'surplus';

export async function saveServerApiKey(apiKey: string, provider: ServerKeyProvider = 'gemini'): Promise<boolean> {
  try {
    const res = await invokeKosenAiProxy<{ success: boolean }>('save_server_key', {
      provider, apiKey,
    });
    return Boolean(res?.success);
  } catch {
    return false;
  }
}

export async function getStaffEnrollmentSecretStatus(): Promise<{
  configured: boolean;
  maskedSecret: string | null;
  secretLength: number;
}> {
  try {
    return await invokeKosenAiProxy('get_enrollment_secret_status', {});
  } catch {
    return { configured: false, maskedSecret: null, secretLength: 0 };
  }
}

export async function saveStaffEnrollmentSecret(enrollmentSecret: string): Promise<boolean> {
  try {
    const res = await invokeKosenAiProxy<{ success: boolean }>('save_enrollment_secret', {
      enrollmentSecret,
    });
    return Boolean(res?.success);
  } catch {
    return false;
  }
}

// ─── Local Fallback Storage Helpers ──────────────────────────────────────────

function readLocalJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeLocalJson<T>(key: string, data: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {}
}

// ─── Admin Config (Model Tiers & Exhibition Settings) ────────────────────────

export async function fetchModelTiers(): Promise<ModelTiersMap> {
  const cached = readLocalJson<ModelTiersMap>(LOCAL_TIERS_KEY, DEFAULT_MODEL_TIERS);
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('kosen_admin_config')
      .select('value')
      .eq('key', 'model_tiers')
      .single();

    if (!error && data?.value) {
      const merged: ModelTiersMap = {
        fast: { ...DEFAULT_MODEL_TIERS.fast, ...(data.value as any).fast },
        think: { ...DEFAULT_MODEL_TIERS.think, ...(data.value as any).think },
        ultra: { ...DEFAULT_MODEL_TIERS.ultra, ...(data.value as any).ultra },
      };
      writeLocalJson(LOCAL_TIERS_KEY, merged);
      return merged;
    }
  } catch {}
  return cached;
}

export async function saveModelTiers(tiers: ModelTiersMap): Promise<void> {
  writeLocalJson(LOCAL_TIERS_KEY, tiers);
  try {
    const supabase = getSupabaseClient();
    await supabase.from('kosen_admin_config').upsert(
      {
        key: 'model_tiers',
        value: tiers,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'key' }
    );
  } catch (err) {
    console.warn('Supabase saveModelTiers fallback to local only:', err);
  }
}

export async function fetchExhibitionSettings(): Promise<ExhibitionSettings> {
  const cached = readLocalJson<ExhibitionSettings>(LOCAL_SETTINGS_KEY, DEFAULT_EXHIBITION_SETTINGS);
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('kosen_admin_config')
      .select('value')
      .eq('key', 'exhibition_settings')
      .single();

    if (!error && data?.value) {
      const merged: ExhibitionSettings = {
        ...DEFAULT_EXHIBITION_SETTINGS,
        ...(data.value as any),
      };
      writeLocalJson(LOCAL_SETTINGS_KEY, merged);
      return merged;
    }
  } catch {}
  return cached;
}

export async function saveExhibitionSettings(settings: ExhibitionSettings): Promise<void> {
  writeLocalJson(LOCAL_SETTINGS_KEY, settings);
  try {
    const supabase = getSupabaseClient();
    await supabase.from('kosen_admin_config').upsert(
      {
        key: 'exhibition_settings',
        value: settings,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'key' }
    );
  } catch (err) {
    console.warn('Supabase saveExhibitionSettings fallback to local only:', err);
  }
}

// ─── Sessions CRUD ───────────────────────────────────────────────────────────

function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function createKosenSession(params: {
  ageGroup: AgeGroup;
  prompt: string;
  toppings: string[];
  modelTier: ModelTier;
  modelName: string;
  provider: KosenSessionRecord['provider'];
  thinkingEffort: KosenSessionRecord['thinking_effort'];
  isPublic: boolean;
  gameTitle?: string;
}): Promise<KosenSessionRecord> {
  const now = new Date().toISOString();
  const id = generateUuid();

  const record: KosenSessionRecord = {
    id,
    age_group: params.ageGroup,
    prompt: params.prompt,
    toppings: params.toppings,
    model_tier: params.modelTier,
    model_name: params.modelName,
    provider: params.provider,
    thinking_effort: params.thinkingEffort,
    is_public: params.isPublic,
    game_title: params.gameTitle || null,
    game_description: null,
    current_code: '',
    current_thought: 'AIエージェントを起動しています...',
    turn_count: 0,
    status: 'running',
    error_message: null,
    created_at: now,
    updated_at: now,
    completed_at: null,
    expires_at: null,
  };

  // Save to local fallback store
  const localSessions = readLocalJson<Record<string, KosenSessionRecord>>(LOCAL_SESSIONS_KEY, {});
  localSessions[id] = record;
  writeLocalJson(LOCAL_SESSIONS_KEY, localSessions);

  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('kosen_sessions')
      .insert({
        id: record.id,
        age_group: record.age_group,
        prompt: record.prompt,
        toppings: record.toppings,
        model_tier: record.model_tier,
        model_name: record.model_name,
        provider: record.provider,
        thinking_effort: record.thinking_effort,
        is_public: record.is_public,
        game_title: record.game_title,
        current_thought: record.current_thought,
        status: 'running',
      })
      .select()
      .single();

    if (!error && data) {
      const synced = data as KosenSessionRecord;
      localSessions[synced.id] = synced;
      writeLocalJson(LOCAL_SESSIONS_KEY, localSessions);
      return synced;
    }
  } catch (err) {
    console.warn('Supabase createKosenSession fallback to local:', err);
  }

  return record;
}

export async function updateKosenSession(
  sessionId: string,
  updates: Partial<{
    status: KosenSessionStatus;
    current_code: string;
    current_thought: string;
    turn_count: number;
    game_title: string;
    game_description: string;
    error_message: string | null;
    completed_at: string | null;
    expires_at: string | null;
  }>
): Promise<void> {
  const now = new Date().toISOString();
  const localSessions = readLocalJson<Record<string, KosenSessionRecord>>(LOCAL_SESSIONS_KEY, {});
  if (localSessions[sessionId]) {
    localSessions[sessionId] = {
      ...localSessions[sessionId],
      ...updates,
      updated_at: now,
    };
    writeLocalJson(LOCAL_SESSIONS_KEY, localSessions);
  }

  try {
    const supabase = getSupabaseClient();
    await supabase
      .from('kosen_sessions')
      .update({
        ...updates,
        updated_at: now,
      })
      .eq('id', sessionId);
  } catch {}
}

export async function getKosenSession(sessionId: string): Promise<KosenSessionRecord | null> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('kosen_sessions')
      .select('*')
      .eq('id', sessionId)
      .single();

    if (!error && data) {
      return data as KosenSessionRecord;
    }
  } catch {}

  const localSessions = readLocalJson<Record<string, KosenSessionRecord>>(LOCAL_SESSIONS_KEY, {});
  return localSessions[sessionId] || null;
}

export async function listKosenSessions(limit = 50): Promise<KosenSessionRecord[]> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('kosen_sessions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (!error && data) {
      return data as KosenSessionRecord[];
    }
  } catch {}

  const localSessions = readLocalJson<Record<string, KosenSessionRecord>>(LOCAL_SESSIONS_KEY, {});
  return Object.values(localSessions).sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

export async function deleteKosenSession(sessionId: string): Promise<void> {
  const localSessions = readLocalJson<Record<string, KosenSessionRecord>>(LOCAL_SESSIONS_KEY, {});
  delete localSessions[sessionId];
  writeLocalJson(LOCAL_SESSIONS_KEY, localSessions);

  try {
    const supabase = getSupabaseClient();
    await supabase.from('kosen_sessions').delete().eq('id', sessionId);
  } catch {}
}

// ─── Events Logging & Realtime ───────────────────────────────────────────────

export async function appendKosenEvent(
  sessionId: string,
  eventType: KosenEventRecord['event_type'],
  payload: KosenEventRecord['payload']
): Promise<KosenEventRecord> {
  const now = new Date().toISOString();
  const localEvents = readLocalJson<Record<string, KosenEventRecord[]>>(LOCAL_EVENTS_KEY, {});
  const list = localEvents[sessionId] || [];
  const nextEvent: KosenEventRecord = {
    id: Date.now() + Math.floor(Math.random() * 1000),
    session_id: sessionId,
    event_type: eventType,
    payload,
    created_at: now,
  };
  localEvents[sessionId] = [...list.slice(-100), nextEvent];
  writeLocalJson(LOCAL_EVENTS_KEY, localEvents);

  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('kosen_events')
      .insert({
        session_id: sessionId,
        event_type: eventType,
        payload,
      })
      .select()
      .single();
    if (!error && data) {
      return data as KosenEventRecord;
    }
  } catch {}

  return nextEvent;
}

export async function listKosenEvents(sessionId: string): Promise<KosenEventRecord[]> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('kosen_events')
      .select('*')
      .eq('session_id', sessionId)
      .order('id', { ascending: true })
      .limit(200);

    if (!error && data && data.length > 0) {
      return data as KosenEventRecord[];
    }
  } catch {}

  const localEvents = readLocalJson<Record<string, KosenEventRecord[]>>(LOCAL_EVENTS_KEY, {});
  return localEvents[sessionId] || [];
}

// ─── Games Gallery CRUD ──────────────────────────────────────────────────────

export async function publishKosenGame(params: {
  sessionId: string;
  title: string;
  description: string;
  htmlContent: string;
  ageGroup: AgeGroup;
  modelTier: ModelTier;
  toppings: string[];
  isPublic: boolean;
}): Promise<KosenGameRecord> {
  const now = new Date().toISOString();
  const id = generateUuid();

  const game: KosenGameRecord = {
    id,
    session_id: params.sessionId,
    title: params.title,
    description: params.description,
    html_content: params.htmlContent,
    age_group: params.ageGroup,
    model_tier: params.modelTier,
    toppings: params.toppings,
    is_public: params.isPublic,
    play_count: 0,
    created_at: now,
  };

  const localGames = readLocalJson<KosenGameRecord[]>(LOCAL_GAMES_KEY, []);
  const filtered = localGames.filter((g) => g.session_id !== params.sessionId);
  writeLocalJson(LOCAL_GAMES_KEY, [game, ...filtered]);

  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('kosen_games')
      .upsert(
        {
          session_id: params.sessionId,
          title: params.title,
          description: params.description,
          html_content: params.htmlContent,
          age_group: params.ageGroup,
          model_tier: params.modelTier,
          toppings: params.toppings,
          is_public: params.isPublic,
        },
        { onConflict: 'session_id' }
      )
      .select()
      .single();

    if (!error && data) {
      return data as KosenGameRecord;
    }
  } catch (err) {
    console.warn('Supabase publishKosenGame fallback to local:', err);
  }

  return game;
}

export async function listPublicKosenGames(includePrivate = false): Promise<KosenGameRecord[]> {
  try {
    const supabase = getSupabaseClient();
    let query = supabase
      .from('kosen_games')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (!includePrivate) {
      query = query.eq('is_public', true);
    }

    const { data, error } = await query;
    if (!error && data) {
      const localGames = readLocalJson<KosenGameRecord[]>(LOCAL_GAMES_KEY, []);
      // Merge local unsynced games if any
      const remoteIds = new Set(data.map((g: any) => g.id));
      const remoteSessionIds = new Set(data.map((g: any) => g.session_id).filter(Boolean));
      const unsynced = localGames.filter(
        (lg) =>
          !remoteIds.has(lg.id) &&
          (!lg.session_id || !remoteSessionIds.has(lg.session_id)) &&
          (includePrivate || lg.is_public)
      );
      return [...unsynced, ...(data as KosenGameRecord[])];
    }
  } catch {}

  const localGames = readLocalJson<KosenGameRecord[]>(LOCAL_GAMES_KEY, []);
  return includePrivate ? localGames : localGames.filter((g) => g.is_public);
}

export async function incrementGamePlayCount(gameId: string, currentCount: number): Promise<void> {
  const nextCount = (currentCount || 0) + 1;
  const localGames = readLocalJson<KosenGameRecord[]>(LOCAL_GAMES_KEY, []);
  const updated = localGames.map((g) => (g.id === gameId ? { ...g, play_count: nextCount } : g));
  writeLocalJson(LOCAL_GAMES_KEY, updated);

  try {
    const supabase = getSupabaseClient();
    await supabase.from('kosen_games').update({ play_count: nextCount }).eq('id', gameId);
  } catch {}
}

export async function toggleGamePublicVisibility(
  gameId: string,
  isPublic: boolean
): Promise<void> {
  const localGames = readLocalJson<KosenGameRecord[]>(LOCAL_GAMES_KEY, []);
  const updated = localGames.map((g) => (g.id === gameId ? { ...g, is_public: isPublic } : g));
  writeLocalJson(LOCAL_GAMES_KEY, updated);

  try {
    const supabase = getSupabaseClient();
    await supabase.from('kosen_games').update({ is_public: isPublic }).eq('id', gameId);
  } catch {}
}

export async function deleteKosenGame(gameId: string): Promise<void> {
  const localGames = readLocalJson<KosenGameRecord[]>(LOCAL_GAMES_KEY, []);
  writeLocalJson(
    LOCAL_GAMES_KEY,
    localGames.filter((g) => g.id !== gameId)
  );

  try {
    const supabase = getSupabaseClient();
    await supabase.from('kosen_games').delete().eq('id', gameId);
  } catch {}
}

/**
 * Checks whether a completed session's status page has expired (5 minutes after completed_at).
 */
export function isSessionStatusExpired(
  session: Pick<KosenSessionRecord, 'status' | 'completed_at' | 'expires_at'>,
  nowMs: number = Date.now(),
  expireMinutes = 5
): { expired: boolean; remainingSeconds: number } {
  if (session.status !== 'completed' && session.status !== 'failed' && session.status !== 'cancelled') {
    return { expired: false, remainingSeconds: expireMinutes * 60 };
  }

  let expiryTimeMs: number | null = null;
  if (session.expires_at) {
    expiryTimeMs = new Date(session.expires_at).getTime();
  } else if (session.completed_at) {
    expiryTimeMs = new Date(session.completed_at).getTime() + expireMinutes * 60 * 1000;
  }

  if (!expiryTimeMs || Number.isNaN(expiryTimeMs)) {
    return { expired: false, remainingSeconds: expireMinutes * 60 };
  }

  const diffMs = expiryTimeMs - nowMs;
  const remainingSeconds = Math.max(0, Math.ceil(diffMs / 1000));
  return {
    expired: diffMs <= 0,
    remainingSeconds,
  };
}
