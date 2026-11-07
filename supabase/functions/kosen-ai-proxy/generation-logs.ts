/** Only these diagnostic fields cross the persistence boundary. */
export function safeLog(input: any, secret = "") {
  const clean = (value: unknown, max = 2000) => {
    if (typeof value !== "string") return undefined;
    let text = secret ? value.split(secret).join("[REDACTED]") : value;
    text = text.replace(/Bearer\s+[^\s"']+/gi, "Bearer [REDACTED]")
      .replace(/(?:sk-|inf_)[a-zA-Z0-9_-]+/g, "[REDACTED]");
    return text.slice(0, max);
  };
  const details: Record<string, unknown> = {};
  for (const key of ["code", "message", "request_id", "tool", "reasoning_effort"]) {
    const value = clean(input?.details?.[key]);
    if (value !== undefined) details[key] = value;
  }
  if (Number.isInteger(input?.details?.http_status)) details.http_status = input.details.http_status;
  return { session_id: clean(input?.session_id, 100), provider: clean(input?.provider, 100),
    model: clean(input?.model, 200), event: clean(input?.event, 50) || "failed", details };
}

export async function recordLog(admin: any, input: any) {
  try {
    const { error } = await admin.from("kosen_generation_logs").insert(safeLog(input));
    if (error) console.error("Generation log persistence failed");
  } catch { console.error("Generation log persistence failed"); }
}
