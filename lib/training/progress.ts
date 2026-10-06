/**
 * Where a learner stands in Council Training (0035). Pure, so it can be
 * tested without a database.
 *
 * Tracks open in curriculum order: Strata Basics, then Council Ready, then
 * the specialty tracks. A track's prerequisite counts as met once every
 * published module in it is done (modules still being written don't hold
 * anyone up), and a track someone has already started stays open even if
 * a new module is later published in the track before it.
 *
 * Within a track, modules open in order: a published module opens once
 * every published module before it is done.
 */

export interface ProgressModule {
  id: string;
  orderIndex: number;
  publishedVersion: number;
  estimatedMinutes: number | null;
  completedSections: number;
  completed: boolean;
}

export interface ProgressTrack<M extends ProgressModule = ProgressModule> {
  id: string;
  requiresTrackId: string | null;
  /** Every module in the track is published and done (the roster's filled circle). */
  credential: unknown | null;
  modules: M[];
}

export type ModuleStatus = "done" | "open" | "locked" | "soon";
export type TrackStatus = "complete" | "in_progress" | "not_started" | "locked" | "soon";

export function moduleStatuses(track: { modules: ProgressModule[] }): Map<string, ModuleStatus> {
  const out = new Map<string, ModuleStatus>();
  let blocked = false;
  for (const m of [...track.modules].sort((a, b) => a.orderIndex - b.orderIndex)) {
    if (m.publishedVersion === 0) out.set(m.id, "soon");
    else if (m.completed) out.set(m.id, "done");
    else {
      out.set(m.id, blocked ? "locked" : "open");
      blocked = true;
    }
  }
  return out;
}

const published = (t: { modules: ProgressModule[] }) => t.modules.filter((m) => m.publishedVersion > 0);
const started = (t: { modules: ProgressModule[] }) => t.modules.some((m) => m.completed || m.completedSections > 0);

/** Every published module in the track is done (true when nothing is published yet). */
export function prerequisiteMet(track: ProgressTrack): boolean {
  return Boolean(track.credential) || published(track).every((m) => m.completed);
}

/** The track that must be finished first, if this one is still locked. */
export function lockedBehind<T extends ProgressTrack>(track: T, all: T[]): T | null {
  if (!track.requiresTrackId || started(track) || track.credential) return null;
  const before = all.find((t) => t.id === track.requiresTrackId);
  if (!before) return null;
  // A chain: the track before must itself be open, and finished.
  return lockedBehind(before, all) || !prerequisiteMet(before) ? before : null;
}

export function trackStatus(track: ProgressTrack, all: ProgressTrack[]): TrackStatus {
  if (track.credential) return "complete";
  if (lockedBehind(track, all)) return "locked";
  if (published(track).length === 0) return "soon";
  return started(track) ? "in_progress" : "not_started";
}

/**
 * The module to take next: one already under way if there is one,
 * otherwise the first open module in the first open track.
 */
export function nextModule<T extends ProgressTrack>(tracks: T[]): { track: T; module: T["modules"][number]; position: number } | null {
  const open: { track: T; module: T["modules"][number]; position: number }[] = [];
  for (const track of tracks) {
    if (lockedBehind(track, tracks)) continue;
    const statuses = moduleStatuses(track);
    const ordered = [...track.modules].sort((a, b) => a.orderIndex - b.orderIndex);
    const i = ordered.findIndex((m) => statuses.get(m.id) === "open");
    if (i >= 0) open.push({ track, module: ordered[i], position: i + 1 });
  }
  return open.find((o) => o.module.completedSections > 0) ?? open[0] ?? null;
}

/** Minutes left in the published modules of these tracks. */
export function minutesLeft(tracks: { modules: ProgressModule[] }[]): number {
  return tracks.flatMap(published).reduce((sum, m) => sum + (m.completed ? 0 : m.estimatedMinutes ?? 0), 0);
}

/** "about 35 min", "about 2 h", "about 1 h 40 min" (rounded to 5 minutes). */
export function formatMinutes(minutes: number): string {
  const m = Math.max(5, Math.round(minutes / 5) * 5);
  if (m < 60) return `about ${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return `about ${h} h${rest ? ` ${rest} min` : ""}`;
}
