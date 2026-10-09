"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { askClaudeJson } from "@/lib/ai/claude";
import { requireSuperAdmin } from "@/lib/data/admin";
import { LIBRARY_COLUMNS, toDraft, type LibraryRow } from "@/lib/data/library";
import { mirrorLibraryToDemo } from "@/lib/demo-mirror";
import {
  isUuid,
  normalizeItem,
  normalizeKind,
  PASTE_MAX_CHARS,
  publishProblems,
  type LibraryClaim,
  type LibraryDraft,
} from "@/lib/library/library";
import { normalizeTidied, TIDY_SYSTEM, tidyRequest, tidySchema } from "@/lib/library/tidy";
import { createAdminClient } from "@/lib/supabase/admin";
import { labelFor, libraryLabels } from "@/lib/training/builder-server";
import { passagesForCitations, searchLibrary } from "@/lib/training/library-server";
import type { LibraryPassage } from "@/lib/training/library";

/**
 * The console's Library (0049): Super Admins write playbooks, guides and
 * templates, and publish them to every strata. Only the author's draft
 * (general content, no one's details) goes to the AI.
 */

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
type Hit = { chunkId: string; label: string; snippet: string };

const NOT_STAFF = { ok: false as const, error: "Only platform staff can edit the Library." };

function refresh(id?: string) {
  revalidatePath("/admin/library");
  if (id) revalidatePath(`/admin/library/${id}`);
  revalidatePath("/strata", "layout");
}

function mirrorSoon() {
  after(async () => {
    const r = await mirrorLibraryToDemo();
    if (!r.ok && !r.error.includes("isn't connected")) console.error("[library mirror]", r.error);
  });
}

const toHit = (p: LibraryPassage): Hit => ({
  chunkId: p.id,
  label: labelFor(p.documentTitle, p.label),
  snippet: p.text.replace(/\s+/g, " ").slice(0, 280),
});

async function read(id: string): Promise<LibraryDraft | null> {
  const { data } = await createAdminClient().from("library_resources").select(LIBRARY_COLUMNS).eq("id", id).maybeSingle();
  return data ? toDraft(data as LibraryRow) : null;
}

export async function createLibraryItem(kind: string): Promise<Result<{ id: string }>> {
  const me = await requireSuperAdmin();
  if (!me) return NOT_STAFF;
  const { data, error } = await createAdminClient()
    .from("library_resources")
    .insert({ kind: normalizeKind(kind), created_by: me.user.id })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "Couldn't create the item." };
  refresh();
  return { ok: true, id: data.id as string };
}

