"use server";

import { randomBytes, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/profile";
import { getBuilderModule, type BuilderModule } from "@/lib/data/training";
import { canAuthor, editing, labelFor, readSlide, SLIDE_COLUMNS, staff, verifiedCitations, type AdminClient } from "@/lib/training/builder-server";
import {
  buildPlayerContent,
  coverOf,
  MEDIA_BUCKET,
  moduleFolder,
  normalizeCredit,
  normalizeFurtherReading,
  normalizeObjectives,
  normalizeSlidePatch,
  normalizeVoice,
  publishProblems,
  safeMediaUrl,
  slideFolder,
  toMedia,
  toSlides,
  videoSource,
  type Citation,
  type FurtherReading,
  type Media,
  type MediaRow,
  type Objective,
  type Slide,
  type SlideRow,
} from "@/lib/training/slides";
import { searchLibrary, passagesForCitations } from "@/lib/training/library-server";
import { getVoice, listVoices, NarrationError, speak, type Voice } from "@/lib/media/elevenlabs";
import { PhotoError, searchPhotos, trackPhotoUse, type StockPhoto } from "@/lib/media/unsplash";

/**
 * Council Training builder writes (0041).
 *
 * Editing works like checking out a file: "Edit module" checks the module
 * out to one person and hands their window a token; every change sends
 * that token back, and is refused unless the module is still checked out
 * to them in that window. "Finished editing" checks it back in. No one
 * else, and no other window, can change a checked-out module; the holder
 * can check it in from elsewhere if its window was closed, and a Super
 * Admin can release a checkout someone left behind.
 *
 * Super Admins can build every module; Authors only the ones they're
 * assigned. All writes use the service role after these checks (RLS only
 * lets signed-in users read slides and media).
 */

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

function refresh(moduleId?: string) {
  revalidatePath("/admin/training");
  revalidatePath("/build", "layout");
  revalidatePath("/training", "layout");
  if (moduleId) revalidatePath(`/admin/training/${moduleId}`);
}

// ── Checking out and in ────────────────────────────────────────────────

/**
 * Check the module out to edit it. Refused while it's checked out,
 * including to you in another window: the window that checked it out
 * keeps it until it's checked back in.
 */
export async function checkOutModule(moduleId: string): Promise<Result<{ token: string }>> {
  const profile = await getCurrentProfile();
  if (!profile || !(await canAuthor(moduleId))) return { ok: false, error: "You can't edit this module." };
  const admin = createAdminClient();
  const token = randomUUID();
  const { data, error } = await admin
    .from("training_modules")
    .update({ checked_out_by: profile.id, checked_out_at: new Date().toISOString(), checkout_token: token })
    .eq("id", moduleId)
    .is("checked_out_by", null)
    .select("id");
  if (error) {
    console.error("[checkOutModule]", error.message);
    return { ok: false, error: "Couldn't check the module out. Try again." };
  }
  if (!data?.length) {
    const { data: held } = await admin.from("training_modules").select("checked_out_by").eq("id", moduleId).maybeSingle();
    return {
      ok: false,
      error:
        held?.checked_out_by === profile.id
          ? "You're already editing this module in another window. Finish editing there first."
          : "Someone else is editing this module. It opens for editing once they check it back in.",
    };
  }
  refresh(moduleId);
  return { ok: true, token };
}

/** The module as saved now, for a builder that has just checked it out. */
export async function loadBuilderModule(moduleId: string): Promise<Result<{ module: BuilderModule }>> {
  const m = await getBuilderModule(moduleId);
  return m ? { ok: true, module: m } : { ok: false, error: "You can't edit this module." };
}

/** Whether this window's checkout still holds (after a reload). */
export async function checkoutStillMine(moduleId: string, token: string): Promise<boolean> {
  return (await editing(moduleId, token)).ok;
}

/** Finished editing: check the module back in. */
export async function checkInModule(moduleId: string, token: string): Promise<Result> {
  const e = await editing(moduleId, token);
  if (!e.ok) return e;
  const { error } = await e.admin
    .from("training_modules")
    .update({ checked_out_by: null, checked_out_at: null, checkout_token: null })
    .eq("id", moduleId)
    .eq("checkout_token", token);
  if (error) return { ok: false, error: "Couldn't check the module in. Try again." };
  refresh(moduleId);
  return { ok: true };
}

/**
 * Check a module back in without its editing window: your own checkout
 * (that window was closed), or, for a Super Admin, anyone's (they left
 * without checking in). Every change was already saved as it was made.
 */
export async function releaseCheckout(moduleId: string): Promise<Result> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "You can't edit this module." };
  const admin = createAdminClient();
  const { data: mod } = await admin.from("training_modules").select("checked_out_by").eq("id", moduleId).maybeSingle();
  if (!mod) return { ok: false, error: "Module not found." };
  if (mod.checked_out_by !== profile.id && !profile.isSuperAdmin) return { ok: false, error: "Only platform staff can release someone else's module." };
  const { error } = await admin
    .from("training_modules")
    .update({ checked_out_by: null, checked_out_at: null, checkout_token: null })
    .eq("id", moduleId);
  if (error) return { ok: false, error: "Couldn't release the module." };
  refresh(moduleId);
  return { ok: true };
}

/** Whether a module is checked out to someone other than the signed-in person. */
async function heldByOther(moduleId: string, userId: string) {
  const { data } = await createAdminClient().from("training_modules").select("checked_out_by").eq("id", moduleId).maybeSingle();
  return Boolean(data?.checked_out_by && data.checked_out_by !== userId);
}

