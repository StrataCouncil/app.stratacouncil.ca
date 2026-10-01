import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

/**
 * The signed-in user's access to one corporation: is StrataSphere
 * subscribed, is the trial meeting still available, and which roles do
 * they hold. `cache()` makes this one set of queries per request, however
 * many server components under `/strata/[corpId]` ask for it — the layout
 * and the page both do.
 *
 * Returns null if the user isn't an active member (RLS hides the corp).
 */
export interface StrataAccess {
  corpId: string;
  subscribed: boolean;
  freeMeetingUsed: boolean;
  roles: string[];
  isAdmin: boolean;
}

export const getStrataAccess = cache(async (corpId: string): Promise<StrataAccess | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: corp }, { data: sub }, { data: roleRows }] = await Promise.all([
    supabase
      .from("strata_corporations")
      .select("strata_plan_number, free_meeting_used")
      .eq("strata_plan_number", corpId)
      .maybeSingle(),
    supabase.from("subscriptions").select("status").eq("corporation_id", corpId).maybeSingle(),
    supabase
      .from("corporation_role_assignments")
      .select("role")
      .eq("corporation_id", corpId)
      .eq("user_id", user.id),
  ]);
  if (!corp) return null;

  const roles = (roleRows ?? []).map((r) => r.role as string);
  return {
    corpId: corp.strata_plan_number,
    subscribed: sub?.status === "active",
    freeMeetingUsed: corp.free_meeting_used,
    roles,
    isAdmin: roles.includes("admin"),
  };
});
