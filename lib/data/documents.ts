import { createClient } from "@/lib/supabase/server";
import { documentCategories, type DocumentCategory, type IndexingStatus } from "@/lib/documents";
import { attachmentUses, normalizeAgenda, type AttachmentUse, type MeetingType } from "@/lib/meetings/agenda";

/**
 * The corporation's document repository as the signed-in member sees it
 * (RLS: membership alone, doc01 §6). Finalized and historic minutes are in
 * Meetings & Records with everything else.
 */
export interface RepositoryDocument {
  id: string;
  title: string;
  fileName: string | null;
  category: DocumentCategory | null;
  sourceType: string;
  url: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  indexingStatus: IndexingStatus;
  indexingError: string | null;
  indexedAt: string | null;
  uploadedAt: string;
  uploadedBy: string | null;
  hasFile: boolean;
  /** The server's fingerprint of the file (0065), once it's been read. */
  sha256: string | null;
}

const COLUMNS =
  "id, title, file_name, category, source_type, url, mime_type, size_bytes, indexing_status, indexing_error, indexed_at, uploaded_at, storage_path, content_sha256, uploader:profiles!documents_uploaded_by_fkey(full_name)";

type Row = {
  id: string;
  title: string | null;
  file_name: string | null;
  category: string | null;
  source_type: string;
  url: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  indexing_status: IndexingStatus;
  indexing_error: string | null;
  indexed_at: string | null;
  uploaded_at: string;
  storage_path: string | null;
  content_sha256: string | null;
  uploader: { full_name: string | null } | null;
};

function toDocument(r: Row): RepositoryDocument {
  return {
    id: r.id,
    title: r.title || r.file_name || "Untitled",
    fileName: r.file_name,
    category: (r.category as DocumentCategory | null) ?? null,
    sourceType: r.source_type,
    url: r.url,
    mimeType: r.mime_type,
    sizeBytes: r.size_bytes,
    indexingStatus: r.indexing_status,
    indexingError: r.indexing_error,
    indexedAt: r.indexed_at,
    uploadedAt: r.uploaded_at,
    uploadedBy: r.uploader?.full_name ?? null,
    hasFile: Boolean(r.storage_path),
    sha256: r.content_sha256,
  };
}

/** A folder's documents; `null` lists the Unfiled ones (no folder). */
export async function listDocuments(corpId: string, category?: DocumentCategory | null) {
  const supabase = await createClient();
  let query = supabase
    .from("documents")
    .select(COLUMNS)
    .eq("corporation_id", corpId)
    .eq("is_current", true)
    .order("uploaded_at", { ascending: false });
  if (category) query = query.eq("category", category);
  else if (category === null) query = query.is("category", null);
  const { data, error } = await query;
  if (error) console.error("[listDocuments]", error.message);
  return ((data ?? []) as unknown as Row[]).map(toDocument);
}

export async function documentCountsByCategory(corpId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("documents")
    .select("category")
    .eq("corporation_id", corpId)
    .eq("is_current", true);
  if (error) console.error("[documentCountsByCategory]", error.message);
  const counts = Object.fromEntries(documentCategories.map((c) => [c, 0])) as Record<DocumentCategory, number>;
  let uncategorized = 0;
  for (const row of data ?? []) {
    const c = row.category as DocumentCategory | null;
    if (c && c in counts) counts[c]++;
    else uncategorized++;
  }
  return { counts, uncategorized };
}

/** Where each document is attached in the strata's meetings (agenda items). */
export async function documentAttachmentUses(corpId: string): Promise<Map<string, AttachmentUse[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("meetings")
    .select("id, type, meeting_date, agenda")
    .eq("corporation_id", corpId)
    .order("meeting_date", { ascending: false });
  if (error) console.error("[documentAttachmentUses]", error.message);
  return attachmentUses(
    (data ?? []).map((m) => ({
      id: m.id as string,
      type: m.type as MeetingType,
      meetingDate: m.meeting_date as string,
      agenda: normalizeAgenda(m.agenda),
    }))
  );
}

export interface FiledCopy {
  id: string;
  title: string;
  category: DocumentCategory;
}

/** For each fingerprint, the copy already filed in a folder (the oldest), if any. */
export async function filedCopies(corpId: string, hashes: string[]): Promise<Map<string, FiledCopy>> {
  const out = new Map<string, FiledCopy>();
  const wanted = [...new Set(hashes)];
  if (!wanted.length) return out;
  const supabase = await createClient();
  for (let i = 0; i < wanted.length; i += 200) {
    const { data, error } = await supabase
      .from("documents")
      .select("id, title, file_name, category, content_sha256")
      .eq("corporation_id", corpId)
      .eq("is_current", true)
      .not("category", "is", null)
      .in("content_sha256", wanted.slice(i, i + 200))
      .order("uploaded_at", { ascending: true });
    if (error) console.error("[filedCopies]", error.message);
    for (const d of data ?? []) {
      const hash = d.content_sha256 as string;
      if (!out.has(hash)) out.set(hash, { id: d.id, title: d.title || d.file_name || "Untitled", category: d.category as DocumentCategory });
    }
  }
  return out;
}

/** Whether any stored file of the strata hasn't been fingerprinted yet. */
export async function hasUnfingerprintedFiles(corpId: string): Promise<boolean> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("documents")
    .select("id", { count: "exact", head: true })
    .eq("corporation_id", corpId)
    .is("content_sha256", null)
    .not("storage_path", "is", null);
  return (count ?? 0) > 0;
}