// ── Module settings ────────────────────────────────────────────────────

/** Objectives (with Bloom levels), further reading and the narration voice. */
export async function saveModuleSettings(
  moduleId: string,
  token: string,
  input: { objectives: Objective[]; furtherReading: FurtherReading[]; voice: { id: string; name: string } | null }
): Promise<Result> {
  const e = await editing(moduleId, token);
  if (!e.ok) return e;
  const objectives = normalizeObjectives(input.objectives);
  const furtherReading = normalizeFurtherReading(input.furtherReading);
  const { error } = await e.admin
    .from("training_modules")
    .update({ objectives, further_reading: furtherReading, voice: normalizeVoice(input.voice) })
    .eq("id", moduleId);
  if (error) {
    console.error("[saveModuleSettings]", error.message);
    return { ok: false, error: "Couldn't save the module settings." };
  }
  return { ok: true };
}

/** Title, summary and length (Super Admins, from the training list). Not while someone else is editing. */
export async function updateModuleDetails(
  moduleId: string,
  input: { title: string; summary: string; estimatedMinutes: number | null }
): Promise<Result> {
  const me = await staff();
  if (!me) return { ok: false, error: "Only platform staff can edit training." };
  if (await heldByOther(moduleId, me.id)) return { ok: false, error: "Someone is editing this module. Try again once they've checked it in." };
  const title = input.title.trim().slice(0, 200);
  if (!title) return { ok: false, error: "Give the module a title." };
  const minutes =
    input.estimatedMinutes && Number.isFinite(input.estimatedMinutes) ? Math.max(1, Math.min(600, Math.round(input.estimatedMinutes))) : null;
  const supabase = await createClient();
  const { error } = await supabase
    .from("training_modules")
    .update({ title, summary: input.summary.trim().slice(0, 1000), estimated_minutes: minutes })
    .eq("id", moduleId);
  if (error) return { ok: false, error: "Couldn't save the module details." };
  refresh(moduleId);
  return { ok: true };
}

export async function updateTrackDetails(trackId: string, input: { title: string; description: string }): Promise<Result> {
  if (!(await staff())) return { ok: false, error: "Only platform staff can edit training." };
  const title = input.title.trim().slice(0, 200);
  if (!title) return { ok: false, error: "Give the track a title." };
  const supabase = await createClient();
  const { error } = await supabase.from("training_tracks").update({ title, description: input.description.trim().slice(0, 1000) }).eq("id", trackId);
  if (error) return { ok: false, error: "Couldn't save the track details." };
  refresh();
  return { ok: true };
}

// ── Track pictures (0042): in the track's own folder ───────────────────

