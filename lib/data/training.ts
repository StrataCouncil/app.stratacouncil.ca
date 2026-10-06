import { createClient } from "@/lib/supabase/server";
import {
  normalizeCredit,
  normalizeFurtherReading,
  normalizeObjectives,
  normalizePlayerContent,
  normalizeVoice,
  toSlides,
  type FurtherReading,
  type MediaRow,
  type ModuleCover,
  type Objective,
  type PlayerContent,
  type Slide,
  type SlideRow,
} from "@/lib/training/slides";

export { moduleStatuses, type ModuleStatus } from "@/lib/training/progress";

/**
 * Council Training reads (0033, 0041). Learners see tracks, module outlines
 * and published versions; their own progress; and credentials (theirs and
 * strata-mates', under RLS). Slides and their media are readable only by
 * Super Admins and the module's Authors, also under RLS.
 */

export interface TrainingModuleSummary {
  id: string;
  trackId: string;
  orderIndex: number;
  title: string;
  summary: string;
  estimatedMinutes: number | null;
  publishedVersion: number;
  publishedAt: string | null;
  /** The signed-in learner's progress, if any. */
  completedSections: number;
  completed: boolean;
  /** The published first slide's picture, for cards. */
  cover: ModuleCover | null;
}

export interface TrainingTrack {
  id: string;
  code: string;
  slug: string;
  title: string;
  description: string;
  /** "core" (Strata Basics, Council Ready) or "specialty" (Treasurer, Secretary). */
  stage: "core" | "specialty";
  /** The track to finish first (0035). */
  requiresTrackId: string | null;
  modules: TrainingModuleSummary[];
  credential: { issuedAt: string } | null;
  /** The picture on the track's card (0042); the first module photo stands in when there's none. */
  cover: ModuleCover | null;
}

export const trackSlug = (code: string) => code.replace(/_/g, "-");
export const trackCode = (slug: string) => slug.replace(/-/g, "_");

/** Every track with its modules and the signed-in learner's progress and credentials. */
export async function getTrainingTracks(): Promise<TrainingTrack[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const [{ data: tracks }, { data: modules }, { data: progress }, { data: credentials }] = await Promise.all([
    supabase.from("training_tracks").select("id, code, title, description, order_index, stage, requires_track_id, cover").order("order_index"),
    supabase
      .from("training_modules")
      .select("id, track_id, order_index, title, summary, estimated_minutes, published_version, published_at, cover")
      .order("order_index"),
    user
      ? supabase.from("training_progress").select("module_id, completed_sections, completed_at").eq("user_id", user.id)
      : Promise.resolve({ data: [] }),
    user
      ? supabase.from("training_credentials").select("track_id, issued_at").eq("user_id", user.id)
      : Promise.resolve({ data: [] }),
  ]);
  const progressBy = new Map((progress ?? []).map((p) => [p.module_id as string, p]));
  const credentialBy = new Map((credentials ?? []).map((c) => [c.track_id as string, c]));

  return (tracks ?? []).map((t) => {
    const credential = credentialBy.get(t.id);
    return {
      id: t.id,
      code: t.code,
      slug: trackSlug(t.code),
      title: t.title,
      description: t.description,
      stage: t.stage === "specialty" ? "specialty" : "core",
      requiresTrackId: (t.requires_track_id as string | null) ?? null,
      credential: credential ? { issuedAt: credential.issued_at } : null,
      cover: toCover(t.cover),
      modules: (modules ?? [])
        .filter((m) => m.track_id === t.id)
        .map((m) => {
          const p = progressBy.get(m.id);
          return {
            id: m.id,
            trackId: m.track_id,
            orderIndex: m.order_index,
            title: m.title,
            summary: m.summary,
            estimatedMinutes: m.estimated_minutes,
            publishedVersion: m.published_version,
            publishedAt: m.published_at,
            completedSections: (p?.completed_sections as string[] | undefined)?.length ?? 0,
            completed: Boolean(p?.completed_at),
            cover: toCover(m.cover),
          };
        }),
    };
  });
}

export function toCover(raw: unknown): ModuleCover | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.src !== "string" || !c.src) return null;
  return { src: c.src, alt: typeof c.alt === "string" ? c.alt : "", credit: normalizeCredit(c.credit) };
}

export interface PublishedModule {
  module: TrainingModuleSummary;
  track: { id: string; title: string; slug: string };
  version: number;
  content: PlayerContent;
  completedSectionIds: string[];
  /** Progress was made against an older version (topic ids may not match). */
  progressVersion: number | null;
}

