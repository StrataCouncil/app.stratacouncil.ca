"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/data/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { inngest, TRAINING_IMPORT_BUILD_EVENT, TRAINING_IMPORT_PLAN_EVENT } from "@/lib/inngest/client";
import { normalizePlan, parseSources, TRAINING_IMPORT_BUCKET, type ImportSourceRecord } from "@/lib/training/ai";
import { titleFromFileName } from "@/lib/legislation";

/**
 * The AI module builder's writes, Super Admins only (RLS on
 * training_imports agrees). Uploads go straight to the private
 * training-imports bucket with a signed URL; the background jobs in
 * lib/inngest/training-import.ts do the reading and writing.
 */

type Fail = { ok: false; error: string };
const notAllowed: Fail = { ok: false, error: "Only Super Admins can build training from documents." };
const EXTENSIONS = ["pdf", "docx", "txt", "html", "htm"];
const MAX_BYTES = 50 * 1024 * 1024;

function refresh(id?: string) {
  revalidatePath("/admin/training/ai");
  if (id) revalidatePath(`/admin/training/ai/${id}`);
}

async function queue(name: string, importId: string) {
  try {
    await inngest.send({ name, data: { importId } });
    return true;
  } catch (err) {
    console.error("[training import queue]", err instanceof Error ? err.message : err);
    return false;
  }
}

export async function createImportUpload(file: { name: string; size: number }): Promise<{ ok: true; path: string; token: string } | Fail> {
  if (!(await requireSuperAdmin())) return notAllowed;
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  if (!EXTENSIONS.includes(ext)) return { ok: false, error: "Use a PDF, Word (.docx), HTML or text file." };
  if (file.size > MAX_BYTES) return { ok: false, error: "Files can be up to 50 MB." };
  const safe = file.name.normalize("NFKD").replace(/[^\w.\- ]+/g, "").replace(/\s+/g, "_").slice(-120) || "document";
  const path = `${randomUUID()}/${safe}`;
  const { data, error } = await createAdminClient().storage.from(TRAINING_IMPORT_BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    console.error("[createImportUpload]", error?.message);
    return { ok: false, error: "Couldn't start the upload. Please try again." };
  }
  return { ok: true, path, token: data.token };
}

export type ImportSource =
  | { kind: "upload"; path: string; fileName: string; mimeType: string }
  | { kind: "library"; legislationId: string };

