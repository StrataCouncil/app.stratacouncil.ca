import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { allCorporations, currentCorporation, currentProfile, roleLabels, roster } from "@/lib/placeholder-data";

const subscriptionLabels: Record<string, string> = {
  active: "Stratasphere™ active",
  none: "Free tier, never subscribed",
  deactivated: "Deactivated",
};

/**
 * Read-only corp detail view inside the Super Admin console — privileged
 * data access, not impersonation. This profile never appears in the
 * corp's own roster or membership list just by viewing this page, and
 * nothing here is editable; a Super Admin who needs to actually change
 * something (unit count, a StrataSphere reactivation) does that through
 * the specific reviewed action it is, not a general edit mode bolted
 * onto this page (doc01 §1).
 *
 * Only `currentCorporation` has the full roster this mockup builds out
 * elsewhere — the other seeded corporations intentionally don't get a
 * fabricated one; this page says so plainly rather than showing an empty
 * table that looks like a real "no members yet" state.
 */
export default async function AdminCorporationDetailPage({
  params,
}: {
  params: Promise<{ corpId: string }>;
}) {
  if (!currentProfile.isSuperAdmin) notFound();

  const { corpId } = await params;
  const corporation = allCorporations.find((c) => c.id === corpId);
  if (!corporation) notFound();

  const hasMockedDetail = corporation.id === currentCorporation.id;

  return (
    <AppShell active="admin">
      <div className="wrap page">
        <Link href="/admin" className="kb-article__back">
          &larr; Admin console
        </Link>

        <div className="page-header">
          <span className="pill pill--locked">{corporation.strataPlanNumber}</span>
          <h1 style={{ marginTop: "0.6rem" }}>{corporation.buildingName}</h1>
          <p>{corporation.address}</p>
        </div>

        <div className="grid-cards" style={{ marginBottom: "2.5rem" }}>
          <div className="card">
            <h3>Corporation</h3>
            <p>{corporation.legalName}</p>
            <p style={{ marginTop: "-0.5rem" }}>
              Jurisdiction: {corporation.jurisdiction} &middot; {corporation.unitCount} units
            </p>
          </div>
          <div className="card">
            <h3>Subscription</h3>
            <p>{subscriptionLabels[corporation.subscriptionStatus]}</p>
            <p style={{ marginTop: "-0.5rem" }}>
              Free meeting {corporation.freeMeetingUsed ? "used" : "not yet used"}
            </p>
          </div>
          {hasMockedDetail && (
            <div className="card">
              <h3>Roster</h3>
              <p>{roster.length} connected members</p>
              <Link
                href={`/strata/${corporation.id}`}
                className="button button-secondary button-small"
                style={{ alignSelf: "flex-start" }}
                data-testid="admin-open-stratasphere"
              >
                Open in Stratasphere&trade;
              </Link>
            </div>
          )}
        </div>

        {hasMockedDetail ? (
          <>
            <h2 style={{ marginBottom: "1rem" }}>Roster</h2>
            <div className="roster-table-wrap">
              <table className="roster-table" data-testid="admin-roster-table">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Roles</th>
                  </tr>
                </thead>
                <tbody>
                  {roster.map((member) => (
                    <tr key={member.id}>
                      <td>
                        {member.name}
                        {member.company && (
                          <div className="roster-table__meta">{member.company}</div>
                        )}
                      </td>
                      <td>
                        {member.roles.length === 0
                          ? <span className="roster-table__na">&mdash;</span>
                          : member.roles.map((role) => (
                              <span className="role-tag" key={role}>
                                {roleLabels[role] ?? role}
                              </span>
                            ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="lock-panel" data-testid="admin-no-mock-data">
            <h2>No detailed data mocked for this corporation</h2>
            <p>
              This demo only builds out full roster, documents and
              governance data for Maple Ridge Terraces (BCS-4821). This
              corporation exists here to show what the console&rsquo;s
              search and list look like with more than one result &mdash;
              in the real app, its roster, documents and subscription
              history would render the same way.
            </p>
          </div>
        )}
      </div>
    </AppShell>
  );
}
