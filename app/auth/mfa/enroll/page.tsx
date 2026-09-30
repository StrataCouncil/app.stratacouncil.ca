"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { startTotpEnrollment, verifyTotpEnrollment } from "@/lib/auth/mfa";

/**
 * Doc03 Stage 2a, "Enrollment" — shown exactly once per account,
 * immediately after signup, before the dashboard or any training
 * content (moved here from corporation-connection time per the Sept 29
 * decision, doc01 §2 §7 item 14). Three steps, one screen each: scan/enter
 * a QR code or secret into an authenticator app → 6-digit code
 * (autocomplete="one-time-code") → backup codes, required-acknowledged
 * before "Continue" enables.
 *
 * TOTP, not SMS (doc00 changelog 2026-09-29, doc04 §7b) — Supabase's
 * phone-provider config is Pro-plan-gated, which isn't worth it
 * pre-revenue. TOTP needs no third-party provider and works offline once
 * scanned.
 *
 * Not reachable directly without a session — middleware.ts's MFA gate is
 * what sends an unenrolled, signed-in account here; this page doesn't
 * re-check that itself.
 */
type Step = "loading" | "totp" | "code" | "backup";

export default function MfaEnrollPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("loading");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function start() {
      const result = await startTotpEnrollment();
      if (cancelled) return;
      if (result.status === "error") {
        setError(result.message);
        setStep("totp");
        return;
      }
      setFactorId(result.data.factorId);
      setQrCode(result.data.qrCode);
      setSecret(result.data.secret);
      setStep("totp");
    }
    start();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCodeSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setError(null);
    setPending(true);
    const result = await verifyTotpEnrollment(factorId, code);
    setPending(false);
    if (result.status === "error") {
      setError(result.message);
      return;
    }
    setBackupCodes(result.data.backupCodes);
    setStep("backup");
  }

  function handleDownload() {
    const text = `StrataCouncil.ca backup codes\nGenerated ${new Date().toLocaleString()}\n\n${backupCodes.join(
      "\n"
    )}\n\nEach code works once. Keep this somewhere safe — anyone who has\nthese codes can sign in to your account without your authenticator app.\n`;
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "stratacouncil-backup-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleContinue() {
    router.push("/");
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <Link
          href="/"
          style={{ display: "flex", justifyContent: "center", marginBottom: "1.5rem" }}
        >
          <Logo className="auth-card__mark" />
        </Link>

        {step === "loading" && (
          <>
            <h1>Set up a second way to sign in</h1>
            <p>Preparing your authenticator setup…</p>
          </>
        )}

        {step === "totp" && (
          <>
            <h1>Set up a second way to sign in</h1>
            <p>
              This keeps your account secure. Scan this code with an
              authenticator app &mdash; Google Authenticator, Authy, 1Password,
              or similar &mdash; then enter the 6-digit code it shows you.
            </p>
            {qrCode && (
              <div className="totp-setup">
                <img
                  src={qrCode}
                  alt="Scan with your authenticator app"
                  className="totp-setup__qr"
                  data-testid="mfa-totp-qr"
                />
                {secret && (
                  <div className="totp-setup__secret">
                    <span className="field__hint">Can&rsquo;t scan? Enter this key manually:</span>
                    <code data-testid="mfa-totp-secret">{secret}</code>
                  </div>
                )}
              </div>
            )}
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
                  disabled={!factorId}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  data-testid="mfa-code-input"
                />
              </div>
              {error && (
                <p className="field__hint" style={{ color: "var(--danger, #c0392b)" }} data-testid="mfa-code-error">
                  {error}
                </p>
              )}
              <button
                type="submit"
                className="button button-primary"
                disabled={pending || !factorId}
                data-testid="mfa-code-submit"
              >
                {pending ? "Verifying…" : "Confirm"}
              </button>
            </form>
          </>
        )}

        {step === "backup" && (
          <>
            <h1>Save your backup codes</h1>
            <p>
              If you ever lose access to your authenticator app, one of
              these codes gets you back in. Each works once. Download or
              print them now &mdash; we can&rsquo;t show them to you again.
            </p>
            <div className="backup-codes" data-testid="mfa-backup-codes">
              {backupCodes.map((c) => (
                <code key={c}>{c}</code>
              ))}
            </div>
            <div className="backup-codes__actions">
              <button type="button" className="button button-secondary" onClick={handleDownload}>
                Download
              </button>
              <button type="button" className="button button-secondary" onClick={() => window.print()}>
                Print
              </button>
            </div>
            <div className="field field--checkbox" style={{ marginTop: "1.5rem" }}>
              <label htmlFor="ack">
                <input
                  id="ack"
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                  data-testid="mfa-backup-ack"
                />
                <span>I&rsquo;ve saved my backup codes somewhere safe.</span>
              </label>
            </div>
            <button
              type="button"
              className="button button-primary"
              disabled={!acknowledged}
              onClick={handleContinue}
              data-testid="mfa-backup-continue"
            >
              Continue
            </button>
          </>
        )}
      </div>
    </div>
  );
}