export async function startImport(input: {
  sources: ImportSource[];
  title: string;
  trackId: string | null;
  instructions: string;
  /** Write this curriculum module (0036) instead of proposing new ones. */
  moduleId?: string | null;
}): Promise<{ ok: true; id: string } | Fail> {
  const auth = await requireSuperAdmin();
  if (!auth) return notAllowed;
  if (!input.sources.length) return { ok: false, error: "Add at least one document." };
  if (input.sources.length > 5) return { ok: false, error: "Use up to five documents at a time." };
  const admin = createAdminClient();

  const sources: ImportSourceRecord[] = [];
  for (const src of input.sources) {
    if (src.kind === "upload") {
      const parts = src.path.split("/");
      if (parts.length !== 2 || parts.some((p) => !p || p === "..")) return { ok: false, error: "That upload isn't valid." };
      const { data: listed } = await admin.storage.from(TRAINING_IMPORT_BUCKET).list(parts[0], { search: parts[1] });
      if (!listed?.some((o) => o.name === parts[1])) return { ok: false, error: `${src.fileName} didn't finish uploading. Please try again.` };
      sources.push({ kind: "upload", path: src.path, fileName: src.fileName.slice(0, 300), mimeType: src.mimeType || null });
    } else {
      const { data: doc } = await auth.supabase.from("legislation_documents").select("id, title").eq("id", src.legislationId).maybeSingle();
      if (!doc) return { ok: false, error: "A library entry you chose wasn't found." };
      sources.push({ kind: "library", legislationId: doc.id, title: doc.title });
    }
  }
  let target: { id: string; title: string; trackId: string } | null = null;
  if (input.moduleId) {
    const { data: mod } = await auth.supabase.from("training_modules").select("id, title, track_id").eq("id", input.moduleId).maybeSingle();
    if (!mod) return { ok: false, error: "That module wasn't found." };
    target = { id: mod.id, title: mod.title, trackId: mod.track_id };
  }
  const first = sources[0];
  const fallbackTitle = target?.title ?? (first.kind === "upload" ? titleFromFileName(first.fileName) : first.title);

  const { data, error } = await auth.supabase
    .from("training_imports")
    .insert({
      title: (input.title.trim() || fallbackTitle).slice(0, 200),
      sources,
      track_id: target?.trackId ?? (input.trackId || null),
      module_id: target?.id ?? null,
      instructions: input.instructions.trim().slice(0, 2000),
      created_by: auth.user.id,
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("[startImport]", error?.message);
    return { ok: false, error: "Couldn't start. Please try again." };
  }
  if (!(await queue(TRAINING_IMPORT_PLAN_EVENT, data.id))) {
    await auth.supabase.from("training_imports").update({ status: "failed", error: "Couldn't start the background job. Try again." }).eq("id", data.id);
  }
  refresh(data.id);
  return { ok: true, id: data.id };
}

/** Save the reviewed plan: titles, tracks, objectives, and which modules to build. */
export async function savePlan(importId: string, plan: unknown): Promise<{ ok: true } | Fail> {
  const auth = await requireSuperAdmin();
  if (!auth) return notAllowed;
  const { data: imp } = await auth.supabase.from("training_imports").select("status").eq("id", importId).maybeSingle();
  if (!imp) return { ok: false, error: "That import wasn't found." };
  if (imp.status === "building") return { ok: false, error: "The modules are being written; wait until that finishes." };
  const { error } = await auth.supabase
    .from("training_imports")
    .update({ plan: normalizePlan(plan), updated_at: new Date().toISOString() })
    .eq("id", importId);
  if (error) return { ok: false, error: "Couldn't save your changes." };
  refresh(importId);
  return { ok: true };
}

/** Write the chosen modules (any not already written). */
export async function buildImport(importId: string, plan: unknown): Promise<{ ok: true } | Fail> {
  const auth = await requireSuperAdmin();
  if (!auth) return notAllowed;
  const tidy = normalizePlan(plan);
  if (!tidy.modules.some((m) => m.include && m.status !== "done")) return { ok: false, error: "Choose at least one module to build." };
  if (tidy.modules.some((m) => m.include && (!m.title.trim() || m.sections.length === 0)))
    return { ok: false, error: "Every module you build needs a title and at least one section." };
  const { error } = await auth.supabase
    .from("training_imports")
    .update({ plan: tidy, status: "building", error: null, updated_at: new Date().toISOString() })
    .eq("id", importId)
    .in("status", ["planned", "built", "failed"]);
  if (error) return { ok: false, error: "Couldn't start building." };
  if (!(await queue(TRAINING_IMPORT_BUILD_EVENT, importId))) {
    await auth.supabase.from("training_imports").update({ status: "failed", error: "Couldn't start the background job. Try again." }).eq("id", importId);
    refresh(importId);
    return { ok: false, error: "Couldn't start the background job. Try again." };
  }
  refresh(importId);
  return { ok: true };
}

/** Start again after a failure: re-plan if there's no plan yet, otherwise carry on building. */
export async function retryImport(importId: string): Promise<{ ok: true } | Fail> {
  const auth = await requireSuperAdmin();
  if (!auth) return notAllowed;
  const { data: imp } = await auth.supabase.from("training_imports").select("plan").eq("id", importId).maybeSingle();
  if (!imp) return { ok: false, error: "That import wasn't found." };
  const plan = imp.plan ? normalizePlan(imp.plan) : null;
  const rebuild = Boolean(plan?.modules.some((m) => m.status === "building" || m.status === "done"));
  await auth.supabase
    .from("training_imports")
    .update({ status: rebuild ? "building" : "queued", error: null, updated_at: new Date().toISOString() })
    .eq("id", importId);
  await queue(rebuild ? TRAINING_IMPORT_BUILD_EVENT : TRAINING_IMPORT_PLAN_EVENT, importId);
  refresh(importId);
  return { ok: true };
}

/** Remove an import and its uploaded file. Modules it already drafted stay. */
export async function deleteImport(importId: string): Promise<{ ok: true } | Fail> {
  const auth = await requireSuperAdmin();
  if (!auth) return notAllowed;
  const { data: imp } = await auth.supabase.from("training_imports").select("sources").eq("id", importId).maybeSingle();
  if (!imp) return { ok: false, error: "That import wasn't found." };
  const paths = parseSources(imp.sources).flatMap((s) => (s.kind === "upload" ? [s.path] : []));
  if (paths.length) await createAdminClient().storage.from(TRAINING_IMPORT_BUCKET).remove(paths);
  await auth.supabase.from("training_imports").delete().eq("id", importId);
  refresh();
  return { ok: true };
}
