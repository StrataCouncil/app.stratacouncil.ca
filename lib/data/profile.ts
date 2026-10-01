import { createClient } from "@/lib/supabase/server";

/**
 * Real replacement for lib/placeholder-data.ts's `currentProfile` mock.
 * Reads the signed-in user's actual `profiles` row plus their real MFA
 * enrollment status (Supabase Auth's own factor list — doc01 §2), rather
 * than a hardcoded object every page previously imported.
 *
 * Logs rather than silently swallowing errors — a Server Component
 * returning null here renders a quiet "not signed in" state with no
 * visible error, which makes a real failure (RLS denial, bad query, a
 * stale client) indistinguishable from "no session" from the UI alone.
 */
export interface CurrentProfile {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  isSuperAdmin: boolean;
  twoFactorEnabled: boolean;
}

export async function getCurrentProfile(): Promise<CurrentProfile | null> {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    console.error("[getCurrentProfile] auth.getUser() error:", userError.message);
  }
  if (!user) {
    console.error("[getCurrentProfile] no user on this request");
    return null;
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, full_name, email, phone, is_super_admin")
    .eq("id", user.id)
    .single();

  if (profileError) {
    console.error(
      `[getCurrentProfile] profiles query error for user ${user.id}:`,
      profileError.message,
      profileError.code
    );
  }
  if (!profile) return null;

  const { data: factors, error: mfaError } = await supabase.auth.mfa.listFactors();
  if (mfaError) {
    console.error("[getCurrentProfile] mfa.listFactors() error:", mfaError.message);
  }
  const twoFactorEnabled =
    factors?.totp?.some((f) => f.status === "verified") ?? false;

  return {
    id: profile.id,
    fullName: profile.full_name,
    email: profile.email ?? user.email ?? "",
    phone: profile.phone,
    isSuperAdmin: profile.is_super_admin,
    twoFactorEnabled,
  };
}
