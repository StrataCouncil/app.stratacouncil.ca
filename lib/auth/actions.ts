"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { safeNext } from "@/lib/safe-next";
import { createClient } from "@/lib/supabase/server";
import { MFA_BACKUP_COOKIE_NAME } from "@/lib/auth/mfa-session";
import type { SendOtpState } from "@/lib/auth/otp-state";
import { readCampaign } from "@/lib/campaign";
import { domainTakesMail } from "@/lib/security/mail-domain";
import { TURNSTILE_FIELD } from "@/lib/security/turnstile";

// SendOtpState's type and initial value moved to lib/auth/otp-state.ts —
// this "use server" file may only export async functions (Next.js 15.5),
// and initialSendOtpState is a plain object, not a function. The type is
// imported (not re-exported) purely for this file's own function
// signatures below; login/page.tsx and signup/page.tsx now import
// initialSendOtpState directly from lib/auth/otp-state.ts instead.

/**
 * Passwordless auth (doc03 Stage 2, doc00 changelog 2026-09-29): both
 * /signup and /login send a one-time link with signInWithOtp(), told
 * apart by the form's `intent` field.
 *
 * - Sign-up may create the account. Migration 0001's on_auth_user_created
 *   trigger then creates the profiles row from raw_user_meta_data
 *   (full_name, marketing_opt_in for CASL, doc01 §2 / 0006, and the
 *   campaign tags the sign-up link carried, 0066). Name and
 *   Terms acceptance are required here, on the server too. An email that
 *   already has an account just gets a sign-in link; Supabase only applies
 *   the metadata when it creates the user, so nothing is overwritten.
 * - Sign-in never creates an account (shouldCreateUser: false). An email
 *   with no account comes back as "no_account", and the login page offers
 *   sign-up with the email filled in. That does confirm whether an email
 *   has an account, which is accepted here for a clear message.
 *
 * Bots (Mailtrap's hard-bounce report, 2026-11-11): the Turnstile token
 * goes to Supabase, which checks it once CAPTCHA is on in its dashboard
 * (Authentication, Attack Protection), so a bot can't skip this form; a
 * hidden field people never see catches simple bots; and no link goes to
 * a domain that can't receive mail.
 *
 * Invited people don't come through here: their account is created when
 * the invite is sent (auth.admin.generateLink, roster-actions.ts), so a
 * later sign-in finds it.
 */
export async function sendOtp(
  _prevState: SendOtpState,
  formData: FormData
): Promise<SendOtpState> {
  const signingUp = formData.get("intent") === "signup";
  const email = String(formData.get("email") ?? "").trim();
  const fullName = String(formData.get("full_name") ?? "").trim();
  const marketingOptIn = formData.get("marketing_opt_in") === "on";
  const campaign = readCampaign(formData);

  if (!email) {
    return { status: "error", message: "Enter your email address." };
  }
  // The hidden field people never see: anything in it is a bot. It's told the link went.
  if (String(formData.get("website") ?? "").trim()) {
    return { status: "sent", email };
  }
  if (signingUp && !fullName) {
    return { status: "error", email, message: "Enter your full name." };
  }
  if (signingUp && formData.get("accept_terms") !== "on") {
    return { status: "error", email, message: "Agree to the Terms & Conditions and Privacy Policy to continue." };
  }

  if (!(await domainTakesMail(email))) {
    return { status: "error", email, message: "That email address can't receive mail. Check the spelling (after the @ especially) and try again." };
  }
  const captchaToken = String(formData.get(TURNSTILE_FIELD) ?? "") || undefined;
  if (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && !captchaToken) {
    return { status: "error", email, message: "The security check hasn't finished. Wait a moment, then try again." };
  }

  const origin = (await headers()).get("origin");
  // Back to the page they were sent to sign in from (an email's vote button, say).
  const next = safeNext(String(formData.get("next") ?? ""));
  const confirm = `${origin}/auth/confirm${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`;
  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: signingUp,
      emailRedirectTo: confirm,
      captchaToken,
      ...(signingUp
        ? { data: { full_name: fullName, marketing_opt_in: marketingOptIn, ...(campaign ? { campaign } : {}) } }
        : {}),
    },
  });

  if (error) {
    // Supabase's answer to a sign-in for an email it doesn't know.
    if (!signingUp && (error.code === "otp_disabled" || /signups? not allowed/i.test(error.message))) {
      return { status: "no_account", email };
    }
    if (/captcha/i.test(error.message)) {
      return { status: "error", email, message: "The security check didn't pass. Try again; if it keeps happening, reload the page." };
    }
    return { status: "error", email, message: error.message };
  }

  return { status: "sent", email };
}

/**
 * Wired to AccountMenu's "Sign out" item. A Server Action rather than a
 * plain Link to /login (the mock's old behavior) because signing out has
 * to actually clear the Supabase session cookies before the redirect —
 * server.ts's cookie handlers are what make that call effective.
 *
 * Also clears the backup-code MFA cookie (lib/auth/mfa-session.ts) —
 * that cookie asserts "this session cleared MFA," and a session that no
 * longer exists shouldn't leave a lingering assertion behind for
 * whoever signs in next on this device.
 */
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  (await cookies()).delete(MFA_BACKUP_COOKIE_NAME);
  redirect("/login");
}
