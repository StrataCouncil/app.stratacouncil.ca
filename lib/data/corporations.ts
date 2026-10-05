import { createClient } from "@/lib/supabase/server";

/**
 * Real replacement for lib/placeholder-data.ts's `currentCorporation` /
 * `connectedCorporations` mocks. Reads the signed-in user's actual
 * `corporation_memberships` rows (status = 'active') joined against
 * `strata_corporations` and `subscriptions`, rather than always returning
 * the same hardcoded corporation regardless of who's signed in.
 *
 * Deliberately narrow — this is the identity/billing pass, not the full
 * roster/invites/join-request rebuild. Three plain queries instead of a
 * clever nested embed, since this data model will keep changing under the
 * next pass anyway.
 */
export interface ConnectedCorporation {
  id: string; // strata_plan_number
  buildingName: string | null;
  legalName: string;
  address: string;
  subscriptionStatus: "active" | "deactivated";
  /** Subscribed, with Stripe still confirming the first payment (0030). */
  pending?: boolean;
}

export async function getConnectedCorporations(): Promise<
  ConnectedCorporation[]
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: memberships } = await supabase
    .from("corporation_memberships")
    .select("corporation_id")
    .eq("user_id", user.id)
    .eq("status", "active");

  const corpIds = (memberships ?? []).map((m) => m.corporation_id);
  if (corpIds.length === 0) return [];

  const [{ data: corps }, { data: subs }] = await Promise.all([
    supabase
      .from("strata_corporations")
      .select("strata_plan_number, building_name, legal_name, address")
      .in("strata_plan_number", corpIds),
    supabase
      .from("subscriptions")
      .select("corporation_id, status, stripe_subscription_id, stripe_status")
      .in("corporation_id", corpIds),
  ]);

  const statusByCorp = new Map(
    (subs ?? []).map((s) => [s.corporation_id, s.status])
  );
  const pendingCorps = new Set(
    (subs ?? [])
      .filter((s) => s.status !== "active" && s.stripe_subscription_id && s.stripe_status === "incomplete")
      .map((s) => s.corporation_id)
  );

  return (corps ?? []).map((c) => ({
    id: c.strata_plan_number,
    buildingName: c.building_name,
    legalName: c.legal_name,
    address: c.address,
    subscriptionStatus:
      statusByCorp.get(c.strata_plan_number) === "active"
        ? "active"
        : "deactivated",
    pending: pendingCorps.has(c.strata_plan_number),
  }));
}
