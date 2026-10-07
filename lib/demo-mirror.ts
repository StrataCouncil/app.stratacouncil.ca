import type { SupabaseClient } from "@supabase/supabase-js";
import { demoDatabase } from "@/lib/data/demo-visitors";
import { IS_DEMO, demoOpenModule, type DemoModuleRow } from "@/lib/demo";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Keeps the demo site's shared content the same as the live site's
 * (lib/demo.ts). Runs on the live site, reading the live database and
 * writing the demo one (DEMO_SUPABASE_URL, DEMO_SUPABASE_SERVICE_ROLE_KEY).
 *
 * - Council Training: every track and module, with the first published
 *   module open and the rest showing as coming soon. Runs after each
 *   publish, and from the console. Slides' pictures, narration and music
 *   stay where they are (the public training-media bucket on the live
 *   project), so the published content is copied as is.
 * - The legislation library: each entry and its search index, so the demo
 *   Stratasphere answers from the same law. Runs after an entry is
 *   indexed, and from the console. Only legislation is copied: the global
 *   precedent pool (from real stratas' documents) never leaves the live
 *   site.
 *
 * Nothing about people is copied: authors, check-outs and uploaders are
 * left out.
 */

export type MirrorResult<T> = ({ ok: true } & T) | { ok: false; error: string };

function databases(): { live: SupabaseClient; demo: SupabaseClient } | null {
  if (IS_DEMO) return null;
  const demo = demoDatabase();
  return demo ? { live: createAdminClient(), demo } : null;
}

const NOT_CONNECTED = "The demo site isn't connected (DEMO_SUPABASE_URL and DEMO_SUPABASE_SERVICE_ROLE_KEY).";

function fail(where: string, message: string) {
  console.error(`[demo mirror] ${where}:`, message);
  return { ok: false as const, error: `Couldn't copy to the demo (${where}).` };
}

/** `id not in (…)`, for deleting what the live site no longer has. */
const notIn = (ids: string[]) => `(${ids.map((id) => `"${id}"`).join(",")})`;

const TRACK_COLUMNS = "id, code, title, description, jurisdiction, order_index, stage, requires_track_id, cover, created_at";
const MODULE_COLUMNS =
  "id, track_id, order_index, title, summary, estimated_minutes, published_version, published_at, cover, objectives, further_reading, curriculum_key, created_at";

type Track = { id: string; order_index: number; requires_track_id: string | null } & Record<string, unknown>;
type Module = DemoModuleRow & Record<string, unknown>;

export async function mirrorTrainingToDemo(): Promise<MirrorResult<{ modules: number; open: string | null }>> {
  const db = databases();
  if (!db) return { ok: false, error: NOT_CONNECTED };
  const { live, demo } = db;

  const [{ data: tracks, error: tErr }, { data: modules, error: mErr }] = await Promise.all([
    live.from("training_tracks").select(TRACK_COLUMNS),
    live.from("training_modules").select(MODULE_COLUMNS),
  ]);
  if (tErr || mErr || !tracks || !modules) return fail("reading training", tErr?.message ?? mErr?.message ?? "no rows");
  const open = demoOpenModule(tracks as Track[], modules as Module[]);

  let version: Record<string, unknown> | null = null;
  if (open) {
    const { data, error } = await live
      .from("training_module_versions")
      .select("module_id, version, content, published_at")
      .eq("module_id", open.id)
      .eq("version", open.published_version)
      .maybeSingle();
    if (error) return fail("reading the open module", error.message);
    version = data;
  }

  // What the live site no longer has goes (with its progress); the demo's
  // own starting tracks, made by the migrations with other ids, go the
  // first time.
  const moduleIds = modules.map((m) => m.id as string);
  const trackIds = tracks.map((t) => t.id as string);
  const delModules = demo.from("training_modules").delete();
  const { error: dmErr } = await (moduleIds.length ? delModules.not("id", "in", notIn(moduleIds)) : delModules.not("id", "is", null));
  if (dmErr) return fail("removing old modules", dmErr.message);
  const delTracks = demo.from("training_tracks").delete();
  const { error: dtErr } = await (trackIds.length ? delTracks.not("id", "in", notIn(trackIds)) : delTracks.not("id", "is", null));
  if (dtErr) return fail("removing old tracks", dtErr.message);

  // Tracks point at the track before them, so they go in twice: first
  // without that link, then with it.
  if (tracks.length) {
    const { error: t1 } = await demo.from("training_tracks").upsert(tracks.map((t) => ({ ...t, requires_track_id: null })));
    if (t1) return fail("tracks", t1.message);
    const { error: t2 } = await demo.from("training_tracks").upsert(tracks);
    if (t2) return fail("tracks", t2.message);
  }

  if (modules.length) {
    const rows = modules.map((m) =>
      open && m.id === open.id && version ? m : { ...m, published_version: 0, published_at: null }
    );
    const { error } = await demo.from("training_modules").upsert(rows);
    if (error) return fail("modules", error.message);
  }

  if (open && version) {
    const { error } = await demo.from("training_module_versions").upsert(version);
    if (error) return fail("the open module", error.message);
    await demo.from("training_module_versions").delete().neq("module_id", open.id);
  } else {
    await demo.from("training_module_versions").delete().not("module_id", "is", null);
  }

  return { ok: true, modules: modules.length, open: open && version ? (open.title as string) : null };
}

const LEGISLATION_COLUMNS =
  "id, title, short_name, kind, current_to, file_name, mime_type, size_bytes, indexing_status, section_count, chunk_count, uploaded_at, indexed_at";
const CHUNK_COLUMNS = "id, scope, legislation_document_id, source_act, title, chunk_text, embedding, chunk_index, created_at";

/**
 * Entries whose index changed since the last copy (indexed_at differs)
 * get their chunks copied again; unchanged ones are left alone.
 */
export async function mirrorLegislationToDemo(): Promise<MirrorResult<{ entries: number; copied: number; chunks: number }>> {
  const db = databases();
  if (!db) return { ok: false, error: NOT_CONNECTED };
  const { live, demo } = db;

  const [{ data: entries, error: lErr }, { data: existing, error: dErr }] = await Promise.all([
    live.from("legislation_documents").select(LEGISLATION_COLUMNS),
    demo.from("legislation_documents").select("id, indexed_at"),
  ]);
  if (lErr || !entries) return fail("reading the library", lErr?.message ?? "no rows");
  if (dErr) return fail("reading the demo library", dErr.message);

  const ids = entries.map((e) => e.id as string);
  const del = demo.from("legislation_documents").delete();
  const { error: delErr } = await (ids.length ? del.not("id", "in", notIn(ids)) : del.not("id", "is", null));
  if (delErr) return fail("removing old entries", delErr.message);

  // indexed_at moves to the live value only once an entry's index is
  // copied, so a copy that stops halfway is finished next time.
  const before = new Map((existing ?? []).map((e) => [e.id as string, (e.indexed_at as string | null) ?? null]));
  if (entries.length) {
    const { error } = await demo
      .from("legislation_documents")
      .upsert(entries.map((e) => ({ ...e, indexed_at: before.get(e.id as string) ?? null })));
    if (error) return fail("entries", error.message);
  }
  const changed = entries.filter(
    (e) => e.indexing_status === "indexed" && (!before.has(e.id as string) || before.get(e.id as string) !== e.indexed_at)
  );

  let chunks = 0;
  for (const entry of changed) {
    const { error: clearErr } = await demo.from("knowledge_chunks").delete().eq("legislation_document_id", entry.id);
    if (clearErr) return fail("clearing an entry's index", clearErr.message);
    for (let from = 0; ; from += 500) {
      const { data: page, error } = await live
        .from("knowledge_chunks")
        .select(CHUNK_COLUMNS)
        .eq("scope", "legislation")
        .eq("legislation_document_id", entry.id)
        .order("chunk_index")
        .range(from, from + 499);
      if (error) return fail("reading an entry's index", error.message);
      if (!page?.length) break;
      for (let i = 0; i < page.length; i += 100) {
        const { error: insErr } = await demo.from("knowledge_chunks").insert(page.slice(i, i + 100));
        if (insErr) return fail("copying an entry's index", insErr.message);
      }
      chunks += page.length;
      if (page.length < 500) break;
    }
    const { error: doneErr } = await demo.from("legislation_documents").update({ indexed_at: entry.indexed_at }).eq("id", entry.id);
    if (doneErr) return fail("finishing an entry", doneErr.message);
  }
  return { ok: true, entries: entries.length, copied: changed.length, chunks };
}
