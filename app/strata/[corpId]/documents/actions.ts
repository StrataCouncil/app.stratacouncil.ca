"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getStrataAccess } from "@/lib/data/strata";
import {
  acceptedExtensions,
  DOCUMENTS_BUCKET,
  fileExtension,
  isDocumentCategory,
  isIndexableFile,
  MAX_DOCUMENT_BYTES,
  MAX_FILES_PER_UPLOAD,
  pickableDocumentCategories,
  type DocumentCategory,
} from "@/lib/documents";
import { queueDocumentIndexing } from "@/lib/kb/queue";

/**
 * Document repository actions (doc01 §4a — free for every member, always).
 *
 * Upload is two steps, like the Strata Plan upload (app/strata/actions.ts):
 * the server mints a signed upload URL per file under `<corp>/<uuid>/…` in
 * the private `corporation-documents` bucket, the browser uploads straight
 * to Storage, then `registerDocuments` checks each object really landed
 * under this corporation's prefix and writes the rows through the user's
 * own client (RLS: members insert their own rows) before queueing them for
 * indexing. The service-role client is used only for Storage, which has no
 * client policies on this bucket.
 */

type Fail = { ok: false; error: string };

export interface UploadTicket {
  name: string;
  path: string;
  token: string;
}

function safeFileName(name: string) {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "")
    .replace(/\s+/g, "_")
    .slice(-120);
  return cleaned || "document";
}

export async function createDocumentUploads(
  corpId: string,
  files: Array<{ name: string; size: number }>
): Promise<{ ok: true; tickets: UploadTicket[] } | Fail> {
  const access = await getStrataAccess(corpId);
  if (!access) return { ok: false, error: "You're not connected to this strata." };
  if (files.length === 0) return { ok: false, error: "Choose at least one file." };
  if (files.length > MAX_FILES_PER_UPLOAD) {
    return { ok: false, error: `Upload up to ${MAX_FILES_PER_UPLOAD} files at a time.` };
  }
  for (const f of files) {
    if (!(acceptedExtensions as readonly string[]).includes(fileExtension(f.name))) {
      return { ok: false, error: `${f.name}: only ${acceptedExtensions.join(", ")} files can be uploaded.` };
    }
    if (f.size > MAX_DOCUMENT_BYTES) return { ok: false, error: `${f.name} is over the 50 MB limit.` };
    if (f.size === 0) return { ok: false, error: `${f.name} is empty.` };
  }

  const admin = createAdminClient();
  const tickets: UploadTicket[] = [];
  for (const f of files) {
    const path = `${access.corpId}/${randomUUID()}/${safeFileName(f.name)}`;
    const { data, error } = await admin.storage.from(DOCUMENTS_BUCKET).createSignedUploadUrl(path);
    if (error || !data) {
      console.error("[createDocumentUploads]", error?.message);
      return { ok: false, error: "Couldn't start the upload. Please try again." };
    }
    tickets.push({ name: f.name, path, token: data.token });
  }
  return { ok: true, tickets };
}

export interface UploadedFile {
  path: string;
  name: string;
  size: number;
  type: string;
}

/**
 * Write rows for files the browser has finished uploading. Shared by the
 * Documents screen and agenda-item attachments (which pass
 * `agenda_attachments` plus the meeting/item they belong to).
 */
export async function registerUploadedDocuments(
  corpId: string,
  category: DocumentCategory,
  files: UploadedFile[],
  extra: { sourceType?: "upload" | "agenda_attachment" | "historic_minutes"; meetingId?: string; agendaItemId?: string } = {}
): Promise<{ ok: true; documentIds: string[] } | Fail> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  const access = await getStrataAccess(corpId);
  if (!access) return { ok: false, error: "You're not connected to this strata." };

  const admin = createAdminClient();
  for (const f of files) {
    const parts = f.path.split("/");
    if (parts.length !== 3 || parts[0] !== access.corpId || parts.some((p) => !p || p === "..")) {
      return { ok: false, error: "That upload doesn't belong to this strata." };
    }
    const { data: listed } = await admin.storage
      .from(DOCUMENTS_BUCKET)
      .list(`${parts[0]}/${parts[1]}`, { search: parts[2] });
    if (!listed?.some((o) => o.name === parts[2])) {
      return { ok: false, error: `${f.name} didn't finish uploading. Please try again.` };
    }
  }

  const rows = files.map((f) => ({
    corporation_id: access.corpId,
    category,
    title: f.name.slice(0, 300),
    file_name: f.name.slice(0, 300),
    mime_type: f.type || null,
    size_bytes: f.size,
    storage_path: `${DOCUMENTS_BUCKET}/${f.path}`,
    uploaded_by: user.id,
    source_type: extra.sourceType ?? "upload",
    meeting_id: extra.meetingId ?? null,
    agenda_item_id: extra.agendaItemId ?? null,
  }));
  const { data, error } = await supabase.from("documents").insert(rows).select("id, file_name");
  if (error || !data) {
    console.error("[registerUploadedDocuments]", error?.code, error?.message);
    return { ok: false, error: "Couldn't save the uploaded files. Please try again." };
  }

  // Files the indexer can't read are marked straight away (service role —
  // indexing fields aren't client-writable); the rest are queued.
  const unreadable = data.filter((d) => !isIndexableFile(d.file_name ?? "")).map((d) => d.id);
  if (unreadable.length) {
    await admin.from("documents").update({ indexing_status: "not_indexable" }).in("id", unreadable);
  }
  await queueDocumentIndexing(data.filter((d) => isIndexableFile(d.file_name ?? "")).map((d) => d.id));

  revalidatePath(`/strata/${access.corpId}/documents`, "layout");
  return { ok: true, documentIds: data.map((d) => d.id) };
}

