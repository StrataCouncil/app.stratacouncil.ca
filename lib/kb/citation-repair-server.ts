import { createAdminClient } from "@/lib/supabase/admin";
import { searchLibrary } from "@/lib/training/library-server";
import { normalizeCitations, normalizePlayerContent, type Citation } from "@/lib/training/slides";
import { normalizeSources } from "@/lib/library/library";
import { planRepair, type LibraryChunk, type LibraryDoc } from "@/lib/kb/citation-repair";

/**
 * Finding and repairing citations to Knowledge Base passages that no
 * longer exist (lib/kb/citation-repair.ts has the rules). Covers training
 * slides (and the published copy learners read, which keeps only labels),
 * Library items (draft and published sources, and the section suggestions
 * on flagged statements), training imports, and recall cases.
 *
 * `repairCitations` applies only the certain fixes: a re-link to the same
 * section of an entry still in the library, and dropping dangling ids that
 * nobody reads (import inputs, claim suggestions). Everything else is
 * returned for a Super Admin to choose a section or remove it, with up to
 * three candidate sections found by meaning. Server only, service role.
 */

type Admin = ReturnType<typeof createAdminClient>;
const DROPPED = Symbol("dropped");

export interface Candidate {
  chunkId: string;
  label: string;
  snippet: string;
}

export interface ReviewItem {
  /** "slide", "library" or "recall", and the row it's on. */
  where: "slide" | "library" | "recall";
  rowId: string;
  /** Where to find it: the module or Library item, and the slide. */
  heading: string;
  href: string;
  chunkId: string;
  label: string;
  reason: string;
  candidates: Candidate[];
}

export interface CitationReport {
  relinked: { heading: string; from: string; to: string }[];
  droppedUnread: number;
  review: ReviewItem[];
  publishedPatched: number;
}