/** Saves the draft. Members see nothing until it's published. */
export async function saveLibraryDraft(id: string, input: unknown): Promise<Result<{ draft: LibraryDraft }>> {
  if (!(await requireSuperAdmin())) return NOT_STAFF;
  if (!isUuid(id)) return { ok: false, error: "Item not found." };
  const item = normalizeItem(input);
  const { error } = await createAdminClient()
    .from("library_resources")
    .update({
      kind: item.kind,
      title: item.title,
      summary: item.summary,
      tags: item.tags,
      draft_markup: item.markup,
      draft_sources: item.sources,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return { ok: false, error: "Couldn't save." };
  const draft = await read(id);
  if (!draft) return { ok: false, error: "Item not found." };
  refresh(id);
  return { ok: true, draft };
}

/** Legislation Library sections for a statement: the sections it names, if any are in the library, otherwise by meaning. */
async function sectionsFor(text: string, limit: number): Promise<Hit[]> {
  const byNumber = await passagesForCitations([text]);
  const found = byNumber.length ? byNumber : await searchLibrary([text], { perQuery: limit, threshold: 0.3, limit });
  return found.slice(0, limit).map(toHit);
}

/**
 * Turns a pasted draft into the Library's markup and replaces the item's
 * draft with it (title, summary, kind, tags, content). Sources already
 * chosen stay. Each statement the AI flags comes back with the sections
 * that may support it, to check before publishing.
 */
export async function tidyLibraryDraft(id: string, text: string): Promise<Result<{ draft: LibraryDraft }>> {
  if (!(await requireSuperAdmin())) return NOT_STAFF;
  if (!isUuid(id)) return { ok: false, error: "Item not found." };
  const pasted = String(text ?? "").trim();
  if (pasted.length < 40) return { ok: false, error: "Paste the draft first." };
  if (pasted.length > PASTE_MAX_CHARS) return { ok: false, error: `That's longer than ${PASTE_MAX_CHARS.toLocaleString("en-CA")} characters.` };
  const before = await read(id);
  if (!before) return { ok: false, error: "Item not found." };

  let tidied;
  try {
    tidied = normalizeTidied(
      await askClaudeJson({
        system: TIDY_SYSTEM,
        messages: [{ role: "user", content: tidyRequest(pasted) }],
        schema: tidySchema,
        effort: "medium",
        maxTokens: 24000,
      })
    );
  } catch (e) {
    console.error("[tidyLibraryDraft]", e instanceof Error ? e.message : e);
    return { ok: false, error: "The AI didn't finish. Try again in a moment." };
  }
  if (!tidied.item.markup) return { ok: false, error: "The AI couldn't read that draft. Check it and try again." };

  let claims: LibraryClaim[] = tidied.claims.map((c) => ({ ...c, suggestions: [] }));
  try {
    claims = await Promise.all(tidied.claims.map(async (c) => ({ ...c, suggestions: await sectionsFor(`${c.statement} ${c.query}`, 3) })));
  } catch (e) {
    // The draft is still useful without suggestions; the search box remains.
    console.error("[tidyLibraryDraft] search", e instanceof Error ? e.message : e);
  }

  const { error } = await createAdminClient()
    .from("library_resources")
    .update({
      kind: tidied.item.kind,
      title: tidied.item.title || before.title,
      summary: tidied.item.summary || before.summary,
      tags: tidied.item.tags,
      draft_markup: tidied.item.markup,
      claims,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return { ok: false, error: "Couldn't save the tidied draft." };
  const draft = await read(id);
  if (!draft) return { ok: false, error: "Item not found." };
  refresh(id);
  return { ok: true, draft };
}

/** Search the Legislation Library for a section to cite ("98", "Standard Bylaw 7" or words). */
export async function searchLibrarySections(query: string): Promise<Result<{ hits: Hit[] }>> {
  if (!(await requireSuperAdmin())) return NOT_STAFF;
  const q = String(query ?? "").trim().slice(0, 300);
  if (!q) return { ok: true, hits: [] };
  try {
    const numberOnly = /^\s*(?:s(?:ection|\.)?\s*)?\d{1,3}(?:\.\d{1,3})?\s*$/i.test(q);
    return { ok: true, hits: await sectionsFor(numberOnly ? `s. ${q.replace(/[^\d.]/g, "")}` : q, 10) };
  } catch (e) {
    console.error("[searchLibrarySections]", e instanceof Error ? e.message : e);
    return { ok: false, error: "The library search didn't work. Try again." };
  }
}

/** Publishes the saved draft, with each source under the Legislation Library's current name. */
export async function publishLibraryItem(id: string): Promise<Result<{ draft: LibraryDraft }>> {
  if (!(await requireSuperAdmin())) return NOT_STAFF;
  if (!isUuid(id)) return { ok: false, error: "Item not found." };
  const draft = await read(id);
  if (!draft) return { ok: false, error: "Item not found." };
  const item = normalizeItem(draft);
  const problems = publishProblems(item);
  if (problems.length) return { ok: false, error: problems.join(" ") };
  const labels = await libraryLabels(item.sources.map((s) => s.chunkId));
  const sources = item.sources.filter((s) => labels.has(s.chunkId)).map((s) => ({ ...s, label: labels.get(s.chunkId)! }));
  const published = { ...item, sources };
  const { error } = await createAdminClient()
    .from("library_resources")
    .update({ published, published_at: new Date().toISOString(), draft_sources: sources })
    .eq("id", id);
  if (error) return { ok: false, error: "Couldn't publish." };
  refresh(id);
  mirrorSoon();
  const after_ = await read(id);
  return after_ ? { ok: true, draft: after_ } : { ok: false, error: "Item not found." };
}

export async function unpublishLibraryItem(id: string): Promise<Result<{ draft: LibraryDraft }>> {
  if (!(await requireSuperAdmin())) return NOT_STAFF;
  if (!isUuid(id)) return { ok: false, error: "Item not found." };
  const { error } = await createAdminClient().from("library_resources").update({ published: null, published_at: null }).eq("id", id);
  if (error) return { ok: false, error: "Couldn't unpublish." };
  refresh(id);
  mirrorSoon();
  const draft = await read(id);
  return draft ? { ok: true, draft } : { ok: false, error: "Item not found." };
}

export async function deleteLibraryItem(id: string): Promise<Result> {
  if (!(await requireSuperAdmin())) return NOT_STAFF;
  if (!isUuid(id)) return { ok: false, error: "Item not found." };
  const { error } = await createAdminClient().from("library_resources").delete().eq("id", id);
  if (error) return { ok: false, error: "Couldn't delete." };
  refresh();
  mirrorSoon();
  return { ok: true };
}
