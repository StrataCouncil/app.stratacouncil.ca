import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminCorporationSearch } from "@/components/AdminCorporationSearch";
import { AdminTabs } from "@/components/AdminTabs";
import { AppShell } from "@/components/AppShell";
import { AutoRefresh } from "@/components/AutoRefresh";
import { getAllCorporations, getPendingCreationRequests } from "@/lib/data/admin";
import { getCurrentProfile } from "@/lib/data/profile";

/**
 * Super Admin: every strata on the platform. The review queue for new
 * corporations (nothing is created until a request here is approved,
 * doc01 §4), and search across every corporation regardless of
 * membership.
 */
export default async function AdminStratasPage() {
  const profile = await getCurrentProfile();
  if (!profile?.isSuperAdmin) notFound();

  const [requests, corporations] = await Promise.all([getPendingCreationRequests(), getAllCorporations()]);

  return (
    <AppShell active="admin">
      <AutoRefresh />
      <div className="wrap page">
        <AdminTabs active="stratas" />
        <div className="page-header">
          <h1>Stratas</h1>
          <p>
            Review new corporation requests, and search any corporation by Strata Plan number or building name &mdash;
            this list isn&rsquo;t scoped to corporations you&rsquo;re a connected member of.
          </p>
        </div>

        <h2 style={{ marginBottom: "1rem" }}>New corporation requests</h2>
        {requests.length === 0 ? (
          <p className="roster-notice" data-testid="admin-no-requests">
            Nothing waiting for review.
          </p>
        ) : (
          <div className="roster-table-wrap" style={{ marginBottom: "2.5rem" }}>
            <table className="roster-table" data-testid="admin-request-table">
              <thead>
                <tr>
                  <th>Strata Plan</th>
                  <th>Legal name</th>
                  <th>Requested by</th>
                  <th>Requested</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/admin/requests/${r.id}`} data-testid={`admin-request-row-${r.id}`}>
                        {r.strataPlanNumber}
                      </Link>
                    </td>
                    <td>{r.legalName}</td>
                    <td>
                      {r.requesterName}
                      <div className="roster-table__meta">{r.requesterEmail}</div>
                    </td>
                    <td>{new Date(r.requestedAt).toLocaleDateString("en-CA")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <h2 style={{ marginBottom: "1rem" }}>Corporations</h2>
        <AdminCorporationSearch corporations={corporations} />
      </div>
    </AppShell>
  );
}
