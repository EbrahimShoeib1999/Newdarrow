/**
 * Trusted assistant provider abstraction (Phase 8B / 8C).
 *
 * Hard security rule: an AI provider key (e.g. Gemini) MUST NOT be read or used
 * from the browser — `import.meta.env.VITE_*` values are bundled into the public
 * client, so anything prefixed VITE_ is exposed. The repo's `.env.example`
 * carries a client-side gemini API key variable, but calling a provider with it
 * directly from the frontend would leak the secret and bypass every authorization / rate-limit /
 * cost control the brief requires. We therefore never reference it here.
 *
 * The assistant only performs LIVE inference when a trusted backend endpoint is
 * configured via VITE_ASSISTANT_ENDPOINT. That endpoint (Cloud Function / other
 * server) is responsible for: authenticating the caller, validating tenant
 * membership, retrieving only authorized context, applying rate limits, holding
 * the provider key server-side, and returning text the client treats as untrusted.
 *
 * When no endpoint is configured, live AI is BLOCKED — the caller falls back to
 * the safe, deterministic in-app help knowledge base and support escalation. This
 * is an honest "unconfigured" state, never a fake success.
 */

export type AssistantStatus = "enabled" | "blocked";

export interface AssistantAskResult {
  ok: boolean;
  /** Provider answer text. Undefined when not ok. */
  text?: string;
  /** Machine reason: "blocked" | "empty" | "http:<code>" | "timeout" | "network". */
  reason?: string;
  status: AssistantStatus;
}

/** The minimal, safe context we are ever willing to send to the backend. */
export interface AssistantContext {
  lang: "ar" | "en";
  /** A bare route path only (see safePageReference) — never query values. */
  pageRef?: string;
}

function assistantEndpoint(): string | null {
  // Read the env value only through this guard: plain tsx script runners may
  // evaluate ESM without a Vite layer, where import.meta.env is undefined.
  const env =
    typeof import.meta !== "undefined" && import.meta.env
      ? (import.meta.env as Record<string, string | undefined>)
      : undefined;
  const raw = env?.VITE_ASSISTANT_ENDPOINT ?? "";
  const trimmed = raw.trim();
  // Reject non-http(s) values so a misconfiguration never turns into an XSS sink.
  if (!trimmed) return null;
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
}

/** Pure-ish: does not throw; the UI uses this to pick enabled vs blocked copy. */
export function assistantStatus(): AssistantStatus {
  return assistantEndpoint() ? "enabled" : "blocked";
}

export function isLiveAssistantEnabled(): boolean {
  return assistantStatus() === "enabled";
}

/**
 * Ask the trusted backend. Never sends secrets; sends only the user's question
 * and the minimal authorized context. Output is UNTRUSTED and must be rendered as
 * plain text by the caller. Timeouts and provider errors degrade gracefully to
 * the non-AI help path rather than inventing an answer.
 */
export async function askAssistant(
  question: string,
  ctx: AssistantContext,
  timeoutMs = 20000
): Promise<AssistantAskResult> {
  const endpoint = assistantEndpoint();
  const status: AssistantStatus = endpoint ? "enabled" : "blocked";
  if (!endpoint) {
    return { ok: false, reason: "blocked", status };
  }
  const q = question.trim();
  if (!q) return { ok: false, reason: "empty", status };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // The backend derives identity from the Firebase Auth token it validates;
      // we deliberately do not attach tenant/business data beyond the safe page ref.
      body: JSON.stringify({ question: q, lang: ctx.lang, pageRef: ctx.pageRef ?? null }),
      signal: controller.signal,
    });
    if (!res.ok) {
      return { ok: false, reason: `http:${res.status}`, status };
    }
    const data = (await res.json()) as { answer?: unknown };
    const answer = typeof data.answer === "string" ? data.answer : undefined;
    if (!answer?.trim()) return { ok: false, reason: "empty", status };
    return { ok: true, text: answer, status };
  } catch (err: unknown) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return { ok: false, reason: aborted ? "timeout" : "network", status };
  } finally {
    clearTimeout(timer);
  }
}
