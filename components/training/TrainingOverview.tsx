import Link from "next/link";
import { PhotoCreditLine } from "@/components/training/PhotoPicker";
import type { TrainingTrack } from "@/lib/data/training";
import type { ModuleCover } from "@/lib/training/slides";
import { formatMinutes, lockedBehind, minutesLeft, nextModule, trackStatus, type TrackStatus } from "@/lib/training/progress";

/**
 * Council Training overview (0035). The core (Strata Basics, then Council
 * Ready) and the specialty tracks (Treasurer, Secretary, after Council
 * Ready), with the next module up front and the learner's progress beside
 * it. Completion shows as the filled circles on Council & Roles.
 */
/** The overview itself, from the learner's tracks (also used by previews). */
export function TrainingOverview({
  tracks,
  news,
  hrefBase = "/training",
  demo = false,
}: {
  tracks: TrainingTrack[];
  news?: React.ReactNode;
  /** Where track and module links point ("/training", or a demo link's "/demo/<token>"). */
  hrefBase?: string;
  /** A demo link (0040): nothing is saved, so there's no progress to show. */
  demo?: boolean;
}) {
  const core = tracks.filter((t) => t.stage === "core");
  const specialty = tracks.filter((t) => t.stage === "specialty");
  const next = nextModule(tracks);
  const allModules = tracks.flatMap((t) => t.modules.filter((m) => m.publishedVersion > 0));
  const doneModules = allModules.filter((m) => m.completed).length;
  const upNext = upcoming(tracks, next?.module.id ?? null);
  const coreLeft = minutesLeft(core);

  return (
    <div className="wrap page">
      <div className="page-header">
        <h1>Council Training</h1>
        <p>
          Short, practical modules on what makes an effective council member. Start with the core, then add your office&rsquo;s
          track. Your progress stays with your account, even if your role on council changes.
        </p>
      </div>

      {news}

      <div className="training-overview">
        <div className="training-overview__main">
          <NextUp tracks={tracks} next={next} hrefBase={hrefBase} />

          <TrackGroup
            title="The core"
            note={`For every council member${coreLeft ? `, ${formatMinutes(coreLeft)} to go` : ""}. Take them in order.`}
            tracks={core}
            all={tracks}
            numbered
            hrefBase={hrefBase}
          />
          <TrackGroup
            title="Specialty tracks"
            note="For treasurers and secretaries, once you're Council Ready. Each is under an hour."
            tracks={specialty}
            all={tracks}
            hrefBase={hrefBase}
          />
        </div>

        <aside className="training-overview__side" aria-label="Your training">
          {demo ? (
            <section className="training-panel">
              <h2>About this preview</h2>
              <p className="training-panel__note">
                You&rsquo;re seeing Council Training as a learner would. Every module is open, and nothing you do is saved.
                Use &ldquo;Comment on this screen&rdquo; under any screen to tell us what you think.
              </p>
            </section>
          ) : (
          <section className="training-panel">
            <h2>Your progress</h2>
            <ul className="training-progress">
              {tracks.map((t) => {
                const published = t.modules.filter((m) => m.publishedVersion > 0);
                const done = published.filter((m) => m.completed).length;
                return (
                  <li key={t.id}>
                    <span
                      className="training-dot"
                      data-earned={Boolean(t.credential)}
                      role="img"
                      aria-label={t.credential ? "Complete" : "Not complete"}
                    />
                    <span className="training-progress__name">{t.title}</span>
                    <span className="training-progress__count">
                      {t.credential ? "Complete" : published.length ? `${done}/${t.modules.length}` : "Soon"}
                    </span>
                  </li>
                );
              })}
            </ul>
            <dl className="training-stats">
              <div>
                <dt>Modules done</dt>
                <dd>
                  {doneModules}
                  <span> of {allModules.length}</span>
                </dd>
              </div>
              <div>
                <dt>Time to go</dt>
                <dd>{minutesLeft(tracks) ? formatMinutes(minutesLeft(tracks)).replace("about ", "") : "None"}</dd>
              </div>
            </dl>
            <p className="training-panel__note">
              A filled circle means the track is complete. Your council sees the same circles on Council &amp; Roles.
            </p>
          </section>
          )}

          {upNext.length > 0 && (
            <section className="training-panel">
              <h2>After that</h2>
              <ol className="training-upnext">
                {upNext.map(({ track, module }) => (
                  <li key={module.id}>
                    <Cover cover={module.cover} className="training-upnext__thumb" small />
                    <div>
                      <div className="training-upnext__title">{module.title}</div>
                      <div className="training-upnext__meta">
                        {track.title}
                        {module.estimatedMinutes ? ` · ${module.estimatedMinutes} min` : ""}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}

          <section className="training-panel training-panel--plain">
            <h2>How it works</h2>
            <ul className="training-how">
              <li>Modules take 10 to 15 minutes, one screen at a time, with narration.</li>
              <li>Your progress saves after each section, so you can stop any time.</li>
              <li>There&rsquo;s no pass or fail. Finish every module in a track to complete it.</li>
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}

function NextUp({ tracks, next, hrefBase }: { tracks: TrainingTrack[]; next: ReturnType<typeof nextModule<TrainingTrack>>; hrefBase: string }) {
  if (!next) {
    const anyPublished = tracks.some((t) => t.modules.some((m) => m.publishedVersion > 0));
    const allDone = anyPublished && tracks.every((t) => t.modules.every((m) => m.publishedVersion === 0 || m.completed));
    return (
      <section className="training-next training-next--empty" data-testid="training-next">
        <div className="training-next__body">
          <span className="training-next__eyebrow">{allDone ? "All caught up" : "Coming soon"}</span>
          <h2>{allDone ? "You've finished every module available" : "Modules are on the way"}</h2>
          <p>
            {allDone
              ? "New modules appear here as they're published. Anything you've completed stays complete."
              : "The first modules are being written now. They'll appear here as soon as they're published."}
          </p>
        </div>
      </section>
    );
  }
  const { track, module, position } = next;
  const resuming = module.completedSections > 0;
  return (
    <section className="training-next" data-testid="training-next">
      <div className="training-next__body">
        <span className="training-next__eyebrow">{resuming ? "Continue where you left off" : "Up next"}</span>
        <h2>{module.title}</h2>
        <p className="training-next__meta">
          {track.title} · Module {position} of {track.modules.length}
          {module.estimatedMinutes ? ` · ${module.estimatedMinutes} min` : ""}
        </p>
        {module.summary && <p className="training-next__summary">{module.summary}</p>}
        <div className="training-next__actions">
          <Link href={`${hrefBase}/${track.slug}/${module.id}`} className="button button-primary" data-testid="training-next-start">
            {resuming ? "Continue" : "Start module"}
          </Link>
          <Link href={`${hrefBase}/${track.slug}`} className="button button-secondary">
            See {track.title}
          </Link>
        </div>
      </div>
      <Cover cover={module.cover ?? trackCover(track)} className="training-next__media" credit />
    </section>
  );
}

function TrackGroup({
  title,
  note,
  tracks,
  all,
  numbered,
  hrefBase,
}: {
  title: string;
  note: string;
  tracks: TrainingTrack[];
  all: TrainingTrack[];
  numbered?: boolean;
  hrefBase: string;
}) {
  if (tracks.length === 0) return null;
  return (
    <section className="training-group">
      <div className="training-group__head">
        <h2>{title}</h2>
        <p>{note}</p>
      </div>
      <div className="training-tracks">
        {tracks.map((t, i) => (
          <TrackCard key={t.id} track={t} all={all} step={numbered ? i + 1 : null} hrefBase={hrefBase} />
        ))}
      </div>
    </section>
  );
}

const statusPill: Record<TrackStatus, { label: string; tone: string }> = {
  complete: { label: "Complete", tone: "done" },
  in_progress: { label: "In progress", tone: "active" },
  not_started: { label: "Not started", tone: "idle" },
  locked: { label: "Locked", tone: "locked" },
  soon: { label: "Coming soon", tone: "locked" },
};

function TrackCard({ track, all, step, hrefBase }: { track: TrainingTrack; all: TrainingTrack[]; step: number | null; hrefBase: string }) {
  const status = trackStatus(track, all);
  const blocker = lockedBehind(track, all);
  const published = track.modules.filter((m) => m.publishedVersion > 0);
  const done = published.filter((m) => m.completed).length;
  const pct = track.modules.length ? Math.round((done / track.modules.length) * 100) : 0;
  const minutes = track.modules.reduce((sum, m) => sum + (m.estimatedMinutes ?? 0), 0);
  const pill = statusPill[status];

  const body = (
    <>
      <Cover cover={trackCover(track)} className="track-card__media" />
      <div className="track-card__body">
        <div className="track-card__top">
          {step !== null && <span className="track-card__step">Level {step}</span>}
          <span className={`pill track-card__pill`} data-tone={pill.tone}>
            {status === "locked" && <Padlock />}
            {pill.label}
          </span>
        </div>
        <h3>{track.title}</h3>
        <p>{track.description}</p>
        <div className="track-card__foot">
          <span className="track-card__meta">
            {track.modules.length === 0
              ? "Modules on the way"
              : `${track.modules.length} module${track.modules.length === 1 ? "" : "s"}${minutes ? ` · ${formatMinutes(minutes)}` : ""}`}
          </span>
          {status === "locked" && blocker ? (
            <span className="track-card__meta">Finish {blocker.title} first</span>
          ) : (
            published.length > 0 && (
              <span className="track-card__meta">
                {done} of {track.modules.length} done
              </span>
            )
          )}
        </div>
        {status !== "locked" && published.length > 0 && (
          <div className="progress-track" aria-hidden="true">
            <div className="progress-track__fill" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
    </>
  );

  if (status === "locked") {
    return (
      <div className="track-card" data-status={status} data-testid={`track-card-${track.slug}`}>
        {body}
      </div>
    );
  }
  return (
    <Link href={`${hrefBase}/${track.slug}`} className="track-card" data-status={status} data-testid={`track-card-${track.slug}`}>
      {body}
    </Link>
  );
}

/** A track's card photo: its first module with one. */
function trackCover(track: TrainingTrack): ModuleCover | null {
  return [...track.modules].sort((a, b) => a.orderIndex - b.orderIndex).find((m) => m.cover)?.cover ?? null;
}

/** The modules after the one up next, in the order a learner meets them (open tracks only). */
function upcoming(tracks: TrainingTrack[], skipId: string | null) {
  const out: {
    track: TrainingTrack;
    module: TrainingTrack["modules"][number];
  }[] = [];
  for (const track of tracks) {
    if (lockedBehind(track, tracks)) continue;
    for (const m of [...track.modules].sort((a, b) => a.orderIndex - b.orderIndex)) {
      if (m.publishedVersion > 0 && !m.completed && m.id !== skipId) out.push({ track, module: m });
    }
  }
  return out.slice(0, 3);
}

function Cover({
  cover,
  className,
  credit,
  small,
}: {
  cover: ModuleCover | null;
  className: string;
  credit?: boolean;
  small?: boolean;
}) {
  return (
    <div className={`training-cover ${className}`} data-empty={!cover}>
      {cover ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={cover.src} alt={cover.alt} loading="lazy" />
          {credit && cover.credit && (
            <span className="training-cover__credit">
              <PhotoCreditLine credit={cover.credit} />
            </span>
          )}
        </>
      ) : (
        <BookIcon size={small ? 18 : 40} />
      )}
    </div>
  );
}

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};
function BookIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke} aria-hidden="true">
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" />
      <path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5" />
      <path d="M9 8h7M9 11.5h5" />
    </svg>
  );
}
function Padlock() {
  return (
    <svg width={11} height={11} viewBox="0 0 24 24" {...stroke} strokeWidth={2.4} aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}
