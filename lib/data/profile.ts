import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The signed-in user's `profiles` row plus their MFA enrollment status
 * (Supabase Auth's own factor list — doc01 §2).
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
  /** Short-lived signed URL for the profile photo, if there is one. */
  avatarUrl: string | null;
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
    .select("id, full_name, email, phone, is_super_admin, avatar_path")
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

  // Super Admin powers need a two-step-verified session (0053). The
  // database's is_super_admin() checks the session as well as the flag, so
  // ask it rather than trusting the flag on its own.
  let isSuperAdmin = false;
  if (profile.is_super_admin) {
    const { data } = await supabase.rpc("is_super_admin");
    isSuperAdmin = data === true;
  }

  const { data: factors, error: mfaError } = await supabase.auth.mfa.listFactors();
  if (mfaError) {
    console.error("[getCurrentProfile] mfa.listFactors() error:", mfaError.message);
  }
  const twoFactorEnabled =
    factors?.totp?.some((f) => f.status === "verified") ?? false;

  let avatarUrl: string | null = null;
  if (profile.avatar_path) {
    const { data: signed, error: signError } = await createAdminClient()
      .storage.from("avatars")
      .createSignedUrl(profile.avatar_path, 60 * 60);
    if (signError) console.error("[getCurrentProfile] avatar url:", signError.message);
    avatarUrl = signed?.signedUrl ?? null;
  }

  return {
    id: profile.id,
    fullName: profile.full_name,
    email: profile.email ?? user.email ?? "",
    phone: profile.phone,
    isSuperAdmin,
    twoFactorEnabled,
    avatarUrl,
  };
}
