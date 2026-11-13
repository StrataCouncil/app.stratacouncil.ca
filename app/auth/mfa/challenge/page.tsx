"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import {
  startTotpChallenge,
  verifyTotpChallenge,
  verifyBackupCode,
} from "@/lib/auth/mfa";
import { signOut } from "@/lib/auth/actions";

/**
 * Doc03 Stage 2a, "Verification" — shown on every subsequent new session
 * or device once an account has completed enrollment. A single screen:
 * "Enter the code from your authenticator app," with a challenge window
 * opened automatically on mount, plus a small "Lost access to your
 * authenticator app? Use a backup code instead" link that swaps in a
 * backup-code form.
 *
 * TOTP, not SMS (doc00 changelog 2026-09-29) — nothing is "sent" here;
 * the code already lives in the user's authenticator app. The challenge
 * window just expires after a few minutes, so "Get a new code" re-opens
 * it rather than resending anything.
 *
 * Not reachable without a session — middleware.ts's MFA gate sends an
 * enrolled-but-unverified-this-session account here; this page doesn't
 * re-check that itself. On success it just redirects home — the gate
 * re-evaluates the next request and lets it through once aal2 (or the
 * backup-code cookie) is satisfied.
 */
type Mode = "totp" | "backup";

/** Where they were going when asked for the code (middleware.ts), on this site only. */
function nextPath() {
  const next = new URLSearchParams(window.location.search).get("next");
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export default function MfaChallengePage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("totp");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [backupCode, setBackupCode] = useState("");
  const [pending, setPending] = useState(false);
  const [preparing, setPreparing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usedBackup, setUsedBackup] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function openInitialChallenge() {
      setPreparing(true);
      setError(null);
      const result = await startTotpChallenge();
      if (cancelled) return;
      setPreparing(false);
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      setFactorId(result.data.factorId);
      setChallengeId(result.data.challengeId);
    }
    openInitialChallenge();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleGetNewCode() {
    setError(null);
    setPreparing(true);
    const result = await startTotpChallenge();
    setPreparing(false);
    if (result.status === "error") {
      setError(result.message);
      return;
    }
    setFactorId(result.data.factorId);
    setChallengeId(result.data.challengeId);
    setCode("");
  }

  async function handleCodeSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId || !challengeId) return;
    setError(null);
    setPending(true);
    const result = await verifyTotpChallenge(factorId, code);
    setPending(false);
    if (result.status === "error") {
      setError(result.message);
      return;
    }
    router.push(nextPath());
  }

  async function handleBackupSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const result = await verifyBackupCode(backupCode);
    setPending(false);
    if (result.status === "error") {
      setError(result.message);
      return;
    }
    setUsedBackup(true);
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <Link
          href="/"
          className="auth-card__brand"
        >
          <Logo className="auth-card__mark" />
            <span className="auth-card__wordmark">StrataCouncil.ca</span>
        </Link>

        {usedBackup && (
          <>
            <h1>You&rsquo;re signed in</h1>
            <p>
              That backup code has been used, and your authenticator app has been removed from your account, along
              with your other backup codes. You can set up two-step verification again at any time in Account
              Settings.
            </p>
            <button type="button" className="button button-primary" onClick={() => router.push(nextPath())} data-testid="mfa-challenge-continue">
              Continue
            </button>
          </>
        )}

        {!usedBackup && mode === "totp" && (
          <>
            <h1>Enter your code</h1>
            <p>
              {preparing
                ? "One moment…"
                : "Enter the 6-digit code from your authenticator app."}
            </p>
            <form onSubmit={handleCodeSubmit}>
              <div className="field">
                <label htmlFor="code">Verification code</label>
                <input
                  id="code"
                  name="code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  disabled={preparing}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  data-testid="mfa-challenge-code-input"
                />
              </div>
              {error && (
                <p
                  className="field__hint"
                  style={{ color: "var(--danger, #c0392b)" }}
                  data-testid="mfa-challenge-error"
                >
                  {error}
                </p>
              )}
              <button
                type="submit"
                className="button button-primary"
                disabled={pending || preparing || !factorId}
                data-testid="mfa-challenge-submit"
              >
                {pending ? "Verifying…" : "Confirm"}
              </button>
            </form>
            <div className="auth-card__footer">
              <button
                type="button"
                onClick={handleGetNewCode}
                className="link-button"
                disabled={preparing || pending}
                data-testid="mfa-challenge-resend"
              >
                Code not working? Get a new one
              </button>
              <div style={{ marginTop: "0.75rem" }}>
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setMode("backup");
                  }}
                  className="link-button"
                  data-testid="mfa-challenge-use-backup"
                >
                  Lost access to your authenticator app? Use a backup code instead
                </button>
              </div>
            </div>
          </>
        )}

        {!usedBackup && mode === "backup" && (
          <>
            <h1>Use a backup code</h1>
            <p>Enter one of the backup codes you saved when you set up 2FA.</p>
            <form onSubmit={handleBackupSubmit}>
              <div className="field">
                <label htmlFor="backup-code">Backup code</label>
                <input
                  id="backup-code"
                  name="backup-code"
                  type="text"
                  autoComplete="off"
                  placeholder="XXXX-XXXX"
                  required
                  value={backupCode}
                  onChange={(e) => setBackupCode(e.target.value)}
                  data-testid="mfa-challenge-backup-input"
                />
              </div>
              {error && (
                <p
                  className="field__hint"
                  style={{ color: "var(--danger, #c0392b)" }}
                  data-testid="mfa-challenge-backup-error"
                >
                  {error}
                </p>
              )}
              <button
                type="submit"
                className="button button-primary"
                disabled={pending}
                data-testid="mfa-challenge-backup-submit"
              >
                {pending ? "Verifying…" : "Confirm"}
              </button>
            </form>
            <div className="auth-card__footer">
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setBackupCode("");
                  setMode("totp");
                }}
                className="link-button"
                data-testid="mfa-challenge-use-totp"
              >
                Use your authenticator app instead
              </button>
            </div>
          </>
        )}

        {!usedBackup && (
          <form action={signOut} className="auth-card__footer">
            <button type="submit" className="link-button" data-testid="mfa-challenge-sign-out">
              Sign out
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
