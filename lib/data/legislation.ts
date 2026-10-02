import { requireSuperAdmin } from "@/lib/data/admin";
import type { LegislationKind } from "@/lib/legislation";

export interface LegislationEntry {
  id: string;
  title: string;
  shortName: string | null;
  kind: LegislationKind;
  currentTo: string | null;
  fileName: string | null;
  sizeBytes: number | null;
  status: "pending" | "processing" | "indexed" | "needs_text" | "not_indexable" | "failed";
  error: string | null;
  sectionCount: number | null;
  chunkCount: number | null;
  uploadedAt: string;
  indexedAt: string | null;
}

/** Every library entry, for the Super Admin screen. Null when the caller isn't a Super Admin. */
export async function listLegislation(): Promise<LegislationEntry[] | null> {
  const admin = await requireSuperAdmin();
  if (!admin) return null;
  const { data } = await admin.supabase
    .from("legislation_documents")
    .select(
      "id, title, short_name, kind, current_to, file_name, size_bytes, indexing_status, indexing_error, section_count, chunk_count, uploaded_at, indexed_at"
    )
    .order("kind")
    .order("title");
  return (data ?? []).map((r) => ({
    id: r.id,
    title: r.title,
    shortName: r.short_name,
    kind: r.kind,
    currentTo: r.current_to,
    fileName: r.file_name,
    sizeBytes: r.size_bytes,
    status: r.indexing_status,
    error: r.indexing_error,
    sectionCount: r.section_count,
    chunkCount: r.chunk_count,
    uploadedAt: r.uploaded_at,
    indexedAt: r.indexed_at,
  }));
}
