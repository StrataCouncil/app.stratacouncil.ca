import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { getTrainingTracks } from "@/lib/data/training";

/**
 * Council Training (doc03 Stage 3). Five flat tracks, no unlock sequence
 * between them. Belongs to the user, not any corporation. Progress and
 * credentials are real (0033); modules not yet published show as coming.
 */
export default async function CouncilTrainingPage() {
  const tracks = await getTrainingTracks();
  return (
    <AppShell active="training">
      <div className="wrap page">
        <div className="page-header">
          <h1>Council Training</h1>
          <p>
            Work through any track, in any order. Your progress and credentials are yours &mdash; they stay with your account
            even if your role on council changes.
          </p>
        </div>

        <div className="grid-cards">
          {tracks.map((track) => {
            const available = track.modules.filter((m) => m.publishedVersion > 0);
            const completed = available.filter((m) => m.completed).length;
            const pct = available.length ? Math.round((completed / track.modules.length) * 100) : 0;
            return (
              <Link key={track.id} href={`/training/${track.slug}`} className="card" data-testid={`track-card-${track.slug}`}>
                <h3>{track.title}</h3>
                <p>
                  {available.length === 0
                    ? `${track.modules.length} modules, coming soon`
                    : `${completed} of ${track.modules.length} modules complete`}
                </p>
                <div className="progress-track">
                  <div className="progress-track__fill" style={{ width: `${pct}%` }} />
                </div>
                <span className="card__meta">
                  {track.credential
                    ? "Credential earned"
                    : available.length === 0
                      ? "Coming soon"
                      : completed === 0
                        ? "Not started"
                        : "In progress"}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}
