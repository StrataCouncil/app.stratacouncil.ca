"use client";

import Link from "next/link";
import { Suspense, useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { Logo } from "@/components/Logo";
import { sendOtp } from "@/lib/auth/actions";
import { initialSendOtpState } from "@/lib/auth/otp-state";

/**
 * Stage 2 signup (doc03): email + full name only, no SP#, no corporation,
 * no password — passwordless auth via signInWithOtp() (doc00 changelog
 * 2026-09-29). Submitting sends a one-time link/code to the given email;
 * clicking it both creates the account (first time) and signs in
 * (migration 0001's trigger creates the profiles row from full_name).
 */
export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupForm />
    </Suspense>
  );
}

function SignupForm() {
  const [state, formAction, pending] = useActionState(sendOtp, initialSendOtpState);
  // From the login page's "Create an account", when the email had no account.
  const prefilledEmail = useSearchParams().get("email") ?? "";

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
            finish creating your account &mdash; this tab can stay open.
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
        <h1>Start free training</h1>
        <p>No strata plan number needed &mdash; just your name and email.</p>
        <form action={formAction}>
          <input type="hidden" name="intent" value="signup" />
          <div className="field">
            <label htmlFor="full_name">Full name</label>
            <input id="full_name" name="full_name" type="text" autoComplete="name" required data-testid="signup-name" />
            <span className="field__hint">
              This appears on your certificates and can&rsquo;t be changed later.
            </span>
          </div>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              defaultValue={state.email ?? prefilledEmail}
              data-testid="signup-email"
            />
          </div>
          <div className="field field--checkbox">
            <label htmlFor="accept_terms">
              <input
                id="accept_terms"
                name="accept_terms"
                type="checkbox"
                required
                data-testid="signup-accept-terms"
              />
              <span>
                I agree to the{" "}
                <a href="https://stratacouncil.ca/terms" target="_blank" rel="noopener noreferrer">
                  Terms &amp; Conditions
                </a>{" "}
                and{" "}
                <a href="https://stratacouncil.ca/privacy" target="_blank" rel="noopener noreferrer">
                  Privacy Policy
                </a>
                .
              </span>
            </label>
          </div>
          <div className="field field--checkbox">
            <label htmlFor="marketing_opt_in">
              <input
                id="marketing_opt_in"
                name="marketing_opt_in"
                type="checkbox"
                data-testid="signup-marketing-opt-in"
              />
              <span>
                Send me occasional updates &mdash; legislative changes, new
                StrataSphere features, and other news. Optional, and you can
                unsubscribe any time.
              </span>
            </label>
          </div>
          {state.status === "error" && (
            <p className="field__hint" style={{ color: "var(--danger, #c0392b)" }} data-testid="signup-error">
              {state.message}
            </p>
          )}
          <button type="submit" className="button button-primary" disabled={pending} data-testid="signup-submit">
            {pending ? "Sending…" : "Create account"}
          </button>
        </form>
        <div className="auth-card__footer">
          Already have an account? <Link href="/login">Sign in</Link>
        </div>
      </div>
    </div>
  );
}
