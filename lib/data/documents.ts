import { createClient } from "@/lib/supabase/server";
import { documentCategories, type DocumentCategory, type IndexingStatus } from "@/lib/documents";

/**
 * The corporation's document repository as the signed-in member sees it
 * (RLS: membership alone, doc01 §6). Historic minutes are excluded — they
 * live on the Minutes tab, not in a folder.
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
}

const COLUMNS =
  "id, title, file_name, category, source_type, url, mime_type, size_bytes, indexing_status, indexing_error, indexed_at, uploaded_at, storage_path, uploader:profiles!documents_uploaded_by_fkey(full_name)";

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
  };
}

export async function listDocuments(corpId: string, category?: DocumentCategory) {
  const supabase = await createClient();
  let query = supabase
    .from("documents")
    .select(COLUMNS)
    .eq("corporation_id", corpId)
    .eq("is_current", true)
    .neq("source_type", "historic_minutes")
    .neq("source_type", "minutes")
    .order("uploaded_at", { ascending: false });
  if (category) query = query.eq("category", category);
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
    .eq("is_current", true)
    .neq("source_type", "historic_minutes")
    .neq("source_type", "minutes");
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
