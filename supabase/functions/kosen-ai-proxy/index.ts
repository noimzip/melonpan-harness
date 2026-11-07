import { recordLog } from "./generation-logs.ts";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { handleGenerationProxy, handleProviderModels } from "./generation-proxy.ts";
import { verifyLegacyAssertion } from "./webauthn-assertion.ts";
import { generateHmacSignature, verifyHmacToken } from "./staff-session.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-kosen-staff-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ProxyRequest {
  action:
    | "transcribe"
    | "toppings"
    | "expand"
    | "summary"
    | "chat"
    | "append_generation_log"
    | "list_generation_logs"
    | "generate_provider"
    | "list_provider_models"
    | "save_server_key"
    | "save_enrollment_secret"
    | "get_enrollment_secret_status"
    | "check_key_status"
    | "get_staff_enrollment_token"
    | "passkey_get_challenge"
    | "passkey_register"
    | "passkey_login"
    | "passkey_verify_session";
  payload: any;
}

// ─── WebAuthn / Passkey Server Utilities ──────────────────────────────────────
async function resolveEnrollmentSecret(): Promise<string> {
  const envSecret = Deno.env.get("STAFF_ENROLLMENT_SECRET");
  if (envSecret) return envSecret;
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return "";
  const { data, error } = await createClient(url, serviceKey)
    .from("kosen_staff_secrets").select("enrollment_secret").eq("id", true).maybeSingle();
  if (error) console.error("Failed to read enrollment secret:", error.message);
  return data?.enrollment_secret || "";
}

type ServerKeyProvider = "gemini" | "openrouter" | "surplus";
const serverKeyProviders: ServerKeyProvider[] = ["gemini", "openrouter", "surplus"];

async function resolveServerApiKey(provider: ServerKeyProvider = "gemini"): Promise<string> {
  const envNames = { gemini: "GEMINI_API_KEY", openrouter: "OPENROUTER_API_KEY", surplus: "SURPLUS_API_KEY" };
  const envKey = Deno.env.get(envNames[provider]) || (provider === "gemini" ? Deno.env.get("API_KEY") : "");
  if (envKey) return envKey;
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return "";
  const admin = createClient(url, serviceKey);
  const { data, error } = await admin.from("kosen_provider_secrets").select("api_key").eq("provider", provider).maybeSingle();
  if (error) console.error("Failed to read provider key:", error.message);
  if (data?.api_key) return data.api_key;
  // Preserve existing Gemini deployments until the key is re-registered.
  if (provider === "gemini") {
    const { data: legacy } = await admin.from("kosen_admin_config").select("value").eq("key", "server_secrets").maybeSingle();
    return legacy?.value?.geminiApiKey || "";
  }
  return "";
}