const IMAGE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** A one-time upload URL for a track's card picture, in training-media/<track id>/. */
export async function createTrackCoverUpload(trackId: string, file: { type: string; size: number }): Promise<Result<{ path: string; token: string }>> {
  if (!(await staff())) return { ok: false, error: "Only platform staff can change track pictures." };
  if (!/^[0-9a-f-]{36}$/i.test(trackId)) return { ok: false, error: "Track not found." };
  const ext = IMAGE_TYPES[file.type];
  if (!ext) return { ok: false, error: "Use a JPEG, PNG or WebP picture." };
  if (file.size > 20 * 1024 * 1024) return { ok: false, error: "Pictures can be up to 20 MB." };
  const path = `${trackId}/cover-${randomUUID().slice(0, 8)}.${ext}`;
  const { data, error } = await createAdminClient().storage.from(MEDIA_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return { ok: false, error: "Couldn't start the upload." };
  return { ok: true, path: data.path, token: data.token };
}

/** Put a picture on the track's card, deleting the one it replaces. */
async function setTrackCover(trackId: string, cover: { src: string; alt: string; credit: unknown; path: string | null }): Promise<Result> {
  const admin = createAdminClient();
  const { data: track } = await admin.from("training_tracks").select("cover").eq("id", trackId).maybeSingle();
  if (!track) return { ok: false, error: "Track not found." };
  const { error } = await admin.from("training_tracks").update({ cover }).eq("id", trackId);
  if (error) return { ok: false, error: "Couldn't save the picture." };
  const old = (track.cover as { path?: unknown } | null)?.path;
  if (typeof old === "string" && old !== cover.path && old.startsWith(`${trackId}/cover-`)) await removeFiles(admin, [old]);
  refresh();
  return { ok: true };
}

export async function attachTrackUpload(trackId: string, input: { path: string; alt: string }): Promise<Result> {
  if (!(await staff())) return { ok: false, error: "Only platform staff can change track pictures." };
  if (!input.path.startsWith(`${trackId}/cover-`) || input.path.includes("..") || input.path.split("/").length !== 2)
    return { ok: false, error: "That file isn't this track's." };
  const src = createAdminClient().storage.from(MEDIA_BUCKET).getPublicUrl(input.path).data.publicUrl;
  return setTrackCover(trackId, { src, alt: input.alt.slice(0, 500), credit: null, path: input.path });
}

export async function attachTrackStockPhoto(trackId: string, photo: { src: string; alt: string; credit: unknown; downloadLocation: string }): Promise<Result> {
  if (!(await staff())) return { ok: false, error: "Only platform staff can change track pictures." };
  const src = safeMediaUrl(photo.src);
  const credit = normalizeCredit(photo.credit);
  if (!src || new URL(src).hostname !== "images.unsplash.com" || !credit) return { ok: false, error: "That photo can't be used." };
  try {
    await trackPhotoUse(photo.downloadLocation);
  } catch (e) {
    return { ok: false, error: e instanceof PhotoError ? e.message : "Couldn't use that photo." };
  }
  return setTrackCover(trackId, { src, alt: photo.alt.slice(0, 500), credit, path: null });
}

export async function updateTrackCoverAlt(trackId: string, alt: string): Promise<Result> {
  if (!(await staff())) return { ok: false, error: "Only platform staff can change track pictures." };
  const admin = createAdminClient();
  const { data: track } = await admin.from("training_tracks").select("cover").eq("id", trackId).maybeSingle();
  if (!track?.cover) return { ok: false, error: "The track has no picture." };
  const { error } = await admin.from("training_tracks").update({ cover: { ...(track.cover as object), alt: alt.slice(0, 500) } }).eq("id", trackId);
  if (error) return { ok: false, error: "Couldn't save the description." };
  refresh();
  return { ok: true };
}

/** Back to the first module photo; the uploaded picture is deleted. */
export async function removeTrackCover(trackId: string): Promise<Result> {
  if (!(await staff())) return { ok: false, error: "Only platform staff can change track pictures." };
  const admin = createAdminClient();
  const { data: track } = await admin.from("training_tracks").select("cover").eq("id", trackId).maybeSingle();
  if (!track) return { ok: false, error: "Track not found." };
  const { error } = await admin.from("training_tracks").update({ cover: null }).eq("id", trackId);
  if (error) return { ok: false, error: "Couldn't remove the picture." };
  const old = (track.cover as { path?: unknown } | null)?.path;
  if (typeof old === "string" && old.startsWith(`${trackId}/cover-`)) await removeFiles(admin, [old]);
  refresh();
  return { ok: true };
}

export async function addModule(trackId: string, title: string): Promise<Result<{ id: string }>> {
  if (!(await staff())) return { ok: false, error: "Only platform staff can edit training." };
  const clean = title.trim().slice(0, 200);
  if (!clean) return { ok: false, error: "Give the module a title." };
  const supabase = await createClient();
  const { data: last } = await supabase
    .from("training_modules")
    .select("order_index")
    .eq("track_id", trackId)
    .order("order_index", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data, error } = await supabase
    .from("training_modules")
    .insert({ track_id: trackId, title: clean, order_index: (last?.order_index ?? 0) + 1 })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "Couldn't add the module." };
  refresh();
  return { ok: true, id: data.id };
}

/** Swap a module with its neighbour in the track. */
export async function moveModule(moduleId: string, direction: -1 | 1): Promise<Result> {
  if (!(await staff())) return { ok: false, error: "Only platform staff can edit training." };
  const supabase = await createClient();
  const { data: mod } = await supabase.from("training_modules").select("id, track_id").eq("id", moduleId).single();
  if (!mod) return { ok: false, error: "Module not found." };
  const { data: siblings } = await supabase.from("training_modules").select("id, order_index").eq("track_id", mod.track_id).order("order_index");
  const order = (siblings ?? []).map((m) => m.id as string);
  const i = order.indexOf(moduleId);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= order.length) return { ok: true };
  [order[i], order[j]] = [order[j], order[i]];
  for (const [index, id] of order.entries()) await supabase.from("training_modules").update({ order_index: index + 1 }).eq("id", id);
  refresh();
  return { ok: true };
}

/** Only a never-published module can be deleted (published ones have learner progress). Its folder goes with it. */
export async function deleteModule(moduleId: string): Promise<Result> {
  const me = await staff();
  if (!me) return { ok: false, error: "Only platform staff can edit training." };
  const admin = createAdminClient();
  const { data: mod } = await admin.from("training_modules").select("track_id, published_version, checked_out_by").eq("id", moduleId).single();
  if (!mod) return { ok: false, error: "Module not found." };
  if (mod.published_version > 0) return { ok: false, error: "A published module can't be deleted; learners may have progress in it." };
  if (mod.checked_out_by && mod.checked_out_by !== me.id) return { ok: false, error: "Someone is editing this module." };
  const files = [
    ...(await listFiles(admin, moduleFolder(mod.track_id as string, moduleId)).catch(() => [])),
    // The old builder's folder for this module.
    ...(await listFiles(admin, `modules/${moduleId}`).catch(() => [])),
  ];
  const { error } = await admin.from("training_modules").delete().eq("id", moduleId);
  if (error) return { ok: false, error: "Couldn't delete the module." };
  await removeFiles(admin, files);
  refresh();
  return { ok: true };
}

// ── Slides ─────────────────────────────────────────────────────────────

async function renumber(admin: AdminClient, moduleId: string, ids: string[]) {
  await Promise.all(ids.map((id, i) => admin.from("training_slides").update({ position: i + 1 }).eq("id", id).eq("module_id", moduleId)));
}

