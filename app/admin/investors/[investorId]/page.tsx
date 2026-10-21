import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminTabs } from "@/components/AdminTabs";
import { AppShell } from "@/components/AppShell";
import { InvestorAccessButton } from "@/components/investors/InvestorAccessButton";
import { getCurrentProfile } from "@/lib/data/profile";
import { getInvestorDetail } from "@/lib/data/investors";
import { INVESTOR_DECK_BUCKET, formatSeconds, formatWhen } from "@/lib/investors/briefing";
import { slidePath } from "@/lib/investors/session";
import { createAdminClient } from "@/lib/supabase/admin";

/** Super Admin: one investor's acceptance record, time on each slide, and notes (0061). */
export default async function AdminInvestorPage({ params }: { params: Promise<{ investorId: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile?.isSuperAdmin) notFound();
  const { investorId } = await params;
  const detail = await getInvestorDetail(investorId);
  if (!detail) notFound();
  const { investor, slides } = detail;

  const current = slides.filter((s) => s.current);
  const earlier = slides.filter((s) => !s.current && (s.note || s.seconds > 0));
  const { data: thumbs } = current.length
    ? await createAdminClient()
        .storage.from(INVESTOR_DECK_BUCKET)
        .createSignedUrls(current.map((s) => slidePath(s.deckId, s.page)), 3600)
    : { data: [] };

  return (
    <AppShell active="admin">
      <div className="wrap page">
        <AdminTabs active="investors" />
        <Link href="/admin/investors" className="card__meta" style={{ display: "inline-block", marginBottom: "0.75rem" }}>
          &larr; All investors
        </Link>
        <div className="page-header">
          <h1>{investor.name}</h1>
          <p>
            <a href={`mailto:${investor.email}`}>{investor.email}</a>
            {investor.referredBy && <> &middot; shared by {investor.referredBy}</>}
          </p>
        </div>

        <section className="card" style={{ marginBottom: "2rem" }}>
          <dl className="overview-details">
            <div>
              <dt>Signed up</dt>
              <dd>{formatWhen(investor.signedUpAt)}</dd>
            </div>
            <div>
              <dt>Accepted the disclaimer</dt>
              <dd>
                {formatWhen(investor.acceptedAt)} (version {investor.disclaimerVersion})
              </dd>
            </div>
            <div>
              <dt>Confirmed accredited investor</dt>
              <dd>{formatWhen(investor.accreditedAt)}</dd>
            </div>
            <div>
              <dt>Links sent</dt>
              <dd>
                {detail.linksSent}
                {detail.firstOpenedAt && `, first opened ${formatWhen(detail.firstOpenedAt)}`}
              </dd>
            </div>
            <div>
              <dt>Last seen</dt>
              <dd>{formatWhen(investor.lastSeenAt)}</dd>
            </div>
            <div>
              <dt>Time on the current deck</dt>
              <dd>
                {formatSeconds(investor.seconds)} across {investor.slidesViewed} slides
              </dd>
            </div>
          </dl>
          <div style={{ marginTop: "1rem" }}>
            {investor.revokedAt && <p className="card__meta">Access ended {formatWhen(investor.revokedAt)}.</p>}
            <InvestorAccessButton investorId={investor.id} revoked={Boolean(investor.revokedAt)} />
          </div>
        </section>

        <h2 style={{ marginBottom: "1rem" }}>Slide by slide</h2>
        {current.length === 0 ? (
          <p className="roster-notice">No deck is published yet.</p>
        ) : (
          <div className="roster-table-wrap" style={{ marginBottom: "2rem" }}>
            <table className="roster-table investor-admin-table" data-testid="investor-slides">
              <thead>
                <tr>
                  <th>Slide</th>
                  <th>Time</th>
                  <th>Last viewed</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {current.map((s, i) => (
                  <tr key={s.page}>
                    <td>
                      {thumbs?.[i]?.signedUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img className="investor-admin-thumb" src={thumbs[i].signedUrl!} alt={`Slide ${s.page}`} />
                      )}
                      <div className="card__meta">Slide {s.page}</div>
                    </td>
                    <td>{s.seconds > 0 ? formatSeconds(s.seconds) : "Not viewed"}</td>
                    <td>{formatWhen(s.lastViewedAt)}</td>
                    <td>{s.note ? <p className="investor-admin-note">{s.note}</p> : <span className="card__meta">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {earlier.length > 0 && (
          <>
            <h2 style={{ marginBottom: "1rem" }}>On earlier decks</h2>
            <div className="roster-table-wrap">
              <table className="roster-table investor-admin-table">
                <thead>
                  <tr>
                    <th>Deck</th>
                    <th>Slide</th>
                    <th>Time</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {earlier.map((s) => (
                    <tr key={`${s.deckId}:${s.page}`}>
                      <td>{s.deckTitle}</td>
                      <td>{s.page}</td>
                      <td>{formatSeconds(s.seconds)}</td>
                      <td>{s.note ? <p className="investor-admin-note">{s.note}</p> : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
