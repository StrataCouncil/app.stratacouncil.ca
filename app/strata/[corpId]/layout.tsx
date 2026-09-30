import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { StrataSwitcher } from "@/components/StrataSwitcher";
import { currentCorporation } from "@/lib/placeholder-data";

/**
 * Stratasphere™ is desktop-only — the governance tools (roster tables,
 * documents, meeting mode) assume real screen space. Council Training
 * has to work on a phone (people study on their devices); this section
 * doesn't try to. Below ~900px, `.screen-gate-notice` (CSS in
 * globals.css) shows instead of `.screen-gate-content`.
 */
export default function StrataSphereLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const subscribed = currentCorporation.subscriptionStatus === "active";

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
              <span className="pill">{currentCorporation.strataPlanNumber}</span>
              <h1 style={{ marginTop: "0.6rem" }}>
                {currentCorporation.buildingName}
              </h1>
              <p>{currentCorporation.address}</p>
            </div>
            <StrataSwitcher />
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

          {children}
        </div>
      </div>
    </AppShell>
  );
}
