"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useActionState } from "react";
import { Logo } from "@/components/Logo";
import { sendOtp } from "@/lib/auth/actions";
import { initialSendOtpState } from "@/lib/auth/otp-state";

/**
 * Passwordless sign-in (doc00 changelog 2026-09-29): same signInWithOtp()
 * call as /signup, just without a full_name field — omitting it means an
 * existing user's profile row is never touched by signing in. Supabase
 * doesn't distinguish "sign up" from "sign in" at the API level; a
 * returning email just gets a fresh link instead of a new account.
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
            style={{ display: "flex", justifyContent: "center", marginBottom: "1.5rem" }}
          >
            <Logo className="auth-card__mark" />
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
          style={{ display: "flex", justifyContent: "center", marginBottom: "1.5rem" }}
        >
          <Logo className="auth-card__mark" />
        </Link>
        <h1>Welcome back</h1>
        <p>Sign in to continue your training or your strata&rsquo;s Stratasphere&trade;.</p>
        <form action={formAction}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" autoComplete="email" required data-testid="login-email" />
            <span className="field__hint">
              We&rsquo;ll email you a one-time link &mdash; no password needed.
            </span>
          </div>
          {(state.status === "error" || linkError) && (
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