export async function registerDocuments(
  corpId: string,
  category: string,
  files: UploadedFile[]
): Promise<{ ok: true } | Fail> {
  if (!isDocumentCategory(category) || category === "agenda_attachments") {
    return { ok: false, error: "Choose a folder." };
  }
  const result = await registerUploadedDocuments(corpId, category, files);
  return result.ok ? { ok: true } : result;
}

/** A short-lived signed download URL, after an RLS-checked read of the row. */
/**
 * A short-lived link to a document. By default the browser saves the file;
 * with `view`, it opens in the browser (PDFs and images show in the tab),
 * for attachments shown during a meeting or cited by Stratasphere.
 */
export async function getDocumentDownloadUrl(
  corpId: string,
  documentId: string,
  { view = false }: { view?: boolean } = {}
): Promise<{ ok: true; url: string } | Fail> {
  const supabase = await createClient();
  const { data: doc } = await supabase
    .from("documents")
    .select("storage_path, file_name, title, url, source_type")
    .eq("id", documentId)
    .eq("corporation_id", corpId)
    .maybeSingle();
  if (!doc) return { ok: false, error: "That document isn't available." };
  if (doc.source_type === "link" && doc.url) return { ok: true, url: doc.url };
  if (!doc.storage_path) return { ok: false, error: "That document has no file." };

  const slash = doc.storage_path.indexOf("/");
  const bucket = doc.storage_path.slice(0, slash);
  const path = doc.storage_path.slice(slash + 1);
  const { data, error } = await createAdminClient()
    .storage.from(bucket)
    .createSignedUrl(path, 60 * 5, view ? undefined : { download: doc.file_name || doc.title || true });
  if (error || !data) {
    console.error("[getDocumentDownloadUrl]", error?.message);
    return { ok: false, error: "Couldn't prepare the download. Please try again." };
  }
  return { ok: true, url: data.signedUrl };
}

export async function moveDocument(
  corpId: string,
  documentId: string,
  category: string
): Promise<{ ok: true } | Fail> {
  if (!(pickableDocumentCategories as readonly string[]).includes(category)) {
    return { ok: false, error: "Choose a folder." };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("move_document", { p_document_id: documentId, p_category: category });
  if (error) {
    console.error("[moveDocument]", error.code, error.message);
    return { ok: false, error: "Couldn't move that document." };
  }
  revalidatePath(`/strata/${corpId}/documents`, "layout");
  return { ok: true };
}

/** Re-queue a document that failed or never got indexed. */
export async function reindexDocument(corpId: string, documentId: string): Promise<{ ok: true } | Fail> {
  const supabase = await createClient();
  const { data: doc } = await supabase
    .from("documents")
    .select("id, indexing_status, file_name, source_type")
    .eq("id", documentId)
    .eq("corporation_id", corpId)
    .maybeSingle();
  if (!doc) return { ok: false, error: "That document isn't available." };
  if (doc.source_type !== "link" && !isIndexableFile(doc.file_name ?? "")) {
    return { ok: false, error: "Only PDF, Word (.docx) and text files can be indexed." };
  }
  if (doc.indexing_status === "processing") return { ok: true };

  await createAdminClient()
    .from("documents")
    .update({ indexing_status: "pending", indexing_error: null })
    .eq("id", documentId);
  await queueDocumentIndexing([documentId]);
  revalidatePath(`/strata/${corpId}/documents`, "layout");
  return { ok: true };
}