/** A new slide after `afterId` (or at the end), on the same topic as the slide before it. */
export async function addSlide(moduleId: string, token: string, afterId: string | null): Promise<Result<{ slide: Slide }>> {
  const e = await editing(moduleId, token);
  if (!e.ok) return e;
  const { data: rows } = await e.admin.from("training_slides").select("id, topic").eq("module_id", moduleId).order("position");
  const list = rows ?? [];
  const at = afterId ? list.findIndex((r) => r.id === afterId) + 1 : list.length;
  const before = list[at - 1];
  const { data, error } = await e.admin
    .from("training_slides")
    .insert({ module_id: moduleId, position: at + 1, topic: (before?.topic as string | undefined) ?? "" })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "Couldn't add a slide." };
  const ids = list.map((r) => r.id as string);
  ids.splice(at, 0, data.id as string);
  await renumber(e.admin, moduleId, ids);
  const slide = await readSlide(e.admin, moduleId, data.id as string);
  return slide ? { ok: true, slide } : { ok: false, error: "Couldn't add a slide." };
}

/** Save changes to one slide. Citations are checked against the library: only real sections can be cited. */
export async function updateSlide(moduleId: string, token: string, slideId: string, raw: unknown): Promise<Result<{ citations?: Citation[] }>> {
  const e = await editing(moduleId, token);
  if (!e.ok) return e;
  const patch = normalizeSlidePatch(raw);
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.topic !== undefined) row.topic = patch.topic;
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.body !== undefined) row.body = patch.body;
  if (patch.layout !== undefined) row.layout = patch.layout;
  if (patch.narrationScript !== undefined) row.narration_script = patch.narrationScript;
  if (patch.element !== undefined) row.element = patch.element;
  let citations: Citation[] | undefined;
  if (patch.citations !== undefined) {
    citations = await verifiedCitations(patch.citations.map((c) => c.chunkId));
    row.citations = citations;
  }
  const { data, error } = await e.admin.from("training_slides").update(row).eq("id", slideId).eq("module_id", moduleId).select("id");
  if (error) {
    console.error("[updateSlide]", error.message);
    return { ok: false, error: "Couldn't save the slide. Check your connection and try again." };
  }
  if (!data?.length) return { ok: false, error: "That slide no longer exists." };
  return { ok: true, citations };
}

export async function moveSlide(moduleId: string, token: string, slideId: string, direction: -1 | 1): Promise<Result> {
  const e = await editing(moduleId, token);
  if (!e.ok) return e;
  const { data: rows } = await e.admin.from("training_slides").select("id").eq("module_id", moduleId).order("position");
  const ids = (rows ?? []).map((r) => r.id as string);
  const i = ids.indexOf(slideId);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= ids.length) return { ok: true };
  [ids[i], ids[j]] = [ids[j], ids[i]];
  await renumber(e.admin, moduleId, ids);
  return { ok: true };
}

/** Delete a slide and its folder (unless learners' published copy still shows its files). */
export async function deleteSlide(moduleId: string, token: string, slideId: string): Promise<Result> {
  const e = await editing(moduleId, token);
  if (!e.ok) return e;
  const { error } = await e.admin.from("training_slides").delete().eq("id", slideId).eq("module_id", moduleId);
  if (error) return { ok: false, error: "Couldn't delete the slide." };
  const { data: rows } = await e.admin.from("training_slides").select("id").eq("module_id", moduleId).order("position");
  await renumber(e.admin, moduleId, (rows ?? []).map((r) => r.id as string));
  await tidyModuleFolder(e.admin, e.trackId, moduleId);
  return { ok: true };
}

// ── Media: every file in its slide's folder ────────────────────────────

/** Every file under a folder of the training-media bucket. */
async function listFiles(admin: AdminClient, prefix: string): Promise<string[]> {
  const out: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await admin.storage.from(MEDIA_BUCKET).list(prefix, { limit: 1000, offset });
    if (error) throw new Error(error.message);
    for (const item of data ?? []) {
      const path = `${prefix}/${item.name}`;
      // Folders come back without an id.
      if (item.id === null) out.push(...(await listFiles(admin, path)));
      else out.push(path);
    }
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function removeFiles(admin: AdminClient, paths: string[]) {
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await admin.storage.from(MEDIA_BUCKET).remove(paths.slice(i, i + 100));
    if (error) console.error("[removeFiles]", error.message);
  }
}

/**
 * Delete files in the module's folder that nothing uses: no slide's media,
 * and not the published copy learners are seeing. Runs after a slide or a
 * file is removed, and after publishing.
 */
async function tidyModuleFolder(admin: AdminClient, trackId: string, moduleId: string) {
  try {
    const [files, { data: media }, { data: mod }] = await Promise.all([
      listFiles(admin, moduleFolder(trackId, moduleId)),
      admin.from("training_media").select("path").eq("module_id", moduleId),
      admin.from("training_modules").select("published_version").eq("id", moduleId).maybeSingle(),
    ]);
    const keep = new Set((media ?? []).map((m) => m.path as string | null).filter(Boolean));
    let published = "";
    if (mod?.published_version) {
      const { data } = await admin
        .from("training_module_versions")
        .select("content")
        .eq("module_id", moduleId)
        .eq("version", mod.published_version)
        .maybeSingle();
      published = JSON.stringify(data?.content ?? "");
    }
    const unused = files.filter((p) => !keep.has(p) && !published.includes(p));
    if (unused.length) await removeFiles(admin, unused);
  } catch (err) {
    console.error("[tidyModuleFolder]", err instanceof Error ? err.message : err);
  }
}

