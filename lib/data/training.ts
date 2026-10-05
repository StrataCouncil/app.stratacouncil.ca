import { createClient } from "@/lib/supabase/server";
import { flattenScreens, normalizeModuleContent, type ModuleContent } from "@/lib/training/content";

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
}

export interface TrainingTrack {
  id: string;
  code: string;
  slug: string;
  title: string;
  description: string;
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
    supabase.from("training_tracks").select("id, code, title, description, order_index").order("order_index"),
    supabase
      .from("training_modules")
      .select("id, track_id, order_index, title, summary, estimated_minutes, published_version, published_at")
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
          };
        }),
    };
  });
}

export type ModuleStatus = "done" | "open" | "locked" | "soon";

/**
 * Modules open in order within a track (doc03 Stage 3): a published module
 * opens once every published module before it is complete. Unpublished
 * modules show as coming soon and don't hold anything up.
 */
export function moduleStatuses(track: TrainingTrack): Map<string, ModuleStatus> {
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
  const [{ data: mod }, { data: draft }] = await Promise.all([
    supabase
      .from("training_modules")
      .select("id, title, summary, estimated_minutes, published_version, published_at, track:training_tracks(id, code, title)")
      .eq("id", moduleId)
      .maybeSingle(),
    supabase.from("training_module_drafts").select("content, updated_at, ready_for_review_at").eq("module_id", moduleId).maybeSingle(),
  ]);
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
