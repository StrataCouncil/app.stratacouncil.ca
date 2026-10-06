import Link from "next/link";
import { moduleStatuses, type TrainingTrack } from "@/lib/data/training";
import { lockedBehind } from "@/lib/training/progress";

/**
 * A track as a learning path: its modules in order, each done, open,
 * locked (finish the one before it first) or coming soon, ending in the
 * track's completion. The whole track waits on the one before it (0035).
 * Shared by Council Training and demo links.
 */
export function TrackPath({
  track,
  tracks,
  hrefBase = "/training",
  demo = false,
}: {
  track: TrainingTrack;
  tracks: TrainingTrack[];
  /** Where links point ("/training", or a demo link's "/demo/<token>"). */
  hrefBase?: string;
  /** A demo link (0040): every module is open and nothing is saved. */
  demo?: boolean;
}) {
  const blocker = demo ? null : lockedBehind(track, tracks);
  const statuses = moduleStatuses(track);
  if (blocker) for (const m of track.modules) if (m.publishedVersion > 0) statuses.set(m.id, "locked");
  if (demo) for (const m of track.modules) if (m.publishedVersion > 0) statuses.set(m.id, "open");
  const published = track.modules.filter((m) => m.publishedVersion > 0);
  const completed = published.filter((m) => m.completed).length;
  const minutes = published.reduce((sum, m) => sum + (m.completed ? 0 : (m.estimatedMinutes ?? 0)), 0);

  return (
    <div className="wrap page">
      <div className="page-header">
        <Link href={hrefBase} className="card__meta" style={{ display: "inline-block", marginBottom: "0.75rem" }}>
          &larr; Council Training
        </Link>
        <h1>{track.title}</h1>
        <p>{track.description}</p>
        <p className="card__meta">
          {track.modules.length === 0
            ? "Modules for this track are on the way."
            : demo
              ? `${track.modules.length} modules. In this preview every module is open; learners take them in order.`
              : `${completed} of ${track.modules.length} modules complete${minutes ? ` · about ${minutes} minutes to go` : ""}. Modules open in order.`}
        </p>
        {blocker && (
          <p className="form-alert" data-testid="track-locked">
            This track opens once you&rsquo;ve finished <Link href={`${hrefBase}/${blocker.slug}`}>{blocker.title}</Link>.
          </p>
        )}
      </div>

      <ol className="path" data-testid="training-path">
        {track.modules.map((m, i) => {
          const status = statuses.get(m.id) ?? "soon";
          const action = status === "done" ? "Review" : m.completedSections > 0 ? "Continue" : "Start";
          return (
            <li key={m.id} className="path__step" data-status={status}>
              <span className="path__node" aria-hidden="true">
                {status === "done" ? <Tick /> : status === "locked" ? <Lock /> : i + 1}
              </span>
              <div className="path__card">
                <div>
                  <div className="path__title">{m.title}</div>
                  <div className="path__meta">
                    {status === "done" && "Complete"}
                    {status === "open" && (m.completedSections > 0 ? "In progress" : "Up next")}
                    {status === "locked" &&
                      (blocker ? `Finish ${blocker.title} first` : "Finish the module before this one first")}
                    {status === "soon" && "Coming soon"}
                    {m.estimatedMinutes ? ` · ${m.estimatedMinutes} min` : ""}
                  </div>
                  {m.summary && <p className="path__summary">{m.summary}</p>}
                </div>
                {(status === "open" || status === "done") && (
                  <Link
                    href={`${hrefBase}/${track.slug}/${m.id}`}
                    className={`button ${status === "done" ? "button-secondary" : "button-primary"} button-small`}
                    data-testid={`module-action-${m.id}`}
                  >
                    {action}
                  </Link>
                )}
              </div>
            </li>
          );
        })}
        <li className="path__step path__step--credential" data-status={track.credential ? "done" : "goal"}>
          <span className="path__node" aria-hidden="true">
            <Award />
          </span>
          <div className="path__card">
            <div>
              <div className="path__title">{track.title} complete</div>
              <div className="path__meta">
                {track.credential
                  ? `Completed ${new Date(track.credential.issuedAt).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" })}. Your council sees a filled circle on Council & Roles.`
                  : "When every module above is done, your circle fills in here and on Council & Roles."}
              </div>
            </div>
          </div>
        </li>
      </ol>
    </div>
  );
}

const icon = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2.2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};
function Tick() {
  return (
    <svg {...icon}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}
function Lock() {
  return (
    <svg {...icon}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}
function Award() {
  return (
    <svg {...icon} width={18} height={18}>
      <circle cx="12" cy="9" r="6" />
      <path d="M8.5 14 7 22l5-3 5 3-1.5-8" />
    </svg>
  );
}
