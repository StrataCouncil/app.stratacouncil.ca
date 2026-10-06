"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/data/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { queueLegislationIndexing } from "@/lib/kb/queue";

import {
  isLegislationKind,
  LEGISLATION_BUCKET,
  LEGISLATION_EXTENSIONS,
  MAX_LEGISLATION_BYTES,
  type LegislationKind,
} from "@/lib/legislation";

/**
 * The legislation library (doc04 §5), Super Admins only. Upload works like
 * the document repository: signed upload URLs into the private
 * `legislation` bucket, then rows written through the Super Admin's own
 * client (RLS checks is_super_admin) and queued for indexing.
 */

type Fail = { ok: false; error: string };
type Done = { ok: true } | Fail;
const notAllowed: Fail = { ok: false, error: "Only Super Admins can manage the Legislation Library." };

function extensionOf(name: string) {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

function safeFileName(name: string) {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "")
    .replace(/\s+/g, "_")
    .slice(-120);
  return cleaned || "document";
}

function cleanDate(v: string | null | undefined) {
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

export async function createLegislationUploads(
  files: { name: string; size: number }[]
): Promise<{ ok: true; tickets: { name: string; path: string; token: string }[] } | Fail> {
  if (!(await requireSuperAdmin())) return notAllowed;
  if (!files.length || files.length > 20) return { ok: false, error: "Choose up to 20 files at a time." };
  for (const f of files) {
    if (!(LEGISLATION_EXTENSIONS as readonly string[]).includes(extensionOf(f.name))) {
      return { ok: false, error: `${f.name}: only PDF, Word (.docx), HTML and text files can be indexed.` };
    }
    if (f.size > MAX_LEGISLATION_BYTES) return { ok: false, error: `${f.name} is over 50 MB.` };
  }
  const admin = createAdminClient();
  const tickets = [];
  for (const f of files) {
    const path = `${randomUUID()}/${safeFileName(f.name)}`;
    const { data, error } = await admin.storage.from(LEGISLATION_BUCKET).createSignedUploadUrl(path);
    if (error || !data) {
      console.error("[createLegislationUploads]", error?.message);
      return { ok: false, error: "Couldn't start the upload. Please try again." };
    }
    tickets.push({ name: f.name, path, token: data.token });
  }
  return { ok: true, tickets };
}

export interface NewLegislation {
  path: string;
  fileName: string;
  size: number;
  type: string;
  title: string;
  shortName: string;
  kind: string;
  currentTo: string;
}

export async function registerLegislation(entries: NewLegislation[]): Promise<Done> {
  const auth = await requireSuperAdmin();
  if (!auth) return notAllowed;
  const admin = createAdminClient();
  for (const e of entries) {
    const parts = e.path.split("/");
    if (parts.length !== 2 || parts.some((p) => !p || p === "..")) return { ok: false, error: "That upload isn't valid." };
    const { data: listed } = await admin.storage.from(LEGISLATION_BUCKET).list(parts[0], { search: parts[1] });
    if (!listed?.some((o) => o.name === parts[1])) {
      return { ok: false, error: `${e.fileName} didn't finish uploading. Please try again.` };
    }
    if (!e.title.trim()) return { ok: false, error: `Give ${e.fileName} a name.` };
    if (!isLegislationKind(e.kind)) return { ok: false, error: `Choose a type for ${e.fileName}.` };
  }
  const rows = entries.map((e) => ({
    title: e.title.replace(/\s+/g, " ").trim().slice(0, 200),
    short_name: e.shortName.trim().slice(0, 30) || null,
    kind: e.kind as LegislationKind,
    current_to: cleanDate(e.currentTo),
    file_name: e.fileName.slice(0, 300),
    mime_type: e.type || null,
    size_bytes: e.size,
    storage_path: e.path,
    uploaded_by: auth.user.id,
  }));
  const { data, error } = await auth.supabase.from("legislation_documents").insert(rows).select("id");
  if (error || !data) {
    console.error("[registerLegislation]", error?.message);
    return { ok: false, error: "Couldn't save the uploaded files. Please try again." };
  }
  await queueLegislationIndexing(data.map((d) => d.id));
  revalidatePath("/admin/legislation");
  return { ok: true };
}

/**
 * Name, type and current-to date are part of every chunk's citation line,
 * so changing them re-indexes the entry.
 */
export async function updateLegislation(
  id: string,
  patch: { title: string; shortName: string; kind: string; currentTo: string }
): Promise<Done> {
  const auth = await requireSuperAdmin();
  if (!auth) return notAllowed;
  const title = patch.title.replace(/\s+/g, " ").trim().slice(0, 200);
  if (!title) return { ok: false, error: "Give it a name." };
  if (!isLegislationKind(patch.kind)) return { ok: false, error: "Choose a type." };
  const { data, error } = await auth.supabase
    .from("legislation_documents")
    .update({
      title,
      short_name: patch.shortName.trim().slice(0, 30) || null,
      kind: patch.kind,
      current_to: cleanDate(patch.currentTo),
      indexing_status: "pending",
      indexing_error: null,
    })
    .eq("id", id)
    .select("id");
  if (error || !data?.length) return { ok: false, error: "Couldn't save that change." };
  await queueLegislationIndexing([id]);
  revalidatePath("/admin/legislation");
  return { ok: true };
}

export async function reindexLegislation(id: string): Promise<Done> {
  const auth = await requireSuperAdmin();
  if (!auth) return notAllowed;
  const { data } = await auth.supabase
    .from("legislation_documents")
    .update({ indexing_status: "pending", indexing_error: null })
    .eq("id", id)
    .select("id");
  if (!data?.length) return { ok: false, error: "That entry isn't available." };
  await queueLegislationIndexing([id]);
  revalidatePath("/admin/legislation");
  return { ok: true };
}

/** Removes the entry, its chunks (cascade) and its file. */
export async function deleteLegislation(id: string): Promise<Done> {
  const auth = await requireSuperAdmin();
  if (!auth) return notAllowed;
  const { data, error } = await auth.supabase
    .from("legislation_documents")
    .delete()
    .eq("id", id)
    .select("storage_path");
  if (error || !data?.length) return { ok: false, error: "Couldn't delete that entry." };
  const path = data[0].storage_path as string | null;
  if (path) await createAdminClient().storage.from(LEGISLATION_BUCKET).remove([path]);
  revalidatePath("/admin/legislation");
  return { ok: true };
}

export async function getLegislationDownloadUrl(id: string): Promise<{ ok: true; url: string } | Fail> {
  const auth = await requireSuperAdmin();
  if (!auth) return notAllowed;
  const { data: doc } = await auth.supabase
    .from("legislation_documents")
    .select("storage_path, file_name")
    .eq("id", id)
    .maybeSingle();
  if (!doc?.storage_path) return { ok: false, error: "That file isn't available." };
  const { data, error } = await createAdminClient()
    .storage.from(LEGISLATION_BUCKET)
    .createSignedUrl(doc.storage_path, 300, { download: doc.file_name || true });
  if (error || !data) return { ok: false, error: "Couldn't prepare the download." };
  return { ok: true, url: data.signedUrl };
}
