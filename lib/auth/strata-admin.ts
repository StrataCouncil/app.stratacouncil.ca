import type { SupabaseClient } from "@supabase/supabase-js";
import { IS_DEMO } from "@/lib/demo";

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

/**
 * Can the signed-in user use this strata's Billing? Its admin (and Super
 * Admins), or its Manager when the admin has allowed it (0045). No one in
 * the demo (lib/demo.ts): its stratas are already subscribed.
 */
export async function canManageBilling(supabase: SupabaseClient, corpId: string): Promise<boolean> {
  if (IS_DEMO) return false;
  const { data } = await supabase.rpc("can_manage_billing", { target_corporation_id: corpId });
  return data === true;
}
