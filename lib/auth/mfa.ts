"use server";

import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  MFA_BACKUP_COOKIE_MAX_AGE,
  MFA_BACKUP_COOKIE_NAME,
  createMfaBackupCookieValue,
} from "@/lib/auth/mfa-session";

/**
 * Mandatory 2FA (doc01 §2, doc03 Stage 2a — moved to signup, required for
 * every account). Authenticator-app (TOTP) is the default factor as of
 * 2026-09-29 (doc00 changelog) — SMS via Twilio was built first but
 * parked once it turned out Supabase gates its phone-provider config
 * behind the Pro plan ($25/mo), which isn't justified pre-revenue. TOTP
 * costs nothing, needs no third-party provider, and is what most
 * security-conscious users expect anyway. The Twilio account and the
 * phone-factor code path stay available in git history if SMS is worth
 * revisiting later (doc04 §7b).
 *
 * Supabase Auth's TOTP MFA is a three-step dance regardless of which
 * screen is calling it:
 *   1. enroll() creates the factor and returns a QR code + plaintext
 *      secret for the user's authenticator app — unverified for a new
 *      enrollment; already-verified and reused for the returning-session
 *      challenge
 *   2. challenge() opens a verification window (challengeId) — unlike
 *      the phone factor, this sends nothing anywhere; the code already
 *      lives in the user's authenticator app
 *   3. verify(factorId, challengeId, code) checks the 6-digit TOTP code
 *      and — for an already-verified factor — elevates the session to
 *      aal2
 * Every action here returns a plain result object rather than using
 * useActionState's (prevState, formData) shape: the enroll/challenge
 * screens are multi-step (QR/secret → code → backup codes) with
 * client-held state (factorId/challengeId) threading between steps, not
 * a single form submission.
 */

export type MfaActionResult<T = undefined> =
  | { status: "ok"; data: T }
  | { status: "error"; message: string };

const BACKUP_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L — avoids misreads
const BACKUP_CODE_COUNT = 10;

/**
 * Starts TOTP enrollment: creates the (unverified) factor and returns the
 * QR code plus plaintext secret so the enroll screen can render both a
 * scannable code and a manual-entry fallback.
 */
export async function startTotpEnrollment(): Promise<
  MfaActionResult<{ factorId: string; qrCode: string; secret: string }>
> {
  const supabase = await createClient();

  const { data: enrollData, error: enrollError } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    issuer: "StrataCouncil.ca",
    friendlyName: "Authenticator app",
  });
  if (enrollError) {
    return { status: "error", message: enrollError.message };
  }

  return {
    status: "ok",
    data: {
      factorId: enrollData.id,
      qrCode: enrollData.totp.qr_code,
      secret: enrollData.totp.secret,
    },
  };
}

/**
 * Completes enrollment: opens a challenge window, verifies the code from
 * the user's authenticator app (elevating this session to aal2), and on
 * success generates the one-time backup-codes set in the same step —
 * doc03 Stage 2a treats these as one continuous screen, not separate
 * actions the UI happens to chain.
 */
export async function verifyTotpEnrollment(
  factorId: string,
  code: string
): Promise<MfaActionResult<{ backupCodes: string[] }>> {
  const supabase = await createClient();

  const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({
    factorId,
  });
  if (challengeError) {
    // Clean up the unverified factor so a retry doesn't pile up dead
    // enrollments against the account — best-effort, ignore its own error.
    await supabase.auth.mfa.unenroll({ factorId });
    return { status: "error", message: challengeError.message };
  }

  const { error: verifyError } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challengeData.id,
    code,
  });
  if (verifyError) {
    return { status: "error", message: verifyError.message };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { status: "error", message: "Session not found after verification." };
  }

  const backupResult = await generateBackupCodes(user.id);
  if (backupResult.status === "error") {
    return backupResult;
  }

  return { status: "ok", data: { backupCodes: backupResult.data.codes } };
}