async function isStaffRequest(req: Request): Promise<boolean> {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const url = Deno.env.get("SUPABASE_URL");
  if (!serviceKey || !url) return false;
  const staffToken = req.headers.get("x-kosen-staff-token");
  if (staffToken && (await verifyHmacToken(staffToken, serviceKey)).valid) return true;
  const token = req.headers.get("Authorization")?.replace(/^Bearer /i, "");
  if (!token) return false;
  const { data: { user }, error } = await createClient(url, serviceKey).auth.getUser(token);
  return !error && user?.email === "staff@kosen.local" && Boolean(user?.email_confirmed_at);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body: ProxyRequest = await req.json();
    const { action, payload } = body;

    // The legacy registration flow lacks attestation verification. Use Supabase Auth for enrollment.
    if (action === "passkey_register") {
      return new Response(JSON.stringify({ error: "Legacy passkey authentication is temporarily unavailable" }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }


    // Key management is restricted to authenticated staff; secrets never leave the server.
    if (action === "check_key_status" || action === "save_server_key") {
      if (!await isStaffRequest(req)) {
        return new Response(JSON.stringify({ error: "Staff authentication required" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const provider = payload?.provider || "gemini";
      if (!serverKeyProviders.includes(provider)) {
        return new Response(JSON.stringify({ error: "Unsupported provider" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (action === "check_key_status") {
        const key = await resolveServerApiKey(provider);
        return new Response(JSON.stringify({ configured: Boolean(key), maskedKey: key ? `...${key.slice(-4)}` : null }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const inputKey = payload?.apiKey ?? (provider === "gemini" ? payload?.geminiApiKey : undefined);
      const newKey = typeof inputKey === "string" ? inputKey.trim() : "";
      const url = Deno.env.get("SUPABASE_URL");
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!newKey || !url || !serviceKey) {
        return new Response(JSON.stringify({ error: "Missing key or credentials" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { error } = await createClient(url, serviceKey).from("kosen_provider_secrets").upsert({
        provider, api_key: newKey, updated_at: new Date().toISOString(),
      }, { onConflict: "provider" });
      if (error) {
        console.error("Failed to save provider key:", error.message);
        return new Response(JSON.stringify({ error: "Failed to save key" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Enrollment secrets grant staff access, so neither status nor updates are public.
    if (action === "save_enrollment_secret" || action === "get_enrollment_secret_status") {
      if (!await isStaffRequest(req)) {
        return new Response(JSON.stringify({ error: "Staff authentication required" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (action === "get_enrollment_secret_status") {
        const secret = await resolveEnrollmentSecret();
        return new Response(JSON.stringify({ configured: Boolean(secret), maskedSecret: secret ? `...${secret.slice(-3)}` : null, secretLength: secret.length }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const secret = typeof payload?.enrollmentSecret === "string" ? payload.enrollmentSecret.trim() : "";
      const url = Deno.env.get("SUPABASE_URL");
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!secret || !url || !serviceKey) return new Response(JSON.stringify({ error: "Missing secret or credentials" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
      const { error } = await createClient(url, serviceKey).from("kosen_staff_secrets").upsert({
        id: true, enrollment_secret: secret, updated_at: new Date().toISOString(),
      });
      if (error) return new Response(JSON.stringify({ error: "Failed to save secret" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ─── 0-OFFICIAL. GET STAFF ENROLLMENT TOKEN (SUPABASE AUTH PASSKEYS) ───────
    if (action === "get_staff_enrollment_token") {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!supabaseUrl || !serviceKey) {
        return new Response(
          JSON.stringify({ error: "Supabase service credentials not configured" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // 🔒 GUARD: Verify staff enrollment secret to prevent unauthorized passkey creation by guests
      const providedSecret = String(payload?.enrollmentSecret || "").trim();
      const expectedSecret = await resolveEnrollmentSecret();

      if (!providedSecret || providedSecret !== expectedSecret) {
        return new Response(
          JSON.stringify({
            error: "スタッフ登録用シークレットキーが一致しません。部外者によるパスキー登録は拒否されました。",
          }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const supabaseAdmin = createClient(supabaseUrl, serviceKey);
      const staffEmail = "staff@kosen.local";

      // Ensure staff user exists and is confirmed
      const { data: usersData } = await supabaseAdmin.auth.admin.listUsers();
      const existingUser = usersData?.users?.find((u: any) => u.email === staffEmail);
      if (!existingUser) {
        await supabaseAdmin.auth.admin.createUser({
          email: staffEmail,
          email_confirm: true,
          user_metadata: { role: "staff", exhibition: "melonpan-kosen" },
        });
      }

      // Generate magiclink / OTP token
      const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
        type: "magiclink",
        email: staffEmail,
      });

      if (linkErr || !linkData?.properties) {
        return new Response(
          JSON.stringify({ error: linkErr?.message || "Failed to generate staff enrollment token" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          email: staffEmail,
          token_hash: linkData.properties.hashed_token,
          email_otp: linkData.properties.email_otp,
          verification_type: "magiclink",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ─── 0-A. PASSKEY: GET CHALLENGE ─────────────────────────────────────────
    if (action === "passkey_get_challenge") {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!supabaseUrl || !serviceKey) {
        return new Response(
          JSON.stringify({ error: "Supabase service credentials not configured" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const supabaseAdmin = createClient(supabaseUrl, serviceKey);

      // Generate 32-byte cryptographic random challenge (Base64URL)
      const randomBytes = new Uint8Array(32);
      crypto.getRandomValues(randomBytes);
      let binary = "";
      for (let i = 0; i < randomBytes.length; i++) {
        binary += String.fromCharCode(randomBytes[i]);
      }
      const challenge = btoa(binary)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "");

      // Save challenge with 5-minute TTL
      await supabaseAdmin.from("kosen_passkey_challenges").insert({
        challenge,
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      });

      // Get existing registered passkeys credential IDs for allowCredentials
      const { data: passkeys } = await supabaseAdmin
        .from("kosen_staff_passkeys")
        .select("credential_id, display_name");

      return new Response(
        JSON.stringify({
          challenge,
          existingCredentials: (passkeys || []).map((p: any) => ({
            id: p.credential_id,
            displayName: p.display_name,
          })),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Legacy credentials are SPKI keys; validate the complete WebAuthn assertion before issuing a session.
    if (action === "passkey_login") {
      const { challenge, credentialId, signature, clientDataJSON, authenticatorData } = payload || {};
      const url = Deno.env.get("SUPABASE_URL");
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      const invalid = () => new Response(JSON.stringify({ error: "Passkey verification failed" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
      if (![challenge, credentialId, signature, clientDataJSON, authenticatorData].every(v => typeof v === "string" && v.length > 0) || !url || !serviceKey) return invalid();
      const admin = createClient(url, serviceKey);
      // Atomic consumption means even concurrent requests cannot replay one challenge.
      const { data: consumed, error: challengeError } = await admin.from("kosen_passkey_challenges")
        .delete().eq("challenge", challenge).gt("expires_at", new Date().toISOString()).select("challenge").maybeSingle();
      if (challengeError || !consumed) return invalid();
      const { data: credential, error: credentialError } = await admin.from("kosen_staff_passkeys")
        .select("credential_id, public_key, counter").eq("credential_id", credentialId).maybeSingle();
      if (credentialError || !credential) return invalid();
      const counter = Number(credential.counter || 0);
      const verification = await verifyLegacyAssertion({
        challenge, clientDataJSON, authenticatorData, signature, publicKey: credential.public_key,
        origin: "https://melonpan-kosen.vercel.app", rpId: "melonpan-kosen.vercel.app", previousCounter: counter,
      });
      if (!verification.valid) return invalid();
      const { data: updated, error: updateError } = await admin.from("kosen_staff_passkeys")
        .update({ counter: verification.counter }).eq("credential_id", credentialId).eq("counter", counter).select("credential_id").maybeSingle();
      if (updateError || !updated) return invalid();
      const now = Date.now();
      const payloadB64 = btoa(JSON.stringify({ email: "staff@kosen.local", version: 2, authTime: now })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
      const message = `${payloadB64}.${now}`;
      const staffToken = `${message}.${await generateHmacSignature(message, serviceKey)}`;
      return new Response(JSON.stringify({ success: true, staffToken, email: "staff@kosen.local" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── 0-D. PASSKEY: VERIFY EXISTING SESSION TOKEN ──────────────────────────
    if (action === "passkey_verify_session") {
      const { staffToken } = payload || {};
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

      if (!staffToken || !serviceKey) {
        return new Response(
          JSON.stringify({ valid: false }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const res = await verifyHmacToken(staffToken, serviceKey);
      return new Response(
        JSON.stringify(res),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "append_generation_log" || action === "list_generation_logs") {
      const respond = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
        status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
      if (!await isStaffRequest(req)) return respond({ error: "Staff authentication required" }, 403);
      const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      if (action === "append_generation_log") {
        if (!["started", "tool", "completed", "cancelled", "failed"].includes(payload?.event)) return respond({ error: "Invalid event" }, 400);
        // Arbitrary error messages and generated content must not be accepted from the client.
        await recordLog(admin, { ...payload, details: { tool: payload?.details?.tool } });
        return respond({ success: true });
      }
      let query = admin.from("kosen_generation_logs").select("*")
        .gte("created_at", new Date(Date.now() - 30 * 86400000).toISOString());
      for (const field of ["provider", "event", "session_id"]) {
        if (typeof payload?.[field] === "string" && payload[field]) query = query.eq(field, payload[field]);
      }
      if (typeof payload?.since === "string" && Number.isFinite(Date.parse(payload.since))) query = query.gte("created_at", payload.since);
      const offset = Number.isInteger(payload?.offset) ? Math.max(0, Math.min(payload.offset, 100000)) : 0;
      const { data, error } = await query.order("created_at", { ascending: false }).order("id").range(offset, offset + 99);
      return error ? respond({ error: "ログを取得できませんでした" }, 500) : respond({ logs: data });
    }

    if (action === "list_provider_models") {
      return await handleProviderModels(req, payload?.provider, { isStaffRequest, resolveServerApiKey, fetch });
    }
    if (action === "generate_provider") {
      return await handleGenerationProxy(req, payload, { isStaffRequest, resolveServerApiKey, fetch, recordLog: (entry) => recordLog(createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!), entry) });
    }

    const apiKey = await resolveServerApiKey();
    if (!apiKey) {
      return new Response(
        JSON.stringify({
          error: "GEMINI_API_KEY is not configured on Supabase server. Please configure it in Admin Panel or Edge Secrets.",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ─── 1. TRANSCRIBE (gemini-3.5-transcribe) ───────────────────────────────
    if (action === "transcribe") {
      const model = payload?.model || "gemini-3.5-transcribe";
      const audioBase64 = payload?.audioBase64;
      const mimeType = payload?.mimeType || "audio/webm";

      if (!audioBase64) {
        return new Response(
          JSON.stringify({ error: "audioBase64 is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Try Interactions API first
      try {
        const interRes = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify({
            model,
            input: [
              {
                type: "audio",
                data: audioBase64,
                mime_type: mimeType,
              },
            ],
          }),
        });

        if (interRes.ok) {
          const data = await interRes.json();
          const text = data.output_text || data.interaction?.outputText || data.text || "";
          return new Response(JSON.stringify({ text: text.trim() }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } catch (err) {
        console.warn("Interactions API failed, falling back to generateContent:", err);
      }

      // Fallback to generateContent API
      const genRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    inlineData: {
                      mimeType,
                      data: audioBase64,
                    },
                  },
                  {
                    text: "この日本語音声を正確に文字起こししてください。文字起こししたテキストのみを出力してください。",
                  },
                ],
              },
            ],
          }),
        }
      );

      if (!genRes.ok) {
        const errData = await genRes.json().catch(() => ({}));
        return new Response(
          JSON.stringify({ error: errData.error?.message || "Transcription failed" }),
          { status: genRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const genData = await genRes.json();
      const text = genData.candidates?.[0]?.content?.parts?.[0]?.text || "";
      return new Response(JSON.stringify({ text: text.trim() }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── 2. TOPPINGS PROPOSAL ───────────────────────────────────────────────
    if (action === "toppings") {
      const model = payload?.model || "gemini-3.5-flash";
      const prompt = payload?.prompt || "";
      const maxCount = payload?.maxCount || 10;

      const sysPrompt =
        'あなたは文化祭のゲーム制作アシスタントです。ユーザーの作りたいゲームに対して、追加するとさらに面白くなる「トッピング要素（ギミックや演出）」を10個提案してください。必ずJSON配列のみで出力してください: [{"emoji":"💥","text":"短い説明(25文字以内)"}]';

      const genRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: sysPrompt }] },
            contents: [
              {
                parts: [{ text: `作りたいゲーム: ${prompt}\n10個のトッピングをJSON配列で出力して:` }],
              },
            ],
          }),
        }
      );

      if (!genRes.ok) {
        const errData = await genRes.json().catch(() => ({}));
        return new Response(
          JSON.stringify({ error: errData.error?.message || "Toppings generation failed" }),
          { status: genRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const genData = await genRes.json();
      const rawText = genData.candidates?.[0]?.content?.parts?.[0]?.text || "";
      const jsonMatch = rawText.match(/\[[\s\S]*\]/);
      let toppings: any[] = [];
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          if (Array.isArray(parsed)) {
            toppings = parsed.slice(0, maxCount).map((item: any, idx: number) => ({
              id: `top_${idx}_${Date.now()}`,
              emoji: String(item.emoji || "✨"),
              text: String(item.text || ""),
            }));
          }
        } catch {}
      }

      return new Response(JSON.stringify({ toppings }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── 3. PROMPT EXPANSION ────────────────────────────────────────────────
    if (action === "expand") {
      const model = payload?.model || "gemini-3.5-flash";
      const prompt = payload?.prompt || "";

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

      const genRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: sysPrompt }] },
            contents: [
              {
                parts: [
                  {
                    text: `ユーザーの入力した初期アイデア: 「${prompt}」\nこのアイデアをベースに、3つの異なる方向性（1: ギミック・必殺技強化、2: 世界観・キャラクター強化、3: お祭りフィーバー・ハイスコア強化）で拡張したJSON配列を出力してください:`,
                  },
                ],
              },
            ],
          }),
        }
      );

      if (!genRes.ok) {
        const errData = await genRes.json().catch(() => ({}));
        return new Response(
          JSON.stringify({ error: errData.error?.message || "Prompt expansion failed" }),
          { status: genRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const genData = await genRes.json();
      const rawText = genData.candidates?.[0]?.content?.parts?.[0]?.text || "";
      const jsonMatch = rawText.match(/\[[\s\S]*\]/);
      let options: any[] = [];
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          if (Array.isArray(parsed) && parsed.length >= 2) {
            options = parsed.slice(0, 3).map((item: any, idx: number) => ({
              id: `exp_${idx}_${Date.now()}`,
              title: String(item.title || `拡張プラン ${idx + 1}`),
              emoji: String(item.emoji || "✨"),
              summary: String(item.summary || "アイデアをパワーアップ！"),
              expandedPrompt: String(item.expandedPrompt || prompt),
            }));
          }
        } catch {}
      }

      return new Response(JSON.stringify({ options }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── 4. SUMMARY & TITLE GENERATION ──────────────────────────────────────
    if (action === "summary") {
      const model = payload?.model || "gemini-3.5-flash";
      const prompt = payload?.prompt || "";
      const toppings = Array.isArray(payload?.toppings) ? payload.toppings.join(", ") : "";
      const userTitle = payload?.userTitle?.trim();

      const sysPrompt =
        'あなたはゲーム展示のキュレーターAIです。作成されたゲームの「作品名（15文字以内）」と「作品概要（50〜80文字程度）」を魅力的に作成してください。必ずJSON形式のみで出力してください: {"title":"作品名","description":"作品概要"}';

      const genRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: sysPrompt }] },
            contents: [
              {
                parts: [
                  {
                    text: `プロンプト: ${prompt}\n追加トッピング: ${toppings}\n指定された作品名(あれば優先): ${userTitle || "なし"}`,
                  },
                ],
              },
            ],
          }),
        }
      );

      if (genRes.ok) {
        const genData = await genRes.json();
        const rawText = genData.candidates?.[0]?.content?.parts?.[0]?.text || "";
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0]);
            return new Response(
              JSON.stringify({
                title: userTitle || parsed.title || "オリジナルゲーム",
                description: parsed.description || "楽しいオリジナルゲーム！",
              }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          } catch {}
        }
      }

      return new Response(
        JSON.stringify({
          title: userTitle || "高専祭オリジナルゲーム",
          description: `「${prompt.slice(0, 40)}」をテーマにしたオリジナルゲームです。`,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ─── 5. CHAT / GAME GENERATION ──────────────────────────────────────────
    if (action === "chat") {
      const model = payload?.model || "gemini-3.8-flash";
      const messages = payload?.messages || [];
      const systemInstruction = payload?.systemInstruction;

      const requestBody: any = { contents: messages };
      if (systemInstruction) {
        requestBody.systemInstruction = { parts: [{ text: systemInstruction }] };
      }

      const genRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        }
      );

      const genData = await genRes.json();
      return new Response(JSON.stringify(genData), {
        status: genRes.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error?.message || "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