/** Put a file on a slide as its picture/video or narration, replacing what was there. */
async function setMedia(
  admin: AdminClient,
  trackId: string,
  moduleId: string,
  slideId: string,
  m: { role: "visual" | "narration"; kind: "image" | "video" | "audio"; source: "upload" | "unsplash" | "link"; path: string | null; url: string; alt: string; credit: unknown; bytes?: number | null }
): Promise<Media> {
  await admin.from("training_media").delete().eq("slide_id", slideId).eq("role", m.role);
  const { data, error } = await admin
    .from("training_media")
    .insert({ slide_id: slideId, module_id: moduleId, role: m.role, kind: m.kind, source: m.source, path: m.path, url: m.url, alt: m.alt.slice(0, 500), credit: m.credit ?? null, bytes: m.bytes ?? null })
    .select("id, slide_id, role, kind, source, url, alt, credit")
    .single();
  if (error || !data) throw new Error(error?.message ?? "insert failed");
  await tidyModuleFolder(admin, trackId, moduleId);
  return toMedia(data as MediaRow);
}

const MEDIA_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/ogg": "ogg",
};

async function slideBelongs(admin: AdminClient, moduleId: string, slideId: string) {
  const { data } = await admin.from("training_slides").select("id").eq("id", slideId).eq("module_id", moduleId).maybeSingle();
  return Boolean(data);
}

/**
 * A one-time upload URL into the slide's folder, so large files go
 * straight from the browser to storage. Pictures and video become the
 * slide's visual; audio becomes its narration.
 */
export async function createSlideUpload(
  moduleId: string,
  token: string,
  slideId: string,
  file: { type: string; size: number }
): Promise<Result<{ path: string; token: string }>> {
  const e = await editing(moduleId, token);
  if (!e.ok) return e;
  if (!(await slideBelongs(e.admin, moduleId, slideId))) return { ok: false, error: "That slide no longer exists." };
  const ext = MEDIA_TYPES[file.type];
  if (!ext) return { ok: false, error: "Use a JPEG, PNG, WebP, GIF or SVG picture, an MP4, WebM or MOV video, or an MP3, M4A, WAV or OGG audio file." };
  const kind = file.type.split("/")[0];
  const limit = (kind === "video" ? 500 : kind === "audio" ? 100 : 20) * 1024 * 1024;
  if (file.size > limit)
    return { ok: false, error: kind === "video" ? "Videos can be up to 500 MB." : kind === "audio" ? "Audio files can be up to 100 MB." : "Pictures can be up to 20 MB." };
  const role = kind === "audio" ? "narration" : kind === "video" ? "video" : "picture";
  const path = `${slideFolder(e.trackId, moduleId, slideId)}/${role}-${randomUUID().slice(0, 8)}.${ext}`;
  const { data, error } = await e.admin.storage.from(MEDIA_BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    console.error("[createSlideUpload]", error?.message);
    return { ok: false, error: "Couldn't start the upload." };
  }
  return { ok: true, path: data.path, token: data.token };
}

/** The upload finished: put the file on the slide. */
export async function attachUpload(
  moduleId: string,
  token: string,
  slideId: string,
  input: { path: string; alt: string }
): Promise<Result<{ media: Media; slide: Slide | null }>> {
  const e = await editing(moduleId, token);
  if (!e.ok) return e;
  const folder = slideFolder(e.trackId, moduleId, slideId);
  if (!input.path.startsWith(`${folder}/`) || input.path.includes("..")) return { ok: false, error: "That file isn't in this slide's folder." };
  const ext = input.path.split(".").pop()?.toLowerCase() ?? "";
  const mime = Object.entries(MEDIA_TYPES).find(([, x]) => x === ext)?.[0] ?? "";
  const kind = mime.startsWith("video") ? "video" : mime.startsWith("audio") ? "audio" : mime.startsWith("image") ? "image" : null;
  if (!kind) return { ok: false, error: "That file type isn't supported." };
  const url = e.admin.storage.from(MEDIA_BUCKET).getPublicUrl(input.path).data.publicUrl;
  try {
    const media = await setMedia(e.admin, e.trackId, moduleId, slideId, {
      role: kind === "audio" ? "narration" : "visual",
      kind,
      source: "upload",
      path: input.path,
      url,
      alt: input.alt,
      credit: null,
    });
    // An uploaded recording is taken as matching the current script.
    if (kind === "audio") {
      const { data } = await e.admin.from("training_slides").select("narration_script").eq("id", slideId).single();
      await e.admin.from("training_slides").update({ narration_voiced: data?.narration_script ?? "" }).eq("id", slideId);
    }
    return { ok: true, media, slide: await readSlide(e.admin, moduleId, slideId) };
  } catch (err) {
    console.error("[attachUpload]", err instanceof Error ? err.message : err);
    return { ok: false, error: "The file uploaded but couldn't be added to the slide. Try again." };
  }
}

/** An Unsplash photo as the slide's picture (a link to Unsplash's copy, credited). */
export async function attachStockPhoto(
  moduleId: string,
  token: string,
  slideId: string,
  photo: { src: string; alt: string; credit: unknown; downloadLocation: string }
): Promise<Result<{ media: Media }>> {
  const e = await editing(moduleId, token);
  if (!e.ok) return e;
  if (!(await slideBelongs(e.admin, moduleId, slideId))) return { ok: false, error: "That slide no longer exists." };
  const url = safeMediaUrl(photo.src);
  const credit = normalizeCredit(photo.credit);
  if (!url || new URL(url).hostname !== "images.unsplash.com" || !credit) return { ok: false, error: "That photo can't be used." };
  try {
    await trackPhotoUse(photo.downloadLocation);
    const media = await setMedia(e.admin, e.trackId, moduleId, slideId, { role: "visual", kind: "image", source: "unsplash", path: null, url, alt: photo.alt, credit });
    return { ok: true, media };
  } catch (err) {
    if (err instanceof PhotoError) return { ok: false, error: err.message };
    console.error("[attachStockPhoto]", err instanceof Error ? err.message : err);
    return { ok: false, error: "Couldn't use that photo." };
  }
}