async function pageAll<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await fetchPage(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

async function loadLibrary(admin: Admin) {
  const [{ data: docs }, chunks] = await Promise.all([
    admin.from("legislation_documents").select("id, title"),
    pageAll<{ id: string; title: string | null; legislation_document_id: string; chunk_index: number }>((a, b) =>
      admin.from("knowledge_chunks").select("id, title, legislation_document_id, chunk_index").eq("scope", "legislation").order("id").range(a, b)
    ),
  ]);
  const library: LibraryDoc[] = (docs ?? []).map((d) => ({ id: d.id as string, title: d.title as string }));
  const exists = new Set(chunks.map((c) => c.id));
  const byDoc = new Map<string, LibraryChunk[]>();
  for (const c of chunks) {
    const list = byDoc.get(c.legislation_document_id) ?? [];
    list.push({ id: c.id, title: c.title, legislationDocumentId: c.legislation_document_id, chunkIndex: c.chunk_index });
    byDoc.set(c.legislation_document_id, list);
  }
  return { library, exists, byDoc };
}

/** Apply certain repairs to a list of citations. Returns the new list, label changes, and what still needs a person. */
function repairList(
  list: Citation[],
  lib: Awaited<ReturnType<typeof loadLibrary>>,
  onRelink: (from: string, to: string) => void
): { next: Citation[]; labelChanges: Map<string, string>; open: { chunkId: string; label: string; reason: string; lookIn: string | null }[] } {
  const next: Citation[] = [];
  const labelChanges = new Map<string, string>();
  const open: { chunkId: string; label: string; reason: string; lookIn: string | null }[] = [];
  for (const c of list) {
    if (lib.exists.has(c.chunkId)) {
      next.push(c);
      continue;
    }
    const plan = planRepair(c.label, lib.library, lib.byDoc);
    if (plan.kind === "relink") {
      next.push({ chunkId: plan.chunkId, label: plan.label });
      if (plan.label !== c.label) labelChanges.set(c.label, plan.label);
      onRelink(c.label, plan.label);
    } else {
      next.push(c);
      open.push({ chunkId: c.chunkId, label: c.label, reason: plan.reason, lookIn: plan.lookIn });
    }
  }
  const seen = new Set<string>();
  return { next: next.filter((c) => !seen.has(c.chunkId) && seen.add(c.chunkId)), labelChanges, open };
}

/** Change citation labels on one slide of the module's published copy (learners read labels only). */
async function patchPublishedSlide(admin: Admin, moduleId: string, slideId: string, changes: Map<string, string | typeof DROPPED>) {
  if (!changes.size) return false;
  const { data: mod } = await admin.from("training_modules").select("published_version").eq("id", moduleId).maybeSingle();
  const version = (mod?.published_version as number | undefined) ?? 0;
  if (!version) return false;
  const { data: row } = await admin.from("training_module_versions").select("content").eq("module_id", moduleId).eq("version", version).maybeSingle();
  if (!row || !normalizePlayerContent(row.content)) return false;
  const content = row.content as { topics: { slides: { id: string; citations: string[] }[] }[] };
  let changed = false;
  for (const topic of content.topics) {
    for (const slide of topic.slides ?? []) {
      if (slide.id !== slideId || !Array.isArray(slide.citations)) continue;
      const next = [
        ...new Set(
          slide.citations.flatMap((label) => {
            const to = changes.get(label);
            if (to === undefined) return [label];
            changed = true;
            return to === DROPPED ? [] : [to];
          })
        ),
      ];
      slide.citations = next;
    }
  }
  if (!changed) return false;
  const { error } = await admin.from("training_module_versions").update({ content }).eq("module_id", moduleId).eq("version", version);
  if (error) throw new Error(`Couldn't update the published module: ${error.message}`);
  return true;
}

async function candidatesFor(context: string, lookIn: string | null): Promise<Candidate[]> {
  if (!context.trim()) return [];
  try {
    const hits = await searchLibrary([context], { perQuery: 50, threshold: 0.2, limit: 50 });
    return hits
      .filter((h) => !lookIn || h.documentId === lookIn)
      .slice(0, 3)
      .map((h) => ({
        chunkId: h.id,
        label: h.label === h.documentTitle ? h.documentTitle : `${h.documentTitle}, ${h.label}`,
        snippet: h.text.replace(/^[^\n]*\n/, "").replace(/\s+/g, " ").slice(0, 220),
      }));
  } catch (err) {
    console.error("[citation candidates]", err instanceof Error ? err.message : err);
    return [];
  }
}

/** Apply every certain repair and list what needs a person. `withCandidates` adds suggested sections (calls the embeddings service). */
export async function repairCitations({ withCandidates = true } = {}): Promise<CitationReport> {
  const admin = createAdminClient();
  const lib = await loadLibrary(admin);
  const report: CitationReport = { relinked: [], droppedUnread: 0, review: [], publishedPatched: 0 };
  const pending: { item: ReviewItem; context: string; lookIn: string | null }[] = [];

  // Training slides, and the published copy of each.
  const slides = await pageAll<{ id: string; module_id: string; title: string; body: string; citations: unknown }>((a, b) =>
    admin.from("training_slides").select("id, module_id, title, body, citations").order("id").range(a, b)
  );
  const moduleTitles = new Map<string, string>();
  const { data: modules } = await admin.from("training_modules").select("id, title");
  for (const m of modules ?? []) moduleTitles.set(m.id as string, m.title as string);
  for (const s of slides) {
    const list = normalizeCitations(s.citations);
    if (list.every((c) => lib.exists.has(c.chunkId))) continue;
    const heading = `${moduleTitles.get(s.module_id) ?? "Training module"}: ${s.title || "Untitled slide"}`;
    const { next, labelChanges, open } = repairList(list, lib, (from, to) => report.relinked.push({ heading, from, to }));
    if (JSON.stringify(next) !== JSON.stringify(list)) {
      const { error } = await admin.from("training_slides").update({ citations: next }).eq("id", s.id);
      if (error) throw new Error(`Couldn't update a slide: ${error.message}`);
      if (await patchPublishedSlide(admin, s.module_id, s.id, labelChanges)) report.publishedPatched++;
    }
    for (const o of open) {
      pending.push({
        item: { where: "slide", rowId: s.id, heading, href: `/admin/training/${s.module_id}`, chunkId: o.chunkId, label: o.label, reason: o.reason, candidates: [] },
        context: `${s.title}\n${s.body}`,
        lookIn: o.lookIn,
      });
    }
  }

  // Library items: draft and published sources; dangling suggestions on flagged statements are dropped.
  const items = await pageAll<{ id: string; title: string; summary: string; draft_sources: unknown; published: Record<string, unknown> | null; claims: unknown }>((a, b) =>
    admin.from("library_resources").select("id, title, summary, draft_sources, published, claims").order("id").range(a, b)
  );
  for (const it of items) {
    const heading = `Library: ${it.title || "Untitled"}`;
    const draft = normalizeSources(it.draft_sources);
    const pub = it.published ? normalizeSources(it.published.sources) : [];
    const d = repairList(draft, lib, (from, to) => report.relinked.push({ heading, from, to }));
    const p = repairList(pub, lib, () => undefined);
    const claims = Array.isArray(it.claims) ? (it.claims as { suggestions?: { chunkId?: string }[] }[]) : [];
    let claimsChanged = false;
    const nextClaims = claims.map((c) => {
      if (!Array.isArray(c?.suggestions)) return c;
      const kept = c.suggestions.filter((s) => s?.chunkId && lib.exists.has(s.chunkId));
      if (kept.length !== c.suggestions.length) {
        report.droppedUnread += c.suggestions.length - kept.length;
        claimsChanged = true;
      }
      return { ...c, suggestions: kept };
    });
    const patch: Record<string, unknown> = {};
    if (JSON.stringify(d.next) !== JSON.stringify(draft)) patch.draft_sources = d.next;
    if (it.published && JSON.stringify(p.next) !== JSON.stringify(pub)) patch.published = { ...it.published, sources: p.next };
    if (claimsChanged) patch.claims = nextClaims;
    if (Object.keys(patch).length) {
      const { error } = await admin.from("library_resources").update(patch).eq("id", it.id);
      if (error) throw new Error(`Couldn't update a Library item: ${error.message}`);
    }
    const openIds = new Set(d.open.map((o) => o.chunkId));
    for (const o of [...d.open, ...p.open.filter((o) => !openIds.has(o.chunkId))]) {
      pending.push({
        item: { where: "library", rowId: it.id, heading, href: `/admin/library/${it.id}`, chunkId: o.chunkId, label: o.label, reason: o.reason, candidates: [] },
        context: `${it.title}\n${it.summary}`,
        lookIn: o.lookIn,
      });
    }
  }

  // Training imports: the passages an AI build started from. Nobody reads a dangling one.
  const imports = await pageAll<{ id: string; reference_chunk_ids: string[] }>((a, b) =>
    admin.from("training_imports").select("id, reference_chunk_ids").order("id").range(a, b)
  );
  for (const imp of imports) {
    const ids = imp.reference_chunk_ids ?? [];
    const kept = ids.filter((id) => lib.exists.has(id));
    if (kept.length === ids.length) continue;
    report.droppedUnread += ids.length - kept.length;
    const { error } = await admin.from("training_imports").update({ reference_chunk_ids: kept }).eq("id", imp.id);
    if (error) throw new Error(`Couldn't update a training import: ${error.message}`);
  }

  // Recall cases keep only ids, and their questions hold real records, so
  // no meaning search: they're listed for a person to fix on the recall page.
  const cases = await pageAll<{ id: string; question: string; expect_legislation_sections: string[] }>((a, b) =>
    admin.from("stratasphere_recall_cases").select("id, question, expect_legislation_sections").order("id").range(a, b)
  );
  for (const rc of cases) {
    for (const id of (rc.expect_legislation_sections ?? []).filter((x) => !lib.exists.has(x))) {
      report.review.push({
        where: "recall",
        rowId: rc.id,
        heading: `Recall case: ${rc.question.slice(0, 80)}${rc.question.length > 80 ? "…" : ""}`,
        href: "/admin/recall",
        chunkId: id,
        label: "A section this case expects (no longer in the Knowledge Base)",
        reason: "Choose the section again on the recall page, or remove it here.",
        candidates: [],
      });
    }
  }

  if (withCandidates) {
    for (const p of pending) p.item.candidates = await candidatesFor(p.context, p.lookIn);
  }
  report.review.unshift(...pending.map((p) => p.item));
  return report;
}

/**
 * A Super Admin's choice for one citation: replace it with a section, or
 * remove it. Updates the published copy too.
 */
export async function resolveCitation(input: { where: "slide" | "library" | "recall"; rowId: string; chunkId: string; replacementId: string | null }) {
  const admin = createAdminClient();
  let replacement: Citation | null = null;
  if (input.replacementId) {
    const { data: c } = await admin.from("knowledge_chunks").select("id, title, legislation_document_id").eq("id", input.replacementId).eq("scope", "legislation").maybeSingle();
    if (!c) throw new Error("That section isn't in the Knowledge Base.");
    const { data: d } = await admin.from("legislation_documents").select("title").eq("id", c.legislation_document_id).maybeSingle();
    if (!d) throw new Error("That section's entry is gone.");
    const t = ((c.title as string | null) ?? "").trim();
    replacement = { chunkId: c.id as string, label: t && t !== d.title ? `${d.title}, ${t}` : (d.title as string) };
  }
  const swap = (list: Citation[]) => {
    const old = list.find((c) => c.chunkId === input.chunkId);
    const next = list.flatMap((c) => (c.chunkId === input.chunkId ? (replacement ? [replacement] : []) : [c]));
    const seen = new Set<string>();
    return { old, next: next.filter((c) => !seen.has(c.chunkId) && seen.add(c.chunkId)) };
  };

  if (input.where === "slide") {
    const { data: s } = await admin.from("training_slides").select("id, module_id, citations").eq("id", input.rowId).maybeSingle();
    if (!s) throw new Error("That slide is gone.");
    const { old, next } = swap(normalizeCitations(s.citations));
    if (!old) return;
    const { error } = await admin.from("training_slides").update({ citations: next }).eq("id", s.id);
    if (error) throw new Error(error.message);
    await patchPublishedSlide(admin, s.module_id as string, s.id as string, new Map([[old.label, replacement ? replacement.label : DROPPED]]));
    return;
  }
  if (input.where === "library") {
    const { data: it } = await admin.from("library_resources").select("id, draft_sources, published").eq("id", input.rowId).maybeSingle();
    if (!it) throw new Error("That Library item is gone.");
    const patch: Record<string, unknown> = { draft_sources: swap(normalizeSources(it.draft_sources)).next };
    const pub = it.published as Record<string, unknown> | null;
    if (pub) patch.published = { ...pub, sources: swap(normalizeSources(pub.sources)).next };
    const { error } = await admin.from("library_resources").update(patch).eq("id", it.id);
    if (error) throw new Error(error.message);
    return;
  }
  const { data: rc } = await admin.from("stratasphere_recall_cases").select("id, expect_legislation_sections").eq("id", input.rowId).maybeSingle();
  if (!rc) throw new Error("That recall case is gone.");
  const ids = ((rc.expect_legislation_sections as string[]) ?? []).flatMap((id) => (id === input.chunkId ? (replacement ? [replacement.chunkId] : []) : [id]));
  const { error } = await admin.from("stratasphere_recall_cases").update({ expect_legislation_sections: [...new Set(ids)] }).eq("id", rc.id);
  if (error) throw new Error(error.message);
}
