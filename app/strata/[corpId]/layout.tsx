import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { StrataContextProvider } from "@/components/StrataContext";
import { StrataSwitcher } from "@/components/StrataSwitcher";
import { ScreenGate } from "@/components/ScreenGate";
import { stripeModeFor } from "@/lib/stripe/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { SubscribeNudge } from "@/components/SubscribeNudge";
import { getConnectedCorporations, type ConnectedCorporation } from "@/lib/data/corporations";
import { createClient } from "@/lib/supabase/server";
import { getStrataAccess } from "@/lib/data/strata";

/**
 * Stratasphere™ is desktop-only — the governance tools (roster tables,
 * documents, meeting mode) assume real screen space — except the
 * Knowledge Library, which works on phones (see `ScreenGate`).
 *
 * Now checks the real `corporation_memberships` table for this corpId
 * instead of always rendering the hardcoded `currentCorporation` mock —
 * this is what was letting every signed-in user land on the same fake
 * "BCS-4821" corporation regardless of whether they'd actually connected
 * to it, and what was breaking the real billing page below it (which
 * expects a `corpId` that actually exists in `strata_corporations`/
 * `subscriptions`). If the signed-in user isn't an active member of this
 * corpId, they're sent to `/strata` rather than shown stale/wrong data.
 */
export default async function StrataSphereLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ corpId: string }>;
}) {
  const { corpId } = await params;
  const [corporations, access] = await Promise.all([getConnectedCorporations(), getStrataAccess(corpId)]);
  let currentCorporation: ConnectedCorporation | undefined = corporations.find((c) => c.id === corpId);

  // Super Admins manage every strata, member or not (0021).
  if (!currentCorporation && access?.superAdminOnly) {
    const { data: corp } = await (await createClient())
      .from("strata_corporations")
      .select("strata_plan_number, building_name, legal_name, address")
      .eq("strata_plan_number", access.corpId)
      .maybeSingle();
    if (corp) {
      currentCorporation = {
        id: corp.strata_plan_number,
        buildingName: corp.building_name,
        legalName: corp.legal_name,
        address: corp.address,
        subscriptionStatus: access.subscribed ? "active" : "deactivated",
      };
    }
  }

  if (!currentCorporation) {
    redirect("/strata");
  }

  const subscribed = currentCorporation.subscriptionStatus === "active";
  // Billing through Stripe test mode (0029): a Sandbox pill beside the
  // plan number, the same one the Super Admin console shows.
  const sandbox = (await stripeModeFor(currentCorporation.id)) === "sandbox";
  // A first payment Stripe is still processing (0030).
  const { data: billing } = await createAdminClient()
    .from("subscriptions")
    .select("stripe_subscription_id, stripe_status")
    .eq("corporation_id", currentCorporation.id)
    .maybeSingle();
  const pending = !subscribed && Boolean(billing?.stripe_subscription_id) && billing?.stripe_status === "incomplete";
  const switcherCorporations = corporations.some((c) => c.id === currentCorporation.id)
    ? corporations
    : [currentCorporation, ...corporations];

  return (
    <AppShell active="strata">
      <div className="wrap page">
        <ScreenGate corpId={currentCorporation.id}>
          <div className="page-header page-header--with-switcher">
            <div>
              <span className="pill">{currentCorporation.id}</span>
              {sandbox && (
                <span className="pill stripe-mode__pill" style={{ marginLeft: "0.4rem" }} data-testid="sandbox-pill">
                  Sandbox
                </span>
              )}
              {pending && (
                <span className="pill billing-tag--pending" style={{ marginLeft: "0.4rem" }} data-testid="pending-pill">
                  Subscription pending
                </span>
              )}
              <h1 style={{ marginTop: "0.6rem" }}>
                {currentCorporation.buildingName ?? currentCorporation.legalName}
              </h1>
              <p>{currentCorporation.address}</p>
            </div>
            <StrataSwitcher corporations={switcherCorporations} currentId={currentCorporation.id} />
          </div>

          {access?.superAdminOnly && (
            <div className="nudge-banner nudge-banner--super" data-testid="super-admin-banner">
              <div>
                <strong>Super Admin</strong>
                <p>
                  You aren&rsquo;t a member of this strata. You have full admin control here, and changes you make are
                  real. Members&rsquo; Stratasphere conversations stay private to them.
                </p>
              </div>
              <Link href="/admin" className="button button-secondary">
                Back to the console
              </Link>
            </div>
          )}

          {!subscribed && !pending && access?.isAdmin && <SubscribeNudge corpId={currentCorporation.id} />}

          <StrataContextProvider
            value={{
              corpId: currentCorporation.id,
              subscribed,
              isAdmin: access?.isAdmin ?? false,
              canManage: Boolean(access?.isAdmin || access?.roles.includes("manager")),
            }}
          >
            {children}
          </StrataContextProvider>
        </ScreenGate>
      </div>
    </AppShell>
  );
}