/** A YouTube or Vimeo video as the slide's visual. */
export async function attachVideoLink(moduleId: string, token: string, slideId: string, link: string): Promise<Result<{ media: Media }>> {
  const e = await editing(moduleId, token);
  if (!e.ok) return e;
  if (!(await slideBelongs(e.admin, moduleId, slideId))) return { ok: false, error: "That slide no longer exists." };
  const url = safeMediaUrl(link.trim());
  if (!url || videoSource(url)?.kind !== "embed") return { ok: false, error: "Paste a YouTube or Vimeo link (or upload a video file instead)." };
  try {
    const media = await setMedia(e.admin, e.trackId, moduleId, slideId, { role: "visual", kind: "video", source: "link", path: null, url, alt: "", credit: null });
    return { ok: true, media };
  } catch {
    return { ok: false, error: "Couldn't add the video." };
  }
}

/** The picture's description (alt text), or a video's caption. */
export async function updateMediaAlt(moduleId: string, token: string, mediaId: string, alt: string): Promise<Result> {
  const e = await editing(moduleId, token);
  if (!e.ok) return e;
  const { error } = await e.admin.from("training_media").update({ alt: alt.slice(0, 500) }).eq("id", mediaId).eq("module_id", moduleId);
  return error ? { ok: false, error: "Couldn't save the description." } : { ok: true };
}

/** Take the picture/video or narration off a slide; its file is deleted. */
export async function removeSlideMedia(moduleId: string, token: string, slideId: string, role: "visual" | "narration"): Promise<Result> {
  const e = await editing(moduleId, token);
  if (!e.ok) return e;
  const { error } = await e.admin.from("training_media").delete().eq("slide_id", slideId).eq("module_id", moduleId).eq("role", role);
  if (error) return { ok: false, error: "Couldn't remove it." };
  if (role === "narration") await e.admin.from("training_slides").update({ narration_voiced: "" }).eq("id", slideId);
  await tidyModuleFolder(e.admin, e.trackId, moduleId);
  return { ok: true };
}

// ── Narration (ElevenLabs) ─────────────────────────────────────────────

/**
 * Save the slide's script and voice it. The audio goes straight into the
 * slide's folder and onto the slide, so paid-for narration is never lost.
 */
export async function generateNarration(
  moduleId: string,
  token: string,
  slideId: string,
  script: string,
  voiceId: string
): Promise<Result<{ media: Media; voiced: string }>> {
  const e = await editing(moduleId, token);
  if (!e.ok) return e;
  const text = script.trim();
  if (!text) return { ok: false, error: "Write the narration script first." };
  if (text.length > 5000) return { ok: false, error: "That script is too long for one slide (5,000 characters at most)." };
  if (!/^[\w-]{1,64}$/.test(voiceId)) return { ok: false, error: "Choose a narration voice first (Module settings)." };
  if (!(await slideBelongs(e.admin, moduleId, slideId))) return { ok: false, error: "That slide no longer exists." };
  try {
    const audio = await speak(text, voiceId);
    const path = `${slideFolder(e.trackId, moduleId, slideId)}/narration-${randomUUID().slice(0, 8)}.mp3`;
    const { error } = await e.admin.storage.from(MEDIA_BUCKET).upload(path, audio, { contentType: "audio/mpeg" });
    if (error) {
      console.error("[generateNarration] upload", error.message);
      return { ok: false, error: "The audio was made but couldn't be saved. Try again." };
    }
    const url = e.admin.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
    await e.admin.from("training_slides").update({ narration_script: text, narration_voiced: text, updated_at: new Date().toISOString() }).eq("id", slideId);
    const media = await setMedia(e.admin, e.trackId, moduleId, slideId, { role: "narration", kind: "audio", source: "upload", path, url, alt: "", credit: null });
    return { ok: true, media, voiced: text };
  } catch (err) {
    return { ok: false, error: err instanceof NarrationError ? err.message : "Couldn't make the narration. Try again." };
  }
}

export interface EarlierNarration {
  path: string;
  url: string;
}

/**
 * Narration made with the old builder, still in the module's old folder
 * (modules/<id>/narration). Listen and choose: nothing is matched up
 * automatically.
 */
export async function listEarlierNarration(moduleId: string): Promise<Result<{ files: EarlierNarration[] }>> {
  if (!(await canAuthor(moduleId))) return { ok: false, error: "You can't edit this module." };
  const admin = createAdminClient();
  try {
    const files = await listFiles(admin, `modules/${moduleId}/narration`);
    return { ok: true, files: files.map((path) => ({ path, url: admin.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl })) };
  } catch {
    return { ok: true, files: [] };
  }
}

