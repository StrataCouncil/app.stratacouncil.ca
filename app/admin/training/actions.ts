"use server";

import { randomBytes, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/profile";
import { moduleCover, normalizeModuleContent, publishProblems, type Screen } from "@/lib/training/content";
import { applyTightened, onScreenWords, screenForTightening, TIGHTEN_INSTRUCTIONS, tightenSchema } from "@/lib/training/ai";
import { askClaudeJson } from "@/lib/ai/claude";
import { inngest, TRAINING_FACT_CHECK_EVENT } from "@/lib/inngest/client";
import { normalizeFactCheck, type FactCheck } from "@/lib/training/library";
import { getVoice, listVoices, NarrationError, speak, type Voice } from "@/lib/media/elevenlabs";
import { PhotoError, searchPhotos, trackPhotoUse, type StockPhoto } from "@/lib/media/unsplash";

/**
 * The Module Builder's writes. Super Admins do everything; Authors (0033,
 * assigned per module) can edit, upload media for, and mark ready for
 * review only the modules they're assigned. RLS on the training tables is
 * the real gate; the checks here just give clear messages.
 */

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

async function staff() {
  const profile = await getCurrentProfile();
  return profile?.isSuperAdmin ? profile : null;
}

async function canAuthor(moduleId: string) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("can_author_training_module", { p_module_id: moduleId });
  return data === true;
}

function refresh(moduleId?: string) {
  revalidatePath("/admin/training");
  revalidatePath("/build", "layout");
  revalidatePath("/training", "layout");
  if (moduleId) revalidatePath(`/admin/training/${moduleId}`);
}

/** Autosave: the whole module's sections, screens and blocks, cleaned up first. */
/**
 * Save the whole draft, but only over the version this editor last loaded or
 * saved (`base`, the draft's updated_at). If the draft changed since (an AI
 * build, another tab, an old copy of the page), nothing is overwritten and
 * the editor is told to reload.
 */
export async function saveModuleDraft(
  moduleId: string,
  content: unknown,
  base: string | null
): Promise<Result<{ savedAt: string }> | { ok: false; error: string; conflict: true }> {
  const me = await getCurrentProfile();
  if (!me || !(await canAuthor(moduleId))) return { ok: false, error: "You can't edit this module." };
  const clean = normalizeModuleContent(content);
  const supabase = await createClient();
  const { data: current, error: readError } = await supabase.from("training_module_drafts").select("updated_at").eq("module_id", moduleId).maybeSingle();
  if (readError || !current) {
    if (readError) console.error("[saveModuleDraft]", readError.message);
    return { ok: false, error: "Couldn't save. Your changes are still here; they'll save with your next edit." };
  }
  // Compared as instants (to the millisecond), however the timestamp happens to be written.
  if (base && current.updated_at && Date.parse(current.updated_at as string) !== Date.parse(base)) {
    return {
      ok: false,
      conflict: true,
      error: "This module was changed somewhere else (another tab, an AI build, or an older copy of this page). Reload to get the latest version.",
    };
  }
  const savedAt = new Date().toISOString();
  const { error } = await supabase
    .from("training_module_drafts")
    .update({ content: clean, updated_at: savedAt, updated_by: me.id })
    .eq("module_id", moduleId);
  if (error) {
    console.error("[saveModuleDraft]", error.message);
    return { ok: false, error: "Couldn't save. Your changes are still here; they'll save with your next edit." };
  }
  return { ok: true, savedAt };
}

/** When the saved draft last changed: the builder compares it with what it has open. */
export async function getDraftStamp(moduleId: string): Promise<Result<{ updatedAt: string | null }>> {
  if (!(await canAuthor(moduleId))) return { ok: false, error: "You can't see this module." };
  const supabase = await createClient();
  const { data } = await supabase.from("training_module_drafts").select("updated_at").eq("module_id", moduleId).maybeSingle();
  return { ok: true, updatedAt: (data?.updated_at as string | null) ?? null };
}

export async function publishModule(moduleId: string): Promise<Result<{ version: number }>> {
  if (!(await staff())) return { ok: false, error: "Only platform staff can publish training." };
  const supabase = await createClient();
  const { data: draft } = await supabase.from("training_module_drafts").select("content").eq("module_id", moduleId).maybeSingle();
  const content = normalizeModuleContent(draft?.content);
  const problems = publishProblems(content);
  if (problems.length) return { ok: false, error: problems.join(" ") };
  const { data, error } = await supabase.rpc("publish_training_module", { p_module_id: moduleId });
  if (error) {
    console.error("[publishModule]", error.message);
    return { ok: false, error: error.code === "P0001" ? error.message : "Couldn't publish." };
  }
  // The card photo on the training pages follows the published first screen.
  const { error: coverError } = await supabase.from("training_modules").update({ cover: moduleCover(content) }).eq("id", moduleId);
  if (coverError) console.error("[publishModule] cover", coverError.message);
  refresh(moduleId);
  return { ok: true, version: data as number };
}

