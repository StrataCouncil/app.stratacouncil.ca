"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/profile";
import { normalizeModuleContent, publishProblems } from "@/lib/training/content";

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
export async function saveModuleDraft(moduleId: string, content: unknown): Promise<Result<{ savedAt: string }>> {
  const me = await getCurrentProfile();
  if (!me || !(await canAuthor(moduleId))) return { ok: false, error: "You can't edit this module." };
  const clean = normalizeModuleContent(content);
  const savedAt = new Date().toISOString();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("training_module_drafts")
    .update({ content: clean, updated_at: savedAt, updated_by: me.id })
    .eq("module_id", moduleId)
    .select("module_id");
  if (error || !data?.length) {
    if (error) console.error("[saveModuleDraft]", error.message);
    return { ok: false, error: "Couldn't save. Your changes are still here; they'll save with your next edit." };
  }
  return { ok: true, savedAt };
}

export async function publishModule(moduleId: string): Promise<Result<{ version: number }>> {
  if (!(await staff())) return { ok: false, error: "Only platform staff can publish training." };
  const supabase = await createClient();
  const { data: draft } = await supabase.from("training_module_drafts").select("content").eq("module_id", moduleId).maybeSingle();
  const problems = publishProblems(normalizeModuleContent(draft?.content));
  if (problems.length) return { ok: false, error: problems.join(" ") };
  const { data, error } = await supabase.rpc("publish_training_module", { p_module_id: moduleId });
  if (error) {
    console.error("[publishModule]", error.message);
    return { ok: false, error: error.code === "P0001" ? error.message : "Couldn't publish." };
  }
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
  refresh();
  return { ok: true };
}

const MEDIA_BUCKET = "training-media";
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
  const path = `${new Date().getFullYear()}/${randomUUID()}.${ext}`;
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
