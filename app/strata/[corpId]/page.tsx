import Link from "next/link";
import { StrataSphereNav } from "@/components/StrataSphereNav";
import { CouncilRoster } from "@/components/CouncilRoster";
import { getCorporationRoster } from "@/lib/data/roster";

/**
 * Council & Roles — free the moment a corporation exists (doc03 Stage 5).
 * Real roster, invites, join requests, roles and meeting permissions from
 * `getCorporationRoster()`; the layout above has already confirmed the
 * signed-in user is an active member of `corpId`.
 */
export default async function CouncilAndRolesPage({
  params,
}: {
  params: Promise<{ corpId: string }>;
}) {
  const { corpId } = await params;
  const roster = await getCorporationRoster(corpId);

  return (
    <>
      <StrataSphereNav active="home" />

      <h2 style={{ marginBottom: "1rem" }}>Council & roles</h2>
      {roster ? (
        <CouncilRoster corporationId={corpId} roster={roster} />
      ) : (
        <p className="roster-notice">Couldn&rsquo;t load the roster. Try refreshing the page.</p>
      )}

      {roster?.isAdmin && (
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
      )}
    </>
  );
}