export async function updateModuleDetails(
  moduleId: string,
  input: { title: string; summary: string; estimatedMinutes: number | null }
): Promise<Result> {
  if (!(await staff())) return { ok: false, error: "Only platform staff can edit training." };
  const title = input.title.trim().slice(0, 200);
  if (!title) return { ok: false, error: "Give the module a title." };
  const minutes =
    input.estimatedMinutes && Number.isFinite(input.estimatedMinutes)
      ? Math.max(1, Math.min(600, Math.round(input.estimatedMinutes)))
      : null;
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
  const { error } = await supabase
    .from("training_tracks")
    .update({ title, description: input.description.trim().slice(0, 1000) })
    .eq("id", trackId);
  if (error) return { ok: false, error: "Couldn't save the track details." };
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
  await supabase.from("training_module_drafts").insert({ module_id: data.id });
  refresh();
  return { ok: true, id: data.id };
}

/** Swap a module with its neighbour in the track. */
export async function moveModule(moduleId: string, direction: -1 | 1): Promise<Result> {
  if (!(await staff())) return { ok: false, error: "Only platform staff can edit training." };
  const supabase = await createClient();
  const { data: mod } = await supabase.from("training_modules").select("id, track_id, order_index").eq("id", moduleId).single();
  if (!mod) return { ok: false, error: "Module not found." };
  const { data: siblings } = await supabase
    .from("training_modules")
    .select("id, order_index")
    .eq("track_id", mod.track_id)
    .order("order_index");
  const list = siblings ?? [];
  const i = list.findIndex((m) => m.id === moduleId);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= list.length) return { ok: true };
  // Renumber the whole track so ties never stick.
  const order = list.map((m) => m.id);
  [order[i], order[j]] = [order[j], order[i]];
  for (const [index, id] of order.entries()) {
    await supabase.from("training_modules").update({ order_index: index + 1 }).eq("id", id);
  }
  refresh();
  return { ok: true };
}

/** Only a never-published module can be deleted (published ones have learner progress). */
export async function deleteModule(moduleId: string): Promise<Result> {
  if (!(await staff())) return { ok: false, error: "Only platform staff can edit training." };
  const supabase = await createClient();
  const { data: mod } = await supabase.from("training_modules").select("published_version").eq("id", moduleId).single();
  if (!mod) return { ok: false, error: "Module not found." };
  if (mod.published_version > 0) return { ok: false, error: "A published module can't be deleted; learners may have progress in it." };
  const { error } = await supabase.from("training_modules").delete().eq("id", moduleId);
  if (error) return { ok: false, error: "Couldn't delete the module." };
  // Its media folder goes with it.
  const admin = createAdminClient();
  const files = await listMedia(admin, moduleFolder(moduleId)).catch(() => []);
  if (files.length) await admin.storage.from(MEDIA_BUCKET).remove(files.map((f) => f.path));
  refresh();
  return { ok: true };
}

const MEDIA_BUCKET = "training-media";

/** Each module's media lives in its own folder: modules/<id>/{images,video,audio,narration}/. */
const moduleFolder = (moduleId: string) => `modules/${moduleId}`;

type AdminClient = ReturnType<typeof createAdminClient>;

/** Every file under a folder of the training-media bucket, with when it was made. */
async function listMedia(admin: AdminClient, prefix = ""): Promise<{ path: string; size: number; createdAt: string | null }[]> {
  const out: { path: string; size: number; createdAt: string | null }[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await admin.storage.from(MEDIA_BUCKET).list(prefix, { limit: 1000, offset });
    if (error) throw new Error(error.message);
    for (const item of data ?? []) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      // Folders come back without an id.
      if (item.id === null) out.push(...(await listMedia(admin, path)));
      else out.push({ path, size: Number((item.metadata as { size?: number } | null)?.size ?? 0), createdAt: item.created_at ?? null });
    }
    if (!data || data.length < 1000) break;
  }
  return out;
}

/**
 * Files in training-media that no module uses: not in any draft, published
 * version or card photo. Files from the last day are left alone (an upload
 * may not be saved into a draft yet).
 */
