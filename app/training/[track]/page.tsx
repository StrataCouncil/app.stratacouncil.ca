import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { getTrainingTracks } from "@/lib/data/training";

export default async function TrackPage({ params }: { params: Promise<{ track: string }> }) {
  const { track: slug } = await params;
  const track = (await getTrainingTracks()).find((t) => t.slug === slug);
  if (!track) notFound();
  const completed = track.modules.filter((m) => m.completed).length;

  return (
    <AppShell active="training">
      <div className="wrap page">
        <div className="page-header">
          <Link href="/training" className="card__meta" style={{ display: "inline-block", marginBottom: "0.75rem" }}>
            &larr; All tracks
          </Link>
          <h1>{track.title}</h1>
          <p>{track.description}</p>
          <p className="card__meta">
            {completed} of {track.modules.length} modules complete. Take them in any order; finishing every module earns the{" "}
            {track.title} credential.
          </p>
          {track.credential && (
            <p className="sync-note sync-note--ok" role="status">
              {track.title} credential earned {new Date(track.credential.issuedAt).toLocaleDateString("en-CA")}
            </p>
          )}
        </div>

        <div className="module-list">
          {track.modules.map((m, i) => {
            const available = m.publishedVersion > 0;
            return (
              <div className="module-row" key={m.id}>
                <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
                  <span className="module-row__status" data-done={m.completed}>
                    {m.completed ? "✓" : i + 1}
                  </span>
                  <div>
                    <div className="module-row__title">{m.title}</div>
                    <div className="module-row__meta">
                      {m.summary && <>{m.summary} &middot; </>}
                      {m.estimatedMinutes ? `${m.estimatedMinutes} min` : ""}
                      {!available && " · Coming soon"}
                    </div>
                  </div>
                </div>
                {available ? (
                  <Link
                    href={`/training/${track.slug}/${m.id}`}
                    className={`button ${m.completed ? "button-secondary" : "button-primary"} button-small`}
                    data-testid={`module-action-${m.id}`}
                  >
                    {m.completed ? "Review" : m.completedLessons > 0 ? "Continue" : "Start"}
                  </Link>
                ) : (
                  <span className="pill pill--locked">Coming soon</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}
