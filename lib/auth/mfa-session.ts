/**
 * Backup-code session verification — a gap the design docs (doc01 §2,
 * doc03 Stage 2a) left unresolved: Supabase's own MFA model has no
 * "backup code" factor type. `getAuthenticatorAssuranceLevel()` only
 * reaches `aal2` by actually completing challenge/verify against an
 * enrolled factor (phone, in our case) — there's no supported way to
 * hand it a backup code instead and have it report aal2. A backup code
 * has to prove possession of *something* the phone challenge would have
 * proven, without ever touching the phone.
 *
 * Resolved here (implementation-time decision, not previously in any
 * doc — see doc00 changelog): a backup code verifies against
 * `mfa_backup_codes` (server-side, migration 0007) and, on success,
 * issues our own signed, httpOnly cookie asserting "this session cleared
 * MFA via a backup code." middleware.ts's gate accepts either Supabase's
 * real aal2 OR a valid one of these cookies — never rolls its own crypto
 * for the phone path, only for this one fallback Supabase doesn't cover.
 *
 * HMAC-SHA256 via Web Crypto (`crypto.subtle`), not a JWT library —
 * available in both the Edge middleware runtime and ordinary Node
 * Server Actions with no added dependency, which matters since this
 * session can't run `npm install` (persistent registry 403, doc00
 * changelog) to verify a new package resolves cleanly.
 *
 * Cookie lifetime is deliberately tied to the Supabase session, not a
 * fixed short window: it's cleared explicitly on sign-out
 * (lib/auth/actions.ts) and otherwise carries a generous 30-day maxAge,
 * mirroring "verified for this session/device" rather than "verified
 * for this one request." A shorter, rolling re-verification window is a
 * reasonable future tightening, not designed here.
 */

const COOKIE_NAME = "sc_mfa_backup";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days — see note above

function getSecret(): string {
  const secret = process.env.MFA_BACKUP_SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "MFA_BACKUP_SESSION_SECRET is not set. Generate one (e.g. `openssl rand -base64 32`) " +
        "and add it to your environment before backup-code verification can work."
    );
  }
  return secret;
}

function toBase64Url(bytes: ArrayBuffer): string {
  const bin = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return toBase64Url(signature);
}

/** Constant-time-ish string compare — avoids short-circuiting on the first mismatched byte. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Builds the cookie value for a given user — call after a valid backup-code verification. */
export async function createMfaBackupCookieValue(userId: string): Promise<string> {
  const payload = `${userId}.${Date.now()}`;
  const signature = await hmac(payload);
  return `${payload}.${signature}`;
}

/**
 * Verifies a cookie value asserts backup-code MFA clearance for the
 * given user, this session. Returns false on any mismatch, missing
 * cookie, or tampering — never throws for a bad/absent cookie, only for
 * a missing MFA_BACKUP_SESSION_SECRET (a deployment error, not a normal
 * "not verified" case).
 */
export async function verifyMfaBackupCookieValue(
  value: string | undefined,
  userId: string
): Promise<boolean> {
  if (!value) return false;
  const parts = value.split(".");
  if (parts.length !== 3) return false;
  const [cookieUserId, issuedAtRaw, signature] = parts;
  if (cookieUserId !== userId) return false;

  const payload = `${cookieUserId}.${issuedAtRaw}`;
  const expected = await hmac(payload);
  if (!timingSafeEqual(signature, expected)) return false;

  const issuedAt = Number(issuedAtRaw);
  if (!Number.isFinite(issuedAt)) return false;
  if (Date.now() - issuedAt > MAX_AGE_SECONDS * 1000) return false;

  return true;
}

export const MFA_BACKUP_COOKIE_NAME = COOKIE_NAME;
export const MFA_BACKUP_COOKIE_MAX_AGE = MAX_AGE_SECONDS;
