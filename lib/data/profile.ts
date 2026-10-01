import { createClient } from "@/lib/supabase/server";

/**
 * Real replacement for lib/placeholder-data.ts's `currentProfile` mock.
 * Reads the signed-in user's actual `profiles` row plus their real MFA
 * enrollment status (Supabase Auth's own factor list — doc01 §2), rather
 * than a hardcoded object every page previously imported.
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
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, full_name, email, phone, is_super_admin")
    .eq("id", user.id)
    .single();

  if (!profile) return null;

  const { data: factors } = await supabase.auth.mfa.listFactors();
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
