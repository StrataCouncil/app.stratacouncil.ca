import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  buildPlayerContent,
  coverOf,
  normalizeFurtherReading,
  normalizeObjectives,
  normalizePlayerContent,
  toSlides,
  type MediaRow,
  type PlayerContent,
  type SlideRow,
} from "@/lib/training/slides";
import { toCover, trackSlug, type TrainingTrack } from "@/lib/data/training";

/**
 * Council Training through a demo link (0040): no sign-in, no progress
 * kept. Everything is read on the server with the service role, and only
 * after the link's token checks out. Every module is open (reviewers jump
 * around); a link with include_drafts shows modules' slides as they are
 * now, published or not.
 */

export interface DemoLink {
  id: string;
  token: string;
  label: string;
  includeDrafts: boolean;
}

const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;

export async function getDemoLink(token: string): Promise<DemoLink | null> {
  if (!TOKEN.test(token)) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("training_demo_links")
    .select("id, token, label, include_drafts, expires_at, revoked_at, last_used_at")
    .eq("token", token)
    .maybeSingle();
  if (!data || data.revoked_at || (data.expires_at && Date.parse(data.expires_at) < Date.now())) return null;
  // Note when the link was last used (at most once an hour).
  if (!data.last_used_at || Date.now() - Date.parse(data.last_used_at) > 60 * 60 * 1000) {
    void admin.from("training_demo_links").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
  }
  return { id: data.id, token: data.token, label: data.label, includeDrafts: Boolean(data.include_drafts) };
}

async function readAll(link: DemoLink) {
  const admin = createAdminClient();
  const [{ data: tracks }, { data: modules }, { data: slides }, { data: media }] = await Promise.all([
    admin.from("training_tracks").select("id, code, title, description, order_index, stage, cover").order("order_index"),
    admin
      .from("training_modules")
      .select("id, track_id, order_index, title, summary, estimated_minutes, published_version, published_at, cover, objectives, further_reading")
      .order("order_index"),
    link.includeDrafts
      ? admin.from("training_slides").select("id, module_id, position, topic, title, body, layout, narration_script, narration_voiced, element, citations")
      : Promise.resolve({ data: [] }),
    link.includeDrafts ? admin.from("training_media").select("id, slide_id, module_id, role, kind, source, url, alt, credit") : Promise.resolve({ data: [] }),
  ]);
  const draftBy = new Map<string, PlayerContent>();
  for (const m of modules ?? []) {
    const rows = (slides ?? []).filter((s) => s.module_id === m.id) as unknown as SlideRow[];
    if (!rows.length) continue;
    const files = (media ?? []).filter((x) => x.module_id === m.id) as unknown as MediaRow[];
    const content = buildPlayerContent(
      { title: m.title, objectives: normalizeObjectives(m.objectives), furtherReading: normalizeFurtherReading(m.further_reading) },
      toSlides(rows, files)
    );
    draftBy.set(m.id as string, content);
  }
  return { tracks: tracks ?? [], modules: modules ?? [], draftBy };
}

export async function getDemoTracks(link: DemoLink): Promise<TrainingTrack[]> {
  const { tracks, modules, draftBy } = await readAll(link);
  return tracks.map((t) => ({
    id: t.id,
    code: t.code,
    slug: trackSlug(t.code),
    title: t.title,
    description: t.description,
    stage: t.stage === "specialty" ? "specialty" : "core",
    // Everything is open in a demo.
    requiresTrackId: null,
    credential: null,
    cover: toCover(t.cover),
    modules: modules
      .filter((m) => m.track_id === t.id)
      .map((m) => {
        const draft = draftBy.get(m.id) ?? null;
        return {
          id: m.id,
          trackId: m.track_id,
          orderIndex: m.order_index,
          title: m.title,
          summary: m.summary,
          estimatedMinutes: m.estimated_minutes,
          publishedVersion: draft ? Math.max(1, m.published_version) : m.published_version,
          publishedAt: m.published_at,
          completedSections: 0,
          completed: false,
          cover: draft ? coverOf(draft) : toCover(m.cover),
        };
      }),
  }));
}

export async function getDemoModule(link: DemoLink, moduleId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(moduleId)) return null;
  const tracks = await getDemoTracks(link);
  const track = tracks.find((t) => t.modules.some((m) => m.id === moduleId));
  const mod = track?.modules.find((m) => m.id === moduleId);
  if (!track || !mod || mod.publishedVersion === 0) return null;
  let content: PlayerContent | null = null;
  if (link.includeDrafts) content = (await readAll(link)).draftBy.get(moduleId) ?? null;
  if (!content) {
    const admin = createAdminClient();
    const { data: published } = await admin.from("training_modules").select("published_version").eq("id", moduleId).maybeSingle();
    if (!published?.published_version) return null;
    const { data } = await admin
      .from("training_module_versions")
      .select("content")
      .eq("module_id", moduleId)
      .eq("version", published.published_version)
      .maybeSingle();
    content = normalizePlayerContent(data?.content);
    if (!content) return null;
  }
  const ordered = [...track.modules].sort((a, b) => a.orderIndex - b.orderIndex);
  const next = ordered.find((m) => m.orderIndex > mod.orderIndex && m.publishedVersion > 0) ?? null;
  return { module: mod, track, content, next };
}

// ── Super Admin ────────────────────────────────────────────────────────

/** Demo links and the comments sent from them (read under RLS, Super Admins only). */
export async function getDemoAdmin() {
  const supabase = await createClient();
  const [{ data: links }, { data: feedback }] = await Promise.all([
    supabase.from("training_demo_links").select("id, token, label, include_drafts, expires_at, revoked_at, last_used_at, created_at").order("created_at", { ascending: false }),
    supabase
      .from("training_feedback")
      .select("id, link_label, module_title, screen_title, name, message, created_at")
      .order("created_at", { ascending: false })
      .limit(200),
  ]);
  return {
    links: (links ?? []).map((l) => ({
      id: l.id as string,
      token: l.token as string,
      label: l.label as string,
      includeDrafts: Boolean(l.include_drafts),
      expiresAt: (l.expires_at as string | null) ?? null,
      revokedAt: (l.revoked_at as string | null) ?? null,
      lastUsedAt: (l.last_used_at as string | null) ?? null,
      createdAt: l.created_at as string,
    })),
    feedback: (feedback ?? []).map((f) => ({
      id: f.id as string,
      linkLabel: f.link_label as string,
      moduleTitle: f.module_title as string,
      screenTitle: f.screen_title as string,
      name: f.name as string,
      message: f.message as string,
      createdAt: f.created_at as string,
    })),
  };
}
export type DemoAdmin = Awaited<ReturnType<typeof getDemoAdmin>>;
