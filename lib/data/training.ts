import { createClient } from "@/lib/supabase/server";
import { flattenScreens, normalizeCredit, normalizeModuleContent, type ModuleContent, type ModuleCover } from "@/lib/training/content";

import { normalizeFactCheck } from "@/lib/training/library";

export { moduleStatuses, type ModuleStatus } from "@/lib/training/progress";

/**
 * Council Training reads (0033). Learners see tracks, module outlines and
 * published versions; their own progress; and credentials (theirs and
 * strata-mates', under RLS). Drafts are Super Admin only, also under RLS.
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
  /** The published first screen's photo, for cards. */
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
    supabase.from("training_tracks").select("id, code, title, description, order_index, stage, requires_track_id").order("order_index"),
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

function toCover(raw: unknown): ModuleCover | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.src !== "string" || !c.src) return null;
  return { src: c.src, alt: typeof c.alt === "string" ? c.alt : "", credit: normalizeCredit(c.credit) };
}

export interface PublishedModule {
  module: TrainingModuleSummary;
  track: { id: string; title: string; slug: string };
  version: number;
  content: ModuleContent;
  completedSectionIds: string[];
  /** Progress was made against an older version (section ids may not match). */
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
  if (!version) return null;
  return {
    module: mod,
    track: { id: track.id, title: track.title, slug: track.slug },
    version: mod.publishedVersion,
    content: normalizeModuleContent(version.content),
    completedSectionIds: (progress?.completed_sections as string[] | undefined) ?? [],
    progressVersion: (progress?.version as number | undefined) ?? null,
  };
}

// ── Super Admin ────────────────────────────────────────────────────────

export interface AdminModule extends TrainingModuleSummary {
  draftUpdatedAt: string | null;
  readyForReview: boolean;
  /** The draft changed after the last publish. */
  hasUnpublishedChanges: boolean;
  screenCount: number;
}

export async function getAdminTraining() {
  const supabase = await createClient();
  const tracks = await getTrainingTracks();
  const { data: drafts } = await supabase.from("training_module_drafts").select("module_id, updated_at, content, ready_for_review_at");
  const draftBy = new Map((drafts ?? []).map((d) => [d.module_id as string, d]));
  return tracks.map((t) => ({
    ...t,
    modules: t.modules.map((m): AdminModule => {
      const d = draftBy.get(m.id);
      const screenCount = flattenScreens(normalizeModuleContent(d?.content)).length;
      return {
        ...m,
        draftUpdatedAt: d?.updated_at ?? null,
        readyForReview: Boolean(d?.ready_for_review_at),
        screenCount,
        hasUnpublishedChanges:
          screenCount > 0 && (!m.publishedAt || (Boolean(d?.updated_at) && d!.updated_at > m.publishedAt)),
      };
    }),
  }));
}

export async function getModuleDraft(moduleId: string) {
  const supabase = await createClient();
  const [{ data: mod, error: modError }, { data: draft }] = await Promise.all([
    supabase
      .from("training_modules")
      .select(
        // Two links join modules and AI builds (source_import_id, and 0036's module_id): name the one meant.
        "id, title, summary, estimated_minutes, published_version, published_at, ai_drafted, track:training_tracks(id, code, title), source:training_imports!training_modules_source_import_id_fkey(title)"
      )
      .eq("id", moduleId)
      .maybeSingle(),
    supabase.from("training_module_drafts").select("content, updated_at, ready_for_review_at, fact_check").eq("module_id", moduleId).maybeSingle(),
  ]);
  if (modError) console.error("[getModuleDraft]", modError.message);
  if (!mod || !draft) return null;
  const track = (Array.isArray(mod.track) ? mod.track[0] : mod.track) as { id: string; code: string; title: string };
  return {
    id: mod.id as string,
    title: mod.title as string,
    summary: mod.summary as string,
    estimatedMinutes: mod.estimated_minutes as number | null,
    publishedVersion: mod.published_version as number,
    publishedAt: mod.published_at as string | null,
    track: { id: track.id, title: track.title, slug: trackSlug(track.code) },
    content: normalizeModuleContent(draft.content),
    draftUpdatedAt: draft.updated_at as string,
    readyForReviewAt: (draft.ready_for_review_at as string | null) ?? null,
    /** The latest check against the Legislation Library (0037). */
    factCheck: normalizeFactCheck(draft.fact_check),
    /** Drafted by the AI module builder; the title of its source document when the reader may see it. */
    aiDraftedFrom: mod.ai_drafted
      ? ((Array.isArray(mod.source) ? mod.source[0] : mod.source) as { title: string } | null)?.title ?? "a document"
      : null,
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
    .select("id, title, published_version, track:training_tracks(title, order_index), order_index")
    .in("id", ids);
  const { data: drafts } = await supabase.from("training_module_drafts").select("module_id, updated_at, ready_for_review_at, content").in("module_id", ids);
  const draftBy = new Map((drafts ?? []).map((d) => [d.module_id as string, d]));
  return (mods ?? [])
    .map((m) => {
      const t = (Array.isArray(m.track) ? m.track[0] : m.track) as { title: string; order_index: number };
      const d = draftBy.get(m.id);
      return {
        id: m.id as string,
        title: m.title as string,
        trackTitle: t?.title ?? "",
        trackOrder: t?.order_index ?? 0,
        order: m.order_index as number,
        publishedVersion: m.published_version as number,
        screenCount: flattenScreens(normalizeModuleContent(d?.content)).length,
        updatedAt: (d?.updated_at as string | undefined) ?? null,
        readyForReview: Boolean(d?.ready_for_review_at),
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