async function unusedMedia(admin: AdminClient) {
  const [files, drafts, versions, modules] = await Promise.all([
    listMedia(admin),
    admin.from("training_module_drafts").select("content"),
    admin.from("training_module_versions").select("content"),
    admin.from("training_modules").select("cover"),
  ]);
  if (drafts.error || versions.error || modules.error) throw new Error("Couldn't read the modules.");
  const used = JSON.stringify([drafts.data, versions.data, modules.data]);
  const marker = `/storage/v1/object/public/${MEDIA_BUCKET}/`;
  const referenced = new Set<string>();
  for (let at = used.indexOf(marker); at >= 0; at = used.indexOf(marker, at + 1)) {
    const rest = used.slice(at + marker.length);
    const path = rest.slice(0, rest.search(/["?#\\]|$/));
    try {
      referenced.add(decodeURIComponent(path));
    } catch {
      referenced.add(path);
    }
  }
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  return files.filter((f) => !referenced.has(f.path) && !(f.createdAt && Date.parse(f.createdAt) > dayAgo));
}

/** How many media files no module uses, and their size (Super Admin, Council Training admin page). */
export async function findUnusedMedia(): Promise<Result<{ count: number; bytes: number }>> {
  if (!(await staff())) return { ok: false, error: "Only platform staff can do this." };
  try {
    const files = await unusedMedia(createAdminClient());
    return { ok: true, count: files.length, bytes: files.reduce((n, f) => n + f.size, 0) };
  } catch (e) {
    console.error("[findUnusedMedia]", e instanceof Error ? e.message : e);
    return { ok: false, error: "Couldn't check storage. Try again." };
  }
}

/** Delete the media files no module uses (worked out again at the moment of deleting). */
export async function deleteUnusedMedia(): Promise<Result<{ deleted: number }>> {
  if (!(await staff())) return { ok: false, error: "Only platform staff can do this." };
  try {
    const admin = createAdminClient();
    const files = await unusedMedia(admin);
    for (let i = 0; i < files.length; i += 100) {
      const { error } = await admin.storage.from(MEDIA_BUCKET).remove(files.slice(i, i + 100).map((f) => f.path));
      if (error) throw new Error(error.message);
    }
    return { ok: true, deleted: files.length };
  } catch (e) {
    console.error("[deleteUnusedMedia]", e instanceof Error ? e.message : e);
    return { ok: false, error: "Couldn't delete the unused files. Try again." };
  }
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

/**
 * A one-time upload URL for an image or video file, so large files go
 * straight from the browser to Storage. The bucket is public-read; the
 * returned URL is what the block stores.
 */
export async function createMediaUpload(
  moduleId: string,
  file: { type: string; size: number }
): Promise<Result<{ path: string; token: string; publicUrl: string }>> {
  if (!(await canAuthor(moduleId))) return { ok: false, error: "You can't upload media for this module." };
  const ext = MEDIA_TYPES[file.type];
  if (!ext)
    return { ok: false, error: "Use a JPEG, PNG, WebP, GIF or SVG image, an MP4, WebM or MOV video, or an MP3, M4A, WAV or OGG audio file." };
  const kind = file.type.split("/")[0];
  const limit = (kind === "video" ? 500 : kind === "audio" ? 100 : 20) * 1024 * 1024;
  if (file.size > limit)
    return { ok: false, error: kind === "video" ? "Videos can be up to 500 MB." : kind === "audio" ? "Audio files can be up to 100 MB." : "Images can be up to 20 MB." };

  const admin = createAdminClient();
  const path = `${moduleFolder(moduleId)}/${kind === "image" ? "images" : kind}/${randomUUID()}.${ext}`;
  const { data, error } = await admin.storage.from(MEDIA_BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    console.error("[createMediaUpload]", error?.message);
    return { ok: false, error: "Couldn't start the upload." };
  }
  const { data: pub } = admin.storage.from(MEDIA_BUCKET).getPublicUrl(path);
  return { ok: true, path: data.path, token: data.token, publicUrl: pub.publicUrl };
}

/** An Author hands a draft to a Super Admin for publishing. */
export async function markReadyForReview(moduleId: string, ready: boolean): Promise<Result> {
  if (!(await canAuthor(moduleId))) return { ok: false, error: "You can't edit this module." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("training_module_drafts")
    .update({ ready_for_review_at: ready ? new Date().toISOString() : null })
    .eq("module_id", moduleId);
  if (error) return { ok: false, error: "Couldn't update the module." };
  refresh(moduleId);
  return { ok: true };
}

/** Assign an Author to a module by email. They need a StrataCouncil.ca account. */
export async function addModuleAuthor(moduleId: string, email: string): Promise<Result> {
  const me = await staff();
  if (!me) return { ok: false, error: "Only platform staff can assign authors." };
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("id")
    .ilike("email", email.trim())
    .maybeSingle();
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

// ── Narration (ElevenLabs) and stock photos (Unsplash) ─────────────────

/** The voices on the ElevenLabs account, for the module's narration voice. */
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
    if (!voice)
      return {
        ok: false,
        error: "ElevenLabs doesn't know that voice on this account. If it's from the Voice Library, add it to My Voices in ElevenLabs first.",
      };
    return { ok: true, voice };
  } catch (e) {
    return { ok: false, error: e instanceof NarrationError ? e.message : "Couldn't look up that voice." };
  }
}

/** The narration voice every module uses unless it sets its own (0038). Super Admins only. */
export async function setDefaultVoice(voice: { id: string; name: string } | null): Promise<Result> {
  const me = await staff();
  if (!me) return { ok: false, error: "Only platform staff can set the default voice." };
  if (voice && !/^[\w-]{1,64}$/.test(voice.id)) return { ok: false, error: "That voice isn't valid." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("training_settings")
    .update({ narration_voice: voice ? { id: voice.id, name: voice.name.slice(0, 100) } : null, updated_at: new Date().toISOString(), updated_by: me.id })
    .eq("id", true);
  if (error) {
    console.error("[setDefaultVoice]", error.message);
    return { ok: false, error: "Couldn't save the default voice." };
  }
  refresh();
  return { ok: true };
}

/**
 * Voice one screen's narration script and store the MP3 with the module's
 * other media. The builder puts the returned URL on the screen and records
 * which script it was made from.
 */
export async function generateNarration(
  moduleId: string,
  text: string,
  voiceId: string
): Promise<Result<{ url: string; voicedText: string }>> {
  if (!(await canAuthor(moduleId))) return { ok: false, error: "You can't edit this module." };
  const script = text.trim();
  if (!script) return { ok: false, error: "Write the narration script first." };
  if (script.length > 5000) return { ok: false, error: "That script is too long for one screen (5,000 characters at most)." };
  try {
    const audio = await speak(script, voiceId);
    const path = `${moduleFolder(moduleId)}/narration/${randomUUID()}.mp3`;
    const admin = createAdminClient();
    const { error } = await admin.storage.from(MEDIA_BUCKET).upload(path, audio, { contentType: "audio/mpeg" });
    if (error) {
      console.error("[generateNarration] upload", error.message);
      return { ok: false, error: "The audio was made but couldn't be saved. Try again." };
    }
    return { ok: true, url: admin.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl, voicedText: script };
  } catch (e) {
    return { ok: false, error: e instanceof NarrationError ? e.message : "Couldn't make the narration. Try again." };
  }
}

export async function searchStockPhotos(
  moduleId: string,
  query: string,
  page = 1
): Promise<Result<{ photos: StockPhoto[]; totalPages: number }>> {
  if (!(await canAuthor(moduleId))) return { ok: false, error: "You can't edit this module." };
  try {
    const r = await searchPhotos(query, Math.max(1, Math.min(20, Math.floor(page))));
    return { ok: true, photos: r.photos, totalPages: r.totalPages };
  } catch (e) {
    return { ok: false, error: e instanceof PhotoError ? e.message : "Photo search didn't work. Try again." };
  }
}

/** An author chose a photo: tell Unsplash, as their guidelines require. */
export async function chooseStockPhoto(moduleId: string, downloadLocation: string): Promise<Result> {
  if (!(await canAuthor(moduleId))) return { ok: false, error: "You can't edit this module." };
  try {
    await trackPhotoUse(downloadLocation);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof PhotoError ? e.message : "Couldn't use that photo." };
  }
}

// ── Tighten with AI ────────────────────────────────────────────────────

/**
 * Rewrite one screen's on-screen text so it reads at a glance while the
 * narration plays. Only the text-type blocks change: the narration script
 * (and so any audio made from it), questions, scenarios and media are kept
 * exactly as they are. Course text only; no one's details are involved.
 */
/** On-screen words the builder aims for (it flags screens over this). */
const TIGHTEN_TARGET = 45;

export async function tightenScreen(moduleId: string, raw: unknown): Promise<Result<{ screen: Screen; before: number; after: number }>> {
  if (!(await canAuthor(moduleId))) return { ok: false, error: "You can't edit this module." };
  const screen = normalizeModuleContent({ sections: [{ id: "s", title: "s", screens: [raw] }] }).sections[0]?.screens[0];
  if (!screen) return { ok: false, error: "That screen couldn't be read." };
  const before = onScreenWords(screen);
  if (!screenForTightening(screen).length) return { ok: true, screen, before, after: before };
  try {
    // A second, firmer pass when the first leaves it over the target.
    let current = screen;
    for (let pass = 0; pass < 2 && onScreenWords(current) > TIGHTEN_TARGET; pass++) {
      const words = onScreenWords(current);
      const result = await askClaudeJson<unknown>({
        system: TIGHTEN_INSTRUCTIONS,
        messages: [
          {
            role: "user",
            content: `Screen title: ${current.title}\n\nNarration (read aloud with the screen):\n${current.narration.transcript || "(none)"}\n\nCurrent on-screen blocks (${words} words; bring them to 40 or fewer${pass ? ". The last rewrite was still too long: cut harder, merge or drop blocks, and leave detail to the narration" : ""}):\n${JSON.stringify(screenForTightening(current), null, 1)}`,
          },
        ],
        schema: tightenSchema,
        effort: "low",
        maxTokens: 8000,
      });
      const next = applyTightened(current, result);
      if (onScreenWords(next) >= words) break;
      current = next;
    }
    return { ok: true, screen: current, before, after: onScreenWords(current) };
  } catch (e) {
    console.error("[tightenScreen]", e instanceof Error ? e.message : e);
    return { ok: false, error: "The AI couldn't tighten this screen. Try again." };
  }
}

/**
 * Check the module's saved draft against the Legislation Library (0037).
 * Runs in the background; getFactCheck reports progress and the result.
 */
export async function startFactCheck(moduleId: string): Promise<Result> {
  if (!(await staff())) return { ok: false, error: "Only platform staff can run a fact check." };
  const admin = createAdminClient();
  const { data: mod } = await admin.from("training_module_drafts").select("fact_check").eq("module_id", moduleId).maybeSingle();
  if (!mod) return { ok: false, error: "That module wasn't found." };
  const current = normalizeFactCheck(mod.fact_check);
  if (current?.status === "checking" && Date.now() - Date.parse(current.checkedAt) < 15 * 60_000)
    return { ok: false, error: "A check is already running." };
  // Show it as started right away (before queuing, so the job's own progress isn't overwritten).
  await admin
    .from("training_module_drafts")
    .update({ fact_check: { status: "checking", checkedAt: new Date().toISOString(), draftUpdatedAt: null, sectionsDone: 0, sectionsTotal: 0, issues: [] } })
    .eq("module_id", moduleId);
  try {
    await inngest.send({ name: TRAINING_FACT_CHECK_EVENT, data: { moduleId } });
  } catch (err) {
    console.error("[startFactCheck]", err instanceof Error ? err.message : err);
    await admin.from("training_module_drafts").update({ fact_check: mod.fact_check }).eq("module_id", moduleId);
    return { ok: false, error: "Couldn't start the check. Try again." };
  }
  return { ok: true };
}

export async function getFactCheck(moduleId: string): Promise<Result<{ check: FactCheck | null }>> {
  if (!(await canAuthor(moduleId))) return { ok: false, error: "You can't see this module." };
  const { data } = await createAdminClient().from("training_module_drafts").select("fact_check").eq("module_id", moduleId).maybeSingle();
  return { ok: true, check: normalizeFactCheck(data?.fact_check) };
}

/** Set a fact-check note aside as checked by hand, or bring it back. */
export async function markFactIssue(moduleId: string, index: number, checked: boolean): Promise<Result<{ check: FactCheck | null }>> {
  if (!(await canAuthor(moduleId))) return { ok: false, error: "You can't edit this module." };
  const admin = createAdminClient();
  const { data } = await admin.from("training_module_drafts").select("fact_check").eq("module_id", moduleId).maybeSingle();
  const check = normalizeFactCheck(data?.fact_check);
  if (!check || check.status === "checking" || !check.issues[index]) return { ok: false, error: "That note has changed. Reload the page." };
  const issues = check.issues.map((i, n) => (n === index ? { ...i, checkedByHand: checked || undefined } : i));
  const next = { ...check, issues };
  const { error } = await admin.from("training_module_drafts").update({ fact_check: next }).eq("module_id", moduleId);
  if (error) return { ok: false, error: "Couldn't save that. Try again." };
  return { ok: true, check: next };
}

/** A Council Training demo link (0040): opens training without signing in, for outside feedback. */
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
