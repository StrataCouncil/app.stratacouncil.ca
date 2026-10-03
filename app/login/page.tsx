"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useActionState } from "react";
import { Logo } from "@/components/Logo";
import { sendOtp } from "@/lib/auth/actions";
import { initialSendOtpState } from "@/lib/auth/otp-state";

/**
 * Passwordless sign-in (doc00 changelog 2026-09-29). Never creates an
 * account (lib/auth/actions.ts sendOtp): an email with no account gets
 * "no account" and a button to sign up with the email filled in.
 *
 * `error` in the URL comes from the /auth/confirm route handler when a
 * link has expired or was already used. Wrapped in Suspense because
 * useSearchParams() requires it in the App Router — without it, this
 * page would be forced out of static rendering at build time.
 */
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const [state, formAction, pending] = useActionState(sendOtp, initialSendOtpState);
  const linkError = useSearchParams().get("error");

  if (state.status === "sent") {
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
          <h1>Check your email</h1>
          <p>
            We sent a sign-in link to <strong>{state.email}</strong>. Click it to
            continue &mdash; this tab can stay open.
          </p>
        </div>
      </div>
    );
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
        <h1>Welcome back</h1>
        <p>Sign in to continue your training or your strata&rsquo;s Stratasphere&trade;.</p>
        <form action={formAction}>
          <input type="hidden" name="intent" value="signin" />
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              defaultValue={state.email ?? ""}
              data-testid="login-email"
            />
            <span className="field__hint">
              We&rsquo;ll email you a one-time link &mdash; no password needed.
            </span>
          </div>
          {state.status === "no_account" && (
            <div className="auth-notice" role="status" data-testid="login-no-account">
              <p>
                There&rsquo;s no account for <strong>{state.email}</strong>. Check the spelling, or create
                an account.
              </p>
              <Link
                href={`/signup?email=${encodeURIComponent(state.email ?? "")}`}
                className="button button-secondary button-small"
                data-testid="login-create-account"
              >
                Create an account
              </Link>
            </div>
          )}
          {(state.status === "error" || (linkError && state.status === "idle")) && (
            <p className="field__hint" style={{ color: "var(--danger, #c0392b)" }} data-testid="login-error">
              {state.message ?? linkError}
            </p>
          )}
          <button type="submit" className="button button-primary" disabled={pending} data-testid="login-submit">
            {pending ? "Sending…" : "Send sign-in link"}
          </button>
        </form>
        <div className="auth-card__footer">
          Don&rsquo;t have an account? <Link href="/signup">Start free training</Link>
        </div>
      </div>
    </div>
  );
}