/**
 * Returning-session verification (doc03 Stage 2a "Verification" screen).
 * Looks up the account's already-verified TOTP factor and opens a fresh
 * challenge window — a TOTP challenge expires after a few minutes, so
 * this can't reuse a stale challengeId from a previous session.
 */
export async function startTotpChallenge(): Promise<
  MfaActionResult<{ factorId: string; challengeId: string }>
> {
  const supabase = await createClient();

  const { data: factorsData, error: factorsError } = await supabase.auth.mfa.listFactors();
  if (factorsError) {
    return { status: "error", message: factorsError.message };
  }
  const totpFactor = factorsData.totp?.find((f) => f.status === "verified");
  if (!totpFactor) {
    return { status: "error", message: "No verified authenticator app on this account." };
  }

  const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({
    factorId: totpFactor.id,
  });
  if (challengeError) {
    return { status: "error", message: challengeError.message };
  }

  return {
    status: "ok",
    data: { factorId: totpFactor.id, challengeId: challengeData.id },
  };
}

/** Verifies a returning-session challenge code — elevates this session to aal2. */
export async function verifyTotpChallenge(
  factorId: string,
  challengeId: string,
  code: string
): Promise<MfaActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.verify({ factorId, challengeId, code });
  if (error) {
    return { status: "error", message: error.message };
  }
  return { status: "ok", data: undefined };
}

/**
 * Backup-code verification — the fallback Supabase's own MFA model
 * doesn't cover (see lib/auth/mfa-session.ts for why). On success, sets
 * a signed cookie the middleware gate accepts in place of real aal2, and
 * marks the code used so it can't be replayed.
 */
export async function verifyBackupCode(rawCode: string): Promise<MfaActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { status: "error", message: "Not signed in." };
  }

  const normalized = rawCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const hash = await sha256Hex(normalized);

  const { data: matches, error: lookupError } = await supabase
    .from("mfa_backup_codes")
    .select("id")
    .eq("user_id", user.id)
    .eq("code_hash", hash)
    .is("used_at", null)
    .limit(1);

  if (lookupError) {
    return { status: "error", message: lookupError.message };
  }
  if (!matches || matches.length === 0) {
    return { status: "error", message: "That backup code isn't valid, or has already been used." };
  }

  const { error: updateError } = await supabase
    .from("mfa_backup_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("id", matches[0].id);
  if (updateError) {
    return { status: "error", message: updateError.message };
  }

  const cookieValue = await createMfaBackupCookieValue(user.id);
  const cookieStore = await cookies();
  cookieStore.set(MFA_BACKUP_COOKIE_NAME, cookieValue, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: MFA_BACKUP_COOKIE_MAX_AGE,
  });

  return { status: "ok", data: undefined };
}

/**
 * Generates and stores a fresh set of 10 backup codes, replacing any
 * existing set (doc01 §2 — "there is only ever one live set of 10 per
 * account, never an accumulating history"). Returns the plaintext codes
 * for the one-time display screen; only their hashes are persisted.
 */
async function generateBackupCodes(
  userId: string
): Promise<MfaActionResult<{ codes: string[] }>> {
  const supabase = await createClient();

  const codes = Array.from({ length: BACKUP_CODE_COUNT }, () => generateOneBackupCode());
  const hashes = await Promise.all(codes.map((code) => sha256Hex(code.replace("-", ""))));

  const { error: deleteError } = await supabase
    .from("mfa_backup_codes")
    .delete()
    .eq("user_id", userId);
  if (deleteError) {
    return { status: "error", message: deleteError.message };
  }

  const rows = hashes.map((code_hash) => ({ user_id: userId, code_hash }));
  const { error: insertError } = await supabase.from("mfa_backup_codes").insert(rows);
  if (insertError) {
    return { status: "error", message: insertError.message };
  }

  return { status: "ok", data: { codes } };
}

function generateOneBackupCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let raw = "";
  for (const byte of bytes) {
    raw += BACKUP_CODE_ALPHABET[byte % BACKUP_CODE_ALPHABET.length];
  }
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
