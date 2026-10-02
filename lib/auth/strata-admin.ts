import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Is the signed-in user this strata's admin? Asks the database's own role
 * check (has_corporation_role), which also answers yes for Super Admins:
 * they have full admin control of every strata (0021). Use this rather
 * than reading corporation_role_assignments directly.
 */
export async function isStrataAdmin(supabase: SupabaseClient, corpId: string): Promise<boolean> {
  const { data } = await supabase.rpc("has_corporation_role", {
    target_corporation_id: corpId,
    target_roles: ["admin"],
  });
  return data === true;
}
