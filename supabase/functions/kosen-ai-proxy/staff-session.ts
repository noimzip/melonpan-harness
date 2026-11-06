export async function generateHmacSignature(message: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function verifyHmacToken(tokenString: string, secret: string): Promise<{ valid: boolean; email?: string }> {
  try {
    const parts = tokenString.split(".");
    if (parts.length !== 3) return { valid: false };
    const [payloadB64, timestampStr, sig] = parts;
    const now = Date.now();
    const created = Number(timestampStr);
    // 8-hour session validity
    if (!Number.isFinite(created) || created > now || now - created > 8 * 60 * 60 * 1000) {
      return { valid: false };
    }
    if (!/^[a-f0-9]{64}$/.test(sig)) return { valid: false };
    const message = `${payloadB64}.${timestampStr}`;
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const sigBytes = Uint8Array.from(sig.match(/../g)!, byte => parseInt(byte, 16));
    if (!await crypto.subtle.verify("HMAC", key, sigBytes, new TextEncoder().encode(message))) return { valid: false };
    const payload = JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")));
    if (payload.version !== 2 || payload.email !== "staff@kosen.local") return { valid: false };
    return { valid: true, email: payload.email };
  } catch {
    return { valid: false };
  }
}

