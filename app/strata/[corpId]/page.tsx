import Link from "next/link";
import { StrataSphereNav } from "@/components/StrataSphereNav";
import { CouncilRoster } from "@/components/CouncilRoster";
import {
  corporationInvites,
  corporationJoinRequests,
  currentCorporation,
  roster,
} from "@/lib/placeholder-data";

/**
 * Council & Roles — free the moment a corporation exists (doc03 Stage 5).
 * The completion matrix shows only done/not-done per track, never
 * granular progress (doc01 §3a) — that's a deliberate design choice, not
 * a placeholder simplification. Role assignment itself is editable here
 * (`RosterTable`) — admin needs to be able to determine each connected
 * member's role, the same reassignable-by-admin pattern doc01 §4b
 * describes for the `admin` role itself.
 *
 * Requests to join, invites, and the roster table (`CouncilRoster`) sit
 * above one another in that order — the two connection paths (self-serve
 * request vs. admin-sent invite) right next to the roster they're about
 * to change, not buried in a settings page. Council turnover ("the new
 * treasurer needs to be added") is a routine admin action, not a rare
 * one, so it gets the same visibility as the roster itself.
 */
export default function CouncilAndRolesPage() {
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
          href={`/strata/${currentCorporation.id}/billing`}
          className="button button-secondary"
          data-testid="billing-link"
        >
          Go to billing
        </Link>
      </div>
    </>
  );
}
