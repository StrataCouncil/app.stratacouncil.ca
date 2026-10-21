import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminTabs } from "@/components/AdminTabs";
import { AppShell } from "@/components/AppShell";
import { AutoRefresh } from "@/components/AutoRefresh";
import { InvestorDeckUpload } from "@/components/investors/InvestorDeckUpload";
import { InvestorDeleteButton } from "@/components/investors/InvestorDeleteButton";
import { getCurrentProfile } from "@/lib/data/profile";
import { getInvestorOverview } from "@/lib/data/investors";
import { formatSeconds, formatWhen } from "@/lib/investors/briefing";

/**
 * Super Admin: the investor briefing (0061). The deck investors see, and
 * everyone who has signed up: when they accepted the terms, what they
 * looked at, for how long, and their notes.
 */
export default async function AdminInvestorsPage() {
  const profile = await getCurrentProfile();
  if (!profile?.isSuperAdmin) notFound();
  const { current, investors } = await getInvestorOverview();

  return (
    <AppShell active="admin">
      <AutoRefresh />
      <div className="wrap page">
        <AdminTabs active="investors" />
        <div className="page-header">
          <h1>Investors</h1>
          <p>
            The investor briefing at app.stratacouncil.ca/investors. People sign up there (from the Coming soon page or a
            colleague&rsquo;s Share link), accept the disclaimer, and get a personal link that works for 30 days.
          </p>
        </div>

        <section className="card" style={{ marginBottom: "2rem" }} data-testid="investor-deck">
          <h2>The deck</h2>
          <p className="card__meta" style={{ marginBottom: "1rem" }}>
            {current
              ? `${current.title}: ${current.pageCount} slides, published ${formatWhen(current.publishedAt)}.`
              : "No deck yet. Upload the PDF to publish it."}{" "}
            Uploading a new PDF replaces it for everyone. Notes and viewing times are kept per deck.
          </p>
          <InvestorDeckUpload />
        </section>

        <h2 style={{ marginBottom: "1rem" }}>People</h2>
        {investors.length === 0 ? (
          <p className="roster-notice" data-testid="investors-none">
            No one has signed up yet.
          </p>
        ) : (
          <div className="roster-table-wrap">
            <table className="roster-table investor-admin-table" data-testid="investors-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Signed up</th>
                  <th>Last seen</th>
                  <th>Slides viewed</th>
                  <th>Time</th>
                  <th>Notes</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {investors.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <Link href={`/admin/investors/${i.id}`}>{i.name}</Link>
                      <div className="card__meta">{i.email}</div>
                      {i.referredBy && <div className="card__meta">Shared by {i.referredBy}</div>}
                      {i.revokedAt && <div className="card__meta">Access ended</div>}
                    </td>
                    <td>{formatWhen(i.signedUpAt)}</td>
                    <td>{formatWhen(i.lastSeenAt)}</td>
                    <td>{current ? `${i.slidesViewed} of ${current.pageCount}` : "—"}</td>
                    <td>{formatSeconds(i.seconds)}</td>
                    <td>{i.notes}</td>
                    <td>
                      <InvestorDeleteButton investorId={i.id} name={i.name} small />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
