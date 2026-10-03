"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MFA_BACKUP_COOKIE_NAME } from "@/lib/auth/mfa-session";
import type { SendOtpState } from "@/lib/auth/otp-state";

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
 *   (full_name, and marketing_opt_in for CASL, doc01 §2 / 0006). Name and
 *   Terms acceptance are required here, on the server too. An email that
 *   already has an account just gets a sign-in link; Supabase only applies
 *   the metadata when it creates the user, so nothing is overwritten.
 * - Sign-in never creates an account (shouldCreateUser: false). An email
 *   with no account comes back as "no_account", and the login page offers
 *   sign-up with the email filled in. That does confirm whether an email
 *   has an account, which is accepted here for a clear message.
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

  if (!email) {
    return { status: "error", message: "Enter your email address." };
  }
  if (signingUp && !fullName) {
    return { status: "error", email, message: "Enter your full name." };
  }
  if (signingUp && formData.get("accept_terms") !== "on") {
    return { status: "error", email, message: "Agree to the Terms & Conditions and Privacy Policy to continue." };
  }

  const origin = (await headers()).get("origin");
  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: signingUp,
      emailRedirectTo: `${origin}/auth/confirm`,
      ...(signingUp ? { data: { full_name: fullName, marketing_opt_in: marketingOptIn } } : {}),
    },
  });

  if (error) {
    // Supabase's answer to a sign-in for an email it doesn't know.
    if (!signingUp && (error.code === "otp_disabled" || /signups? not allowed/i.test(error.message))) {
      return { status: "no_account", email };
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
