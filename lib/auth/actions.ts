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
 * Passwordless auth (doc03 Stage 2, doc00 changelog 2026-09-29): one
 * signInWithOtp() call covers both signup and sign-in. If no auth.users
 * row exists for this email yet, Supabase creates one on first
 * verification — migration 0001's on_auth_user_created trigger then
 * creates the matching profiles row, reading full_name out of
 * raw_user_meta_data. A returning email just gets a fresh sign-in link;
 * full_name is omitted from that call (see the login page) so it never
 * overwrites an existing profile's name.
 *
 * Shared by both /signup and /login — they differ only in the form
 * fields they collect and the copy shown after sending, not in how the
 * OTP itself is requested.
 *
 * marketing_opt_in (doc01 §2, migration 0006) rides the same
 * raw_user_meta_data channel as full_name — an unchecked-by-default,
 * optional checkbox, distinct from the required Terms/Privacy checkbox
 * (which isn't persisted anywhere yet, per that same migration's note;
 * this is the one consent that needs a timestamped record, for CASL).
 * Only meaningful on the signup path (fullName present) — omitted on
 * login the same way full_name is, so a returning user's existing
 * preference is never touched by signing back in.
 */
export async function sendOtp(
  _prevState: SendOtpState,
  formData: FormData
): Promise<SendOtpState> {
  const email = String(formData.get("email") ?? "").trim();
  const fullName = String(formData.get("full_name") ?? "").trim();
  const marketingOptIn = formData.get("marketing_opt_in") === "on";

  if (!email) {
    return { status: "error", message: "Enter your email address." };
  }

  const origin = (await headers()).get("origin");
  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: `${origin}/auth/confirm`,
      ...(fullName
        ? { data: { full_name: fullName, marketing_opt_in: marketingOptIn } }
        : {}),
    },
  });

  if (error) {
    return { status: "error", message: error.message };
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
