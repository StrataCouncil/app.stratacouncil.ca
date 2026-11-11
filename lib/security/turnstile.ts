/**
 * Cloudflare Turnstile (bot check), server side. The widget
 * (components/Turnstile.tsx) puts a one-time token in the form as
 * `cf-turnstile-response`.
 *
 * - Sign-up and sign-in: Supabase checks the token itself (Authentication,
 *   Attack Protection, CAPTCHA), so a bot can't skip the form and ask
 *   Supabase for a link directly. lib/auth/actions.ts only passes it on.
 * - Our own forms that send email (the investor briefing): checked here,
 *   with TURNSTILE_SECRET_KEY.
 *
 * Without TURNSTILE_SECRET_KEY (local development, tests) the check is
 * skipped, so the forms keep working.
 */
const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export const TURNSTILE_FIELD = "cf-turnstile-response";

export function turnstileEnabled(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY);
}

/** True when the token is Cloudflare's own, fresh and unused. A token is good for one check only. */
export async function verifyTurnstile(token: unknown, remoteIp?: string | null): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true;
  const response = String(token ?? "").trim();
  if (!response || response.length > 2048) return false;
  const body = new URLSearchParams({ secret, response });
  if (remoteIp) body.set("remoteip", remoteIp);
  try {
    const res = await fetch(VERIFY_URL, { method: "POST", body, cache: "no-store", signal: AbortSignal.timeout(8000) });
    const data = (await res.json()) as { success?: boolean; "error-codes"?: string[] };
    if (!data.success) console.warn("[turnstile] refused", data["error-codes"]?.join(", "));
    return data.success === true;
  } catch (err) {
    // Cloudflare unreachable: let the person through rather than lock everyone out.
    console.error("[turnstile] verify failed", err instanceof Error ? err.message : err);
    return true;
  }
}
