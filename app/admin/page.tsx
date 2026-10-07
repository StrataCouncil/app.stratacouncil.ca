import Link from "next/link";
import { AutoRefresh } from "@/components/AutoRefresh";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { AdminCorporationSearch } from "@/components/AdminCorporationSearch";
import { DemoLinksAdmin } from "@/components/DemoLinksAdmin";
import { getDemoVisitors } from "@/lib/data/demo-visitors";
import { getAllCorporations, getPendingCreationRequests } from "@/lib/data/admin";
import { getCurrentProfile } from "@/lib/data/profile";

/**
 * The Super Admin console — platform staff only, gated on the real
 * `profiles.is_super_admin` flag (doc01 §4: a platform flag, not a
 * corporation role). `AppShell`'s nav link uses the same check; this is
 * the server-side backstop for anyone who navigates here directly.
 *
 * Three jobs: personal links to the demo site (lib/demo.ts), the review
 * queue for new corporations (nothing is created until a request here is
 * approved — doc01 §4), and search across every corporation on the
 * platform, regardless of membership.
 */
export default async function AdminConsolePage() {
  const profile = await getCurrentProfile();
  if (!profile?.isSuperAdmin) notFound();

  const [requests, corporations, demoVisitors] = await Promise.all([
    getPendingCreationRequests(),
    getAllCorporations(),
    getDemoVisitors(),
  ]);

  return (
    <AppShell active="admin">
      <AutoRefresh />
      <div className="wrap page">
        <div className="page-header">
          <h1>Super Admin console</h1>
          <p>
            Platform-staff only. Review new corporation requests, and search
            any corporation by Strata Plan number or building name &mdash;
            this list isn&rsquo;t scoped to corporations you&rsquo;re a
            connected member of.
          </p>
        </div>

        <p style={{ marginBottom: "2rem" }}>
          <Link href="/admin/training" className="button button-secondary" data-testid="admin-training-link">
            Council Training
          </Link>{" "}
          <Link href="/admin/legislation" className="button button-secondary" data-testid="admin-legislation-link">
            Legislation Library
          </Link>{" "}
          <Link href="/admin/announcements" className="button button-secondary" data-testid="admin-announcements-link">
            Announcements
          </Link>
        </p>

        <DemoLinksAdmin list={demoVisitors} />

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

// Copying training and the legislation library to the demo can take a while.
export const maxDuration = 300;