/** Copy an earlier narration file into the slide's folder and use it (it's taken as matching the current script). */
export async function applyEarlierNarration(moduleId: string, token: string, slideId: string, fromPath: string): Promise<Result<{ media: Media; voiced: string }>> {
  const e = await editing(moduleId, token);
  if (!e.ok) return e;
  if (!fromPath.startsWith(`modules/${moduleId}/narration/`) || fromPath.includes("..")) return { ok: false, error: "That file isn't this module's." };
  const { data: slide } = await e.admin.from("training_slides").select("narration_script").eq("id", slideId).eq("module_id", moduleId).maybeSingle();
  if (!slide) return { ok: false, error: "That slide no longer exists." };
  const to = `${slideFolder(e.trackId, moduleId, slideId)}/narration-${randomUUID().slice(0, 8)}.mp3`;
  const { error } = await e.admin.storage.from(MEDIA_BUCKET).copy(fromPath, to);
  if (error) return { ok: false, error: "Couldn't copy that file." };
  const voiced = (slide.narration_script as string) ?? "";
  await e.admin.from("training_slides").update({ narration_voiced: voiced }).eq("id", slideId);
  const url = e.admin.storage.from(MEDIA_BUCKET).getPublicUrl(to).data.publicUrl;
  const media = await setMedia(e.admin, e.trackId, moduleId, slideId, { role: "narration", kind: "audio", source: "upload", path: to, url, alt: "", credit: null });
  return { ok: true, media, voiced };
}

/** The voices on the ElevenLabs account. */
export async function getNarrationVoices(moduleId: string): Promise<Result<{ voices: Voice[] }>> {
  if (!(await canAuthor(moduleId))) return { ok: false, error: "You can't edit this module." };
  try {
    return { ok: true, voices: await listVoices() };
  } catch (e) {
    return { ok: false, error: e instanceof NarrationError ? e.message : "Couldn't load the voices." };
  }
}

/** A voice that isn't in the list, by its ElevenLabs voice ID. */
export async function findVoice(moduleId: string, voiceId: string): Promise<Result<{ voice: Voice }>> {
  if (!(await canAuthor(moduleId))) return { ok: false, error: "You can't edit this module." };
  try {
    const voice = await getVoice(voiceId.trim());
    if (!voice) return { ok: false, error: "ElevenLabs doesn't know that voice on this account. If it's from the Voice Library, add it to My Voices in ElevenLabs first." };
    return { ok: true, voice };
  } catch (e) {
    return { ok: false, error: e instanceof NarrationError ? e.message : "Couldn't look up that voice." };
  }
}

