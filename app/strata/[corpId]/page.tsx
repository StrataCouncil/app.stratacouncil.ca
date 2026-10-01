import Link from "next/link";
import { StrataSphereNav } from "@/components/StrataSphereNav";
import { CouncilRoster } from "@/components/CouncilRoster";
import {
  corporationInvites,
  corporationJoinRequests,
  roster,
} from "@/lib/placeholder-data";

/**
 * Council & Roles — free the moment a corporation exists (doc03 Stage 5).
 *
 * The billing link now uses the real `corpId` from the route instead of
 * the hardcoded `currentCorporation.id` mock — that mismatch (a fake ID
 * that never matched any real `strata_corporations`/`subscriptions` row)
 * is what was making "Go to billing" go nowhere.
 *
 * `CouncilRoster` below is deliberately NOT rewired in this pass — it
 * still renders placeholder council members unrelated to this
 * corporation's real roster. That's real, separate work (roster, invites,
 * join requests all need their own pass), not part of this identity/
 * billing fix.
 */
export default async function CouncilAndRolesPage({
  params,
}: {
  params: Promise<{ corpId: string }>;
}) {
  const { corpId } = await params;

  return (
    <>
      <StrataSphereNav active="home" />

      <h2 style={{ marginBottom: "1rem" }}>Council & roles</h2>
      <CouncilRoster
        initialRoster={roster}
        initialInvites={corporationInvites}
        initialJoinRequests={corporationJoinRequests}
      />

      <div className="admin-entry" data-testid="billing-entry">
        <div>
          <span className="pill">Admin</span>
          <h3 style={{ margin: "0.6rem 0 0.25rem" }}>Billing &amp; subscription</h3>
          <p>Manage your Stratasphere&trade; plan, payment method and invoices.</p>
        </div>
        <Link
          href={`/strata/${corpId}/billing`}
          className="button button-secondary"
          data-testid="billing-link"
        >
          Go to billing
        </Link>
      </div>
    </>
  );
}
