import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { modulesByTrack, tracks } from "@/lib/placeholder-data";

export function generateStaticParams() {
  return tracks.map((t) => ({ track: t.slug }));
}

export default async function TrackPage({
  params,
}: {
  params: Promise<{ track: string }>;
}) {
  const { track: slug } = await params;
  const track = tracks.find((t) => t.slug === slug);
  const modules = modulesByTrack[slug];
  if (!track || !modules) notFound();

  return (
    <AppShell active="training">
      <div className="wrap page">
        <div className="page-header">
          <Link
            href="/training"
            className="card__meta"
            style={{ display: "inline-block", marginBottom: "0.75rem" }}
          >
            &larr; All tracks
          </Link>
          <h1>{track.title}</h1>
          <p>
            {track.completedModules} of {track.moduleCount} modules complete.
            Modules proceed in order &mdash; each one unlocks once the
            previous is done.
          </p>
        </div>

        <div className="module-list">
          {modules.map((module, i) => {
            const done = i < track.completedModules;
            const isNext = i === track.completedModules;
            return (
              <div className="module-row" key={module.id}>
                <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
                  <span className="module-row__status" data-done={done}>
                    {done ? "✓" : i + 1}
                  </span>
                  <div>
                    <div className="module-row__title">{module.title}</div>
                    <div className="module-row__meta">
                      {module.estimatedMinutes} min
                    </div>
                  </div>
                </div>
                <button
                  className="button button-secondary button-small"
                  disabled={!done && !isNext}
                  data-testid={`module-action-${module.id}`}
                >
                  {done ? "Review" : isNext ? "Start" : "Locked"}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}