/** The voice every module uses unless it sets its own (0038). Super Admins only. */
export async function setDefaultVoice(voice: { id: string; name: string } | null): Promise<Result> {
  const me = await staff();
  if (!me) return { ok: false, error: "Only platform staff can set the default voice." };
  if (voice && !/^[\w-]{1,64}$/.test(voice.id)) return { ok: false, error: "That voice isn't valid." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("training_settings")
    .update({ narration_voice: voice ? { id: voice.id, name: voice.name.slice(0, 100) } : null, updated_at: new Date().toISOString(), updated_by: me.id })
    .eq("id", true);
  if (error) return { ok: false, error: "Couldn't save the default voice." };
  refresh();
  return { ok: true };
}

// ── Photos (Unsplash) ──────────────────────────────────────────────────

/** Photo search for a module's author, or (with no module, for a track's picture) a Super Admin. */
export async function searchStockPhotos(moduleId: string, query: string, page = 1): Promise<Result<{ photos: StockPhoto[]; totalPages: number }>> {
  if (!(moduleId ? await canAuthor(moduleId) : await staff())) return { ok: false, error: "You can't search photos here." };
  try {
    const r = await searchPhotos(query, Math.max(1, Math.min(20, Math.floor(page))));
    return { ok: true, photos: r.photos, totalPages: r.totalPages };
  } catch (e) {
    return { ok: false, error: e instanceof PhotoError ? e.message : "Photo search didn't work. Try again." };
  }
}

// ── Citations: Legislation Library sections only ───────────────────────

export interface LibraryHit extends Citation {
  snippet: string;
}

/**
 * Find library sections to cite: "45" or "s. 45" looks the section up by
 * number; anything else searches by meaning. Only module text goes to the
 * search (no one's details).
 */
export async function searchCitations(moduleId: string, query: string): Promise<Result<{ hits: LibraryHit[] }>> {
  if (!(await canAuthor(moduleId))) return { ok: false, error: "You can't edit this module." };
  const q = query.trim().slice(0, 300);
  if (!q) return { ok: true, hits: [] };
  try {
    const bySection = /^\s*(?:s(?:ection|\.)?\s*)?\d{1,3}(?:\.\d{1,3})?\s*$/i.test(q) ? await passagesForCitations([`s. ${q.replace(/[^\d.]/g, "")}`]) : [];
    const passages = bySection.length ? bySection : await searchLibrary([q], { perQuery: 12, threshold: 0.25, limit: 12 });
    return {
      ok: true,
      hits: passages.map((p) => ({ chunkId: p.id, label: labelFor(p.documentTitle, p.label), snippet: p.text.replace(/\s+/g, " ").slice(0, 280) })),
    };
  } catch (e) {
    console.error("[searchCitations]", e instanceof Error ? e.message : e);
    return { ok: false, error: "The library search didn't work. Try again." };
  }
}

// ── Review and publishing ──────────────────────────────────────────────

/** An Author hands a module to a Super Admin for publishing. */
export async function markReadyForReview(moduleId: string, ready: boolean): Promise<Result> {
  if (!(await canAuthor(moduleId))) return { ok: false, error: "You can't edit this module." };
  const { error } = await createAdminClient()
    .from("training_modules")
    .update({ ready_for_review_at: ready ? new Date().toISOString() : null })
    .eq("id", moduleId);
  if (error) return { ok: false, error: "Couldn't update the module." };
  refresh(moduleId);
  return { ok: true };
}

/** Publish the slides as they're saved. Not while someone else has the module checked out. */
export async function publishModule(moduleId: string): Promise<Result<{ version: number }>> {
  const me = await staff();
  if (!me) return { ok: false, error: "Only platform staff can publish training." };
  if (await heldByOther(moduleId, me.id)) return { ok: false, error: "Someone is editing this module. Publish once they've checked it in." };
  const admin = createAdminClient();
  const [{ data: mod }, { data: rows }, { data: media }] = await Promise.all([
    admin.from("training_modules").select("title, track_id, objectives, further_reading").eq("id", moduleId).maybeSingle(),
    admin.from("training_slides").select(SLIDE_COLUMNS).eq("module_id", moduleId),
    admin.from("training_media").select("id, slide_id, role, kind, source, url, alt, credit").eq("module_id", moduleId),
  ]);
  if (!mod) return { ok: false, error: "Module not found." };
  const info = { title: mod.title as string, objectives: normalizeObjectives(mod.objectives), furtherReading: normalizeFurtherReading(mod.further_reading) };
  const slides = toSlides((rows ?? []) as SlideRow[], (media ?? []) as MediaRow[]);
  const problems = publishProblems(info, slides);
  if (problems.length) return { ok: false, error: problems.join(" ") };
  const content = buildPlayerContent(info, slides);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("publish_training_module", { p_module_id: moduleId, p_content: content });
  if (error) {
    console.error("[publishModule]", error.message);
    return { ok: false, error: error.code === "P0001" ? error.message : "Couldn't publish." };
  }
  await admin.from("training_modules").update({ cover: coverOf(content) }).eq("id", moduleId);
  // Files only the previous published copy used can go now.
  await tidyModuleFolder(admin, mod.track_id as string, moduleId);
  refresh(moduleId);
  return { ok: true, version: data as number };
}

// ── Authors ────────────────────────────────────────────────────────────

/** Assign an Author to a module by email. They need a StrataCouncil.ca account. */
export async function addModuleAuthor(moduleId: string, email: string): Promise<Result> {
  const me = await staff();
  if (!me) return { ok: false, error: "Only platform staff can assign authors." };
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("id").ilike("email", email.trim()).maybeSingle();
  if (!profile) return { ok: false, error: "No StrataCouncil.ca account uses that email. Ask them to sign up first." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("training_module_authors")
    .upsert({ module_id: moduleId, user_id: profile.id, added_by: me.id }, { onConflict: "module_id,user_id" });
  if (error) return { ok: false, error: "Couldn't add the author." };
  refresh(moduleId);
  return { ok: true };
}

export async function removeModuleAuthor(moduleId: string, userId: string): Promise<Result> {
  if (!(await staff())) return { ok: false, error: "Only platform staff can assign authors." };
  const supabase = await createClient();
  const { error } = await supabase.from("training_module_authors").delete().eq("module_id", moduleId).eq("user_id", userId);
  if (error) return { ok: false, error: "Couldn't remove the author." };
  refresh(moduleId);
  return { ok: true };
}

// ── Demo links (0040) ──────────────────────────────────────────────────

/** A Council Training demo link: opens training without signing in, for outside feedback. */
export async function createDemoLink(input: { label: string; includeDrafts: boolean; expiresInDays: number | null }): Promise<Result<{ token: string }>> {
  const me = await staff();
  if (!me) return { ok: false, error: "Only platform staff can make demo links." };
  const label = input.label.trim().slice(0, 120);
  if (!label) return { ok: false, error: "Give the link a name, e.g. who it's for." };
  const token = randomBytes(18).toString("base64url");
  const days = input.expiresInDays && input.expiresInDays > 0 ? Math.min(365, Math.round(input.expiresInDays)) : null;
  const supabase = await createClient();
  const { error } = await supabase.from("training_demo_links").insert({
    token,
    label,
    include_drafts: input.includeDrafts,
    expires_at: days ? new Date(Date.now() + days * 86_400_000).toISOString() : null,
    created_by: me.id,
  });
  if (error) {
    console.error("[createDemoLink]", error.message);
    return { ok: false, error: "Couldn't make the link." };
  }
  revalidatePath("/admin/training");
  return { ok: true, token };
}

export async function revokeDemoLink(id: string): Promise<Result> {
  if (!(await staff())) return { ok: false, error: "Only platform staff can do this." };
  const supabase = await createClient();
  const { error } = await supabase.from("training_demo_links").update({ revoked_at: new Date().toISOString() }).eq("id", id);
  if (error) return { ok: false, error: "Couldn't turn the link off." };
  revalidatePath("/admin/training");
  return { ok: true };
}

export async function deleteDemoFeedback(id: string): Promise<Result> {
  if (!(await staff())) return { ok: false, error: "Only platform staff can do this." };
  const supabase = await createClient();
  const { error } = await supabase.from("training_feedback").delete().eq("id", id);
  if (error) return { ok: false, error: "Couldn't remove that comment." };
  revalidatePath("/admin/training");
  return { ok: true };
}
