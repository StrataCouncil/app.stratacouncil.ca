import { cache } from "react";
import { IS_DEMO } from "@/lib/demo";
import { createClient } from "@/lib/supabase/server";

/**
 * The signed-in user's access to one corporation: is StrataSphere
 * subscribed, is the trial meeting still available, and which roles do
 * they hold. `cache()` makes this one set of queries per request, however
 * many server components under `/strata/[corpId]` ask for it — the layout
 * and the page both do.
 *
 * Returns null if the user can't see the corporation (RLS hides it).
 *
 * Super Admins have full admin control of every strata (0021): the
 * database's role checks answer yes for them, so they get `isAdmin` and
 * `canRunMeetings` here too. `superAdminOnly` marks a Super Admin who
 * isn't actually a member, for the banner that says so.
 */
export interface StrataAccess {
  corpId: string;
  subscribed: boolean;
  /** Subscribed, with Stripe still confirming the first payment (0030). */
  pending: boolean;
  freeMeetingUsed: boolean;
  roles: string[];
  isAdmin: boolean;
  /** The admin, or the Manager when the admin allows it (0045): uses Billing. Never in the demo. */
  canBill: boolean;
  /** Secretary, admin, or the "Can run meetings" switch (0014). */
  canRunMeetings: boolean;
  userId: string;
  /** A Super Admin managing a strata they aren't a member of. */
  superAdminOnly: boolean;
}

export const getStrataAccess = cache(async (corpId: string): Promise<StrataAccess | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: corp }, { data: sub }, { data: roleRows }, { data: canRun }, { data: membership }, { data: superAdmin }, { data: canBill }] =
    await Promise.all([
    supabase
      .from("strata_corporations")
      .select("strata_plan_number, free_meeting_used")
      .eq("strata_plan_number", corpId)
      .maybeSingle(),
    supabase.from("subscriptions").select("status, stripe_subscription_id, stripe_status").eq("corporation_id", corpId).maybeSingle(),
    supabase
      .from("corporation_role_assignments")
      .select("role")
      .eq("corporation_id", corpId)
      .eq("user_id", user.id),
    supabase.rpc("can_run_meetings", { target_corporation_id: corpId }),
    supabase
      .from("corporation_memberships")
      .select("status")
      .eq("corporation_id", corpId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle(),
    supabase.rpc("is_super_admin"),
    supabase.rpc("can_manage_billing", { target_corporation_id: corpId }),
  ]);
  if (!corp) return null;

  const roles = (roleRows ?? []).map((r) => r.role as string);
  return {
    corpId: corp.strata_plan_number,
    subscribed: sub?.status === "active",
    pending: sub?.status !== "active" && Boolean(sub?.stripe_subscription_id) && sub?.stripe_status === "incomplete",
    freeMeetingUsed: corp.free_meeting_used,
    roles,
    isAdmin: superAdmin === true || roles.includes("admin"),
    canBill: !IS_DEMO && canBill === true,
    canRunMeetings: canRun === true,
    userId: user.id,
    superAdminOnly: superAdmin === true && !membership,
  };
});