export async function getPublishedModule(moduleId: string): Promise<PublishedModule | null> {
  const tracks = await getTrainingTracks();
  const track = tracks.find((t) => t.modules.some((m) => m.id === moduleId));
  const mod = track?.modules.find((m) => m.id === moduleId);
  if (!track || !mod || mod.publishedVersion === 0) return null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const [{ data: version }, { data: progress }] = await Promise.all([
    supabase
      .from("training_module_versions")
      .select("content")
      .eq("module_id", moduleId)
      .eq("version", mod.publishedVersion)
      .maybeSingle(),
    user
      ? supabase
          .from("training_progress")
          .select("version, completed_sections")
          .eq("user_id", user.id)
          .eq("module_id", moduleId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const content = normalizePlayerContent(version?.content);
  if (!content) return null;
  return {
    module: mod,
    track: { id: track.id, title: track.title, slug: track.slug },
    version: mod.publishedVersion,
    content,
    completedSectionIds: (progress?.completed_sections as string[] | undefined) ?? [],
    progressVersion: (progress?.version as number | undefined) ?? null,
  };
}

// ── Builders (Super Admins, and Authors on their modules) ──────────────

export interface Checkout {
  userId: string;
  name: string;
  at: string;
}

type CheckoutRow = { checked_out_by: string | null; checked_out_at: string | null; holder?: unknown };
function toCheckout(r: CheckoutRow): Checkout | null {
  if (!r.checked_out_by) return null;
  const p = (Array.isArray(r.holder) ? r.holder[0] : r.holder) as { full_name: string | null; email: string | null } | null;
  return { userId: r.checked_out_by, name: p?.full_name || p?.email || "Someone", at: r.checked_out_at ?? "" };
}
const CHECKOUT_COLUMNS = "checked_out_by, checked_out_at, holder:profiles!training_modules_checked_out_by_fkey(full_name, email)";

export interface AdminModule extends TrainingModuleSummary {
  readyForReview: boolean;
  /** Slides changed after the last publish. */
  hasUnpublishedChanges: boolean;
  slideCount: number;
  checkout: Checkout | null;
}

/** Slide counts and last edits per module (under RLS: only modules the reader may build). */
async function slideStats(moduleIds?: string[]) {
  const supabase = await createClient();
  let q = supabase.from("training_slides").select("module_id, updated_at");
  if (moduleIds) q = q.in("module_id", moduleIds);
  const { data } = await q;
  const out = new Map<string, { count: number; updatedAt: string | null }>();
  for (const r of data ?? []) {
    const s = out.get(r.module_id as string) ?? { count: 0, updatedAt: null };
    s.count++;
    if (!s.updatedAt || (r.updated_at as string) > s.updatedAt) s.updatedAt = r.updated_at as string;
    out.set(r.module_id as string, s);
  }
  return out;
}

export async function getAdminTraining() {
  const supabase = await createClient();
  const [tracks, stats, { data: rows }] = await Promise.all([
    getTrainingTracks(),
    slideStats(),
    supabase.from("training_modules").select(`id, ready_for_review_at, ${CHECKOUT_COLUMNS}`),
  ]);
  const rowBy = new Map((rows ?? []).map((r) => [r.id as string, r]));
  return tracks.map((t) => ({
    ...t,
    modules: t.modules.map((m): AdminModule => {
      const s = stats.get(m.id);
      const r = rowBy.get(m.id) as (CheckoutRow & { ready_for_review_at: string | null }) | undefined;
      return {
        ...m,
        slideCount: s?.count ?? 0,
        readyForReview: Boolean(r?.ready_for_review_at),
        checkout: r ? toCheckout(r) : null,
        hasUnpublishedChanges: Boolean(s?.updatedAt) && (!m.publishedAt || s!.updatedAt! > m.publishedAt),
      };
    }),
  }));
}

export interface BuilderModule {
  id: string;
  title: string;
  summary: string;
  estimatedMinutes: number | null;
  publishedVersion: number;
  publishedAt: string | null;
  readyForReviewAt: string | null;
  track: { id: string; title: string; slug: string };
  objectives: Objective[];
  furtherReading: FurtherReading[];
  voice: { id: string; name: string } | null;
  checkout: Checkout | null;
  slides: Slide[];
}

/** A module and its slides for the builder. RLS returns nothing unless the reader may build it. */
export async function getBuilderModule(moduleId: string): Promise<BuilderModule | null> {
  if (!/^[0-9a-f-]{36}$/i.test(moduleId)) return null;
  const supabase = await createClient();
  const [{ data: mod, error }, { data: slides }, { data: media }, { data: allowed }] = await Promise.all([
    supabase
      .from("training_modules")
      .select(
        `id, title, summary, estimated_minutes, published_version, published_at, ready_for_review_at, objectives, further_reading, voice, ${CHECKOUT_COLUMNS}, track:training_tracks(id, code, title)`
      )
      .eq("id", moduleId)
      .maybeSingle(),
    supabase.from("training_slides").select("id, position, topic, title, body, layout, narration_script, narration_voiced, element, citations").eq("module_id", moduleId),
    supabase.from("training_media").select("id, slide_id, role, kind, source, url, alt, credit").eq("module_id", moduleId),
    supabase.rpc("can_author_training_module", { p_module_id: moduleId }),
  ]);
  if (error) console.error("[getBuilderModule]", error.message);
  if (!mod || allowed !== true) return null;
  const track = (Array.isArray(mod.track) ? mod.track[0] : mod.track) as { id: string; code: string; title: string };
  return {
    id: mod.id as string,
    title: mod.title as string,
    summary: mod.summary as string,
    estimatedMinutes: mod.estimated_minutes as number | null,
    publishedVersion: mod.published_version as number,
    publishedAt: mod.published_at as string | null,
    readyForReviewAt: (mod.ready_for_review_at as string | null) ?? null,
    track: { id: track.id, title: track.title, slug: trackSlug(track.code) },
    objectives: normalizeObjectives(mod.objectives),
    furtherReading: normalizeFurtherReading(mod.further_reading),
    voice: normalizeVoice(mod.voice),
    checkout: toCheckout(mod as unknown as CheckoutRow),
    slides: toSlides((slides ?? []) as SlideRow[], (media ?? []) as MediaRow[]),
  };
}

/** Every author assignment, grouped by module (Super Admin view). */
export async function getAllModuleAuthors() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("training_module_authors")
    .select("module_id, user_id, profile:profiles!training_module_authors_user_id_fkey(full_name, email)")
    .order("added_at");
  const out: Record<string, { userId: string; name: string; email: string }[]> = {};
  for (const a of data ?? []) {
    const p = (Array.isArray(a.profile) ? a.profile[0] : a.profile) as { full_name: string | null; email: string | null } | null;
    (out[a.module_id as string] ??= []).push({ userId: a.user_id as string, name: p?.full_name || p?.email || "Unknown", email: p?.email ?? "" });
  }
  return out;
}

/** Authors assigned to a module (Super Admin view). */
export async function getModuleAuthors(moduleId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("training_module_authors")
    .select("user_id, added_at, profile:profiles!training_module_authors_user_id_fkey(full_name, email)")
    .eq("module_id", moduleId)
    .order("added_at");
  return (data ?? []).map((a) => {
    const p = (Array.isArray(a.profile) ? a.profile[0] : a.profile) as { full_name: string | null; email: string | null } | null;
    return { userId: a.user_id as string, name: p?.full_name || p?.email || "Unknown", email: p?.email ?? "" };
  });
}

/** The modules the signed-in user is assigned to author (the /build workspace). */
export async function getMyAuthoredModules() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data: rows } = await supabase.from("training_module_authors").select("module_id").eq("user_id", user.id);
  const ids = (rows ?? []).map((r) => r.module_id as string);
  if (!ids.length) return [];
  const { data: mods } = await supabase
    .from("training_modules")
    .select("id, title, published_version, ready_for_review_at, track:training_tracks(title, order_index), order_index")
    .in("id", ids);
  const stats = await slideStats(ids);
  return (mods ?? [])
    .map((m) => {
      const t = (Array.isArray(m.track) ? m.track[0] : m.track) as { title: string; order_index: number };
      const st = stats.get(m.id as string);
      return {
        id: m.id as string,
        title: m.title as string,
        trackTitle: t?.title ?? "",
        trackOrder: t?.order_index ?? 0,
        order: m.order_index as number,
        publishedVersion: m.published_version as number,
        slideCount: st?.count ?? 0,
        updatedAt: st?.updatedAt ?? null,
        readyForReview: Boolean(m.ready_for_review_at),
      };
    })
    .sort((a, b) => a.trackOrder - b.trackOrder || a.order - b.order);
}

/** Credentials held by members of a strata (strata-mates can see these). */
export async function getCredentialsFor(userIds: string[]) {
  if (userIds.length === 0) return new Map<string, Set<string>>();
  const supabase = await createClient();
  const [{ data: creds }, { data: tracks }] = await Promise.all([
    supabase.from("training_credentials").select("user_id, track_id").in("user_id", userIds),
    supabase.from("training_tracks").select("id, code"),
  ]);
  const codeBy = new Map((tracks ?? []).map((t) => [t.id as string, t.code as string]));
  const out = new Map<string, Set<string>>();
  for (const c of creds ?? []) {
    const code = codeBy.get(c.track_id);
    if (!code) continue;
    if (!out.has(c.user_id)) out.set(c.user_id, new Set());
    out.get(c.user_id)!.add(code);
  }
  return out;
}

/** The narration voice every module uses unless it sets its own (0038). */
export async function getDefaultVoice(): Promise<{ id: string; name: string } | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("training_settings").select("narration_voice").eq("id", true).maybeSingle();
  const v = data?.narration_voice as { id?: unknown; name?: unknown } | null | undefined;
  return v && typeof v.id === "string" && typeof v.name === "string" ? { id: v.id, name: v.name } : null;
}
