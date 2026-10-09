import { requireSuperAdmin } from "@/lib/data/admin";
import {
  isUuid,
  normalizeClaims,
  normalizeItem,
  type LibraryDraft,
  type PublishedLibraryItem,
} from "@/lib/library/library";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Reading Library items (0049). Members read published items through the
 * app, never the API (templates are for subscribers): the service role,
 * after the page has checked the reader belongs to the strata. The
 * console's reads check for a Super Admin first.
 */

export interface PublishedLibraryEntry extends PublishedLibraryItem {
  id: string;
  publishedAt: string;
}

const COLUMNS = "id, kind, title, summary, tags, draft_markup, draft_sources, claims, published, published_at, updated_at";

type Row = {
  id: string;
  kind: string;
  title: string;
  summary: string;
  tags: string[];
  draft_markup: string;
  draft_sources: unknown;
  claims: unknown;
  published: unknown;
  published_at: string | null;
  updated_at: string;
};

function toPublished(r: Pick<Row, "id" | "published" | "published_at">): PublishedLibraryEntry | null {
  if (!r.published || !r.published_at) return null;
  return { id: r.id, publishedAt: r.published_at, ...normalizeItem(r.published) };
}

/** Every published item, newest first. */
export async function listPublishedLibrary(): Promise<PublishedLibraryEntry[]> {
  const { data, error } = await createAdminClient()
    .from("library_resources")
    .select("id, published, published_at")
    .not("published", "is", null)
    .order("published_at", { ascending: false });
  if (error) {
    console.error("[listPublishedLibrary]", error.message);
    return [];
  }
  return (data ?? []).flatMap((r) => toPublished(r as Row) ?? []);
}

export async function getPublishedLibraryItem(id: string): Promise<PublishedLibraryEntry | null> {
  if (!isUuid(id)) return null;
  const { data } = await createAdminClient().from("library_resources").select("id, published, published_at").eq("id", id).maybeSingle();
  return data ? toPublished(data as Row) : null;
}

export function toDraft(r: Row): LibraryDraft {
  const item = normalizeItem({
    kind: r.kind,
    title: r.title,
    summary: r.summary,
    tags: r.tags,
    markup: r.draft_markup,
    sources: r.draft_sources,
  });
  const published = r.published ? normalizeItem(r.published) : null;
  return {
    id: r.id,
    ...item,
    claims: normalizeClaims(r.claims),
    publishedAt: r.published_at,
    updatedAt: r.updated_at,
    changed: !published || JSON.stringify(published) !== JSON.stringify(item),
  };
}

/** The console's list. */
export async function listLibraryDrafts(): Promise<LibraryDraft[] | null> {
  if (!(await requireSuperAdmin())) return null;
  const { data, error } = await createAdminClient().from("library_resources").select(COLUMNS).order("updated_at", { ascending: false });
  if (error) {
    console.error("[listLibraryDrafts]", error.message);
    return [];
  }
  return (data ?? []).map((r) => toDraft(r as Row));
}

export async function getLibraryDraft(id: string): Promise<LibraryDraft | null> {
  if (!isUuid(id) || !(await requireSuperAdmin())) return null;
  const { data } = await createAdminClient().from("library_resources").select(COLUMNS).eq("id", id).maybeSingle();
  return data ? toDraft(data as Row) : null;
}

export type { Row as LibraryRow };
export const LIBRARY_COLUMNS = COLUMNS;
