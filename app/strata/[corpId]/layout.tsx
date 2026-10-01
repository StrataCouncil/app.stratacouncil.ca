import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { StrataContextProvider } from "@/components/StrataContext";
import { StrataSwitcher } from "@/components/StrataSwitcher";
import { getConnectedCorporations } from "@/lib/data/corporations";
import { getStrataAccess } from "@/lib/data/strata";

/**
 * Stratasphere™ is desktop-only — the governance tools (roster tables,
 * documents, meeting mode) assume real screen space. Council Training
 * has to work on a phone (people study on their devices); this section
 * doesn't try to. Below ~900px, `.screen-gate-notice` (CSS in
 * globals.css) shows instead of `.screen-gate-content`.
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
  const corporations = await getConnectedCorporations();
  const currentCorporation = corporations.find((c) => c.id === corpId);

  if (!currentCorporation) {
    redirect("/strata");
  }

  const subscribed = currentCorporation.subscriptionStatus === "active";
  const access = await getStrataAccess(corpId);

  return (
    <AppShell active="strata">
      <div className="wrap page">
        <div className="screen-gate-notice">
          <span className="pill pill--locked">Desktop required</span>
          <h2>Stratasphere&trade; is best experienced on a larger screen</h2>
          <p>
            Roster, documents, meeting mode and the rest of your strata&rsquo;s
            governance tools need more room than a phone screen gives.
            Please switch to a desktop or laptop to continue &mdash; Council
            Training stays fully available on any device.
          </p>
          <Link href="/training" className="button button-secondary">
            Go to Council Training
          </Link>
        </div>

        <div className="screen-gate-content">
          <div className="page-header page-header--with-switcher">
            <div>
              <span className="pill">{currentCorporation.id}</span>
              <h1 style={{ marginTop: "0.6rem" }}>
                {currentCorporation.buildingName ?? currentCorporation.legalName}
              </h1>
              <p>{currentCorporation.address}</p>
            </div>
            <StrataSwitcher corporations={corporations} currentId={currentCorporation.id} />
          </div>

          {!subscribed && (
            <div className="nudge-banner">
              <div>
                <strong>Stratasphere&trade; isn&rsquo;t subscribed yet</strong>
                <p>
                  Roles, roster, guides, and documents are free. The full
                  Stratasphere&trade; assistant unlocks with a subscription
                  &mdash; and every strata gets one full free meeting before
                  paying anything.
                </p>
              </div>
              <Link
                href={`/strata/${currentCorporation.id}/billing`}
                className="button button-primary"
                data-testid="subscribe-cta"
              >
                Subscribe to Stratasphere&trade;
              </Link>
            </div>
          )}

          <StrataContextProvider
            value={{ corpId: currentCorporation.id, subscribed, isAdmin: access?.isAdmin ?? false }}
          >
            {children}
          </StrataContextProvider>
        </div>
      </div>
    </AppShell>
  );
}
