export type ServerKeyProvider = "gemini" | "openrouter" | "surplus";
const PROVIDERS: ServerKeyProvider[] = ["gemini", "openrouter", "surplus"];
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-kosen-staff-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export async function handleGenerationProxy(req: Request, payload: any, deps: {
  isStaffRequest: (req: Request) => Promise<boolean>;
  resolveServerApiKey: (provider: ServerKeyProvider) => Promise<string>;
  fetch: typeof fetch;
}): Promise<Response> {
  if (!await deps.isStaffRequest(req)) {
    return new Response(JSON.stringify({ error: "Staff authentication required" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const provider = payload?.provider as ServerKeyProvider;
  const request = payload?.request;
  if (!PROVIDERS.includes(provider) || !request || typeof request !== "object" ||
      typeof request.model !== "string" || !request.model.trim()) {
    return new Response(JSON.stringify({ error: "Invalid provider request" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const key = await deps.resolveServerApiKey(provider);
  if (!key) return new Response(JSON.stringify({ error: "Provider key is not configured" }), {
    status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
  let url: string;
  let body: unknown;
  let headers: Record<string, string>;
  if (provider === "gemini") {
    if (!Array.isArray(request.contents)) return new Response(JSON.stringify({ error: "Invalid Gemini request" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
    const config = request.config || {};
    url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(request.model)}:generateContent`;
    headers = { "Content-Type": "application/json", "x-goog-api-key": key };
    body = {
      contents: request.contents.map((content: any) => ({
        ...content,
        parts: (content.parts || []).map((part: any) => {
          const { thought_signature, functionCall, ...rest } = part;
          if (!functionCall) return rest;
          const { thoughtSignature, thought_signature: nestedSignature, ...call } = functionCall;
          return { ...rest, functionCall: call };
        }),
      })),
      ...(config.systemInstruction ? { systemInstruction: { parts: [{ text: config.systemInstruction }] } } : {}),
      ...(config.tools ? { tools: config.tools } : {}),
      generationConfig: {
        ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
        ...(config.maxOutputTokens !== undefined ? { maxOutputTokens: config.maxOutputTokens } : {}),
        ...(config.thinkingConfig ? { thinkingConfig: config.thinkingConfig } : {}),
      },
    };
  } else {
    if (!Array.isArray(request.messages)) return new Response(JSON.stringify({ error: "Invalid chat request" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
    url = provider === "openrouter" ? "https://openrouter.ai/api/v1/chat/completions" : "https://api.surplusintelligence.ai/v1/chat/completions";
    headers = { "Content-Type": "application/json", Authorization: `Bearer ${key}` };
    body = request;
  }
  const upstream = await deps.fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: req.signal });
  if (!upstream.ok) {
    console.error(`Provider ${provider} returned HTTP ${upstream.status}`);
    return new Response(JSON.stringify({ error: `Provider request failed (${upstream.status})` }), {
      status: upstream.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { ...corsHeaders, "Content-Type": upstream.headers.get("Content-Type") || "application/json" },
  });
}

export async function handleProviderModels(req: Request, provider: ServerKeyProvider, deps: {
  isStaffRequest: (req: Request) => Promise<boolean>;
  resolveServerApiKey: (provider: ServerKeyProvider) => Promise<string>;
  fetch: typeof fetch;
}): Promise<Response> {
  const response = (status: number, error: string) => new Response(JSON.stringify({ error }), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
  if (!await deps.isStaffRequest(req)) return response(403, "Staff authentication required");
  if (!PROVIDERS.includes(provider)) return response(400, "Invalid provider");
  const key = await deps.resolveServerApiKey(provider);
  if (!key) return response(400, "Provider key is not configured");
  const urls = {
    gemini: "https://generativelanguage.googleapis.com/v1beta/models",
    openrouter: "https://openrouter.ai/api/v1/models",
    surplus: "https://api.surplusintelligence.ai/v1/models",
  };
  const headers: Record<string, string> = provider === "gemini" ? { "x-goog-api-key": key } : { Authorization: `Bearer ${key}` };
  const upstream = await deps.fetch(urls[provider], { headers, signal: req.signal });
  if (!upstream.ok) return response(upstream.status, `Provider request failed (${upstream.status})`);
  return new Response(upstream.body, { status: upstream.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
