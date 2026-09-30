import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { tracks } from "@/lib/placeholder-data";

/**
 * Council Training (doc03 Stage 3). Five flat tracks, no unlock sequence
 * between them. Unswitched — belongs to the user, not any corporation.
 */
export default function CouncilTrainingPage() {
  return (
    <AppShell active="training">
      <div className="wrap page">
        <div className="page-header">
          <h1>Council Training</h1>
          <p>
            Work through any track, in any order. Your progress and
            certificates are yours &mdash; they stay with your account even
            if your role on council changes.
          </p>
        </div>

        <div className="grid-cards">
          {tracks.map((track) => {
            const pct = Math.round(
              (track.completedModules / track.moduleCount) * 100
            );
            return (
              <Link
                key={track.slug}
                href={`/training/${track.slug}`}
                className="card"
                data-testid={`track-card-${track.slug}`}
              >
                <h3>{track.title}</h3>
                <p>
                  {track.completedModules} of {track.moduleCount} modules
                  complete
                </p>
                <div className="progress-track">
                  <div
                    className="progress-track__fill"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="card__meta">
                  {track.certificateIssued
                    ? "Certificate issued"
                    : pct === 0
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
