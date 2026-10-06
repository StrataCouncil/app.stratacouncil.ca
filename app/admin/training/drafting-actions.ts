"use server";

import { askClaudeJson } from "@/lib/ai/claude";
import { createAdminClient } from "@/lib/supabase/admin";
import { canAuthor, editing, labelFor, readSlide, verifiedCitations } from "@/lib/training/builder-server";
import { loadPassages, searchLibrary } from "@/lib/training/library-server";
import {
  draftProblems,
  namesForSlides,
  normalizeOutline,
  numberSources,
  outlineRequest,
  outlineSchema,
  slideRequest,
  slideSchema,
  toDraftedSlide,
  WRITER_SYSTEM,
  type DraftedSlide,
  type OutlineSlide,
} from "@/lib/training/drafting";
import { normalizeObjectives, type Slide } from "@/lib/training/slides";
import type { AdminClient } from "@/lib/training/builder-server";

/**
 * Drafting slides with AI, with the module checked out (lib/training/drafting.ts).
 * Each step runs while the author waits, one request at a time: no
 * background jobs. Slides are only ever added after the existing ones;
 * nothing the author has written is changed. Only course text goes to the
 * AI (module title, objectives, library passages), never anyone's details.
 */

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const MAX_SOURCES = 40;

async function moduleInfo(admin: AdminClient, moduleId: string) {
  const { data: m } = await admin
    .from("training_modules")
    .select("id, title, summary, estimated_minutes, objectives, track:training_tracks(title)")
    .eq("id", moduleId)
    .maybeSingle();
  if (!m) return null;
  const track = (Array.isArray(m.track) ? m.track[0] : m.track) as { title: string } | null;
  return {
    title: m.title as string,
    summary: (m.summary as string) ?? "",
    minutes: m.estimated_minutes as number | null,
    track: track?.title ?? "",
    objectives: normalizeObjectives(m.objectives).filter((o) => o.text.trim()),
  };
}

export interface SourceHit {
  chunkId: string;
  label: string;
  snippet: string;
}

/** Library sections that match the module's title, scope and objectives, for the author to approve. */
export async function suggestSources(moduleId: string): Promise<Result<{ hits: SourceHit[] }>> {
  if (!(await canAuthor(moduleId))) return { ok: false, error: "You can't edit this module." };
  const m = await moduleInfo(createAdminClient(), moduleId);
  if (!m) return { ok: false, error: "Module not found." };
  try {
    const queries = [[m.title, m.summary].filter(Boolean).join(". "), ...m.objectives.map((o) => o.text)];
    const passages = await searchLibrary(queries, { perQuery: 8, threshold: 0.3, limit: 24 });
    return {
      ok: true,
      hits: passages.map((p) => ({ chunkId: p.id, label: labelFor(p.documentTitle, p.label), snippet: p.text.replace(/\s+/g, " ").slice(0, 240) })),
    };
  } catch (e) {
    console.error("[suggestSources]", e instanceof Error ? e.message : e);
    return { ok: false, error: "The library search didn't work. Try again." };
  }
}

/** The approved sections, in the author's order (so "P1", "P2", … mean the same thing on every call). */
async function sources(chunkIds: string[]) {
  const ids = [...new Set(chunkIds)].slice(0, MAX_SOURCES);
  const loaded = await loadPassages(ids);
  const ordered = ids.flatMap((id) => loaded.filter((p) => p.id === id));
  return numberSources(ordered);
}

function aiError(e: unknown, what: string) {
  console.error(`[${what}]`, e instanceof Error ? e.message : e);
  return { ok: false as const, error: "The AI didn't finish. Try again in a moment." };
}

/** Plan the slides: topics, titles and the point each teaches. Nothing is saved. */
export async function draftOutline(moduleId: string, token: string, chunkIds: string[]): Promise<Result<{ outline: OutlineSlide[] }>> {
  const e = await editing(moduleId, token);
  if (!e.ok) return e;
  const m = await moduleInfo(e.admin, moduleId);
  if (!m) return { ok: false, error: "Module not found." };
  if (!m.objectives.length) return { ok: false, error: "Add the module's learning objectives first." };
  if (!chunkIds.length) return { ok: false, error: "Choose at least one Legislation Library section to work from." };
  try {
    const [src, { data: all }, { data: existing }] = await Promise.all([
      sources(chunkIds),
      e.admin.from("training_modules").select("id, title, summary, order_index, track:training_tracks(title, order_index)"),
      e.admin.from("training_slides").select("title, position").eq("module_id", moduleId).order("position"),
    ]);
    const curriculum = (all ?? [])
      .map((r) => {
        const t = (Array.isArray(r.track) ? r.track[0] : r.track) as { title: string; order_index: number } | null;
        return { track: t?.title ?? "", trackOrder: t?.order_index ?? 0, order: r.order_index as number, title: r.title as string, summary: (r.summary as string) ?? "", current: r.id === moduleId };
      })
      .sort((a, b) => a.trackOrder - b.trackOrder || a.order - b.order);
    const raw = await askClaudeJson<unknown>({
      system: [
        { type: "text", text: WRITER_SYSTEM },
        { type: "text", text: src.text },
      ],
      cache: true,
      messages: [
        {
          role: "user",
          content: outlineRequest({ ...m, curriculum, existingTitles: (existing ?? []).map((s) => s.title as string).filter(Boolean) }),
        },
      ],
      schema: outlineSchema,
      effort: "high",
      maxTokens: 12000,
    });
    const outline = normalizeOutline(raw, new Set(src.ids.keys()));
    if (!outline.length) return { ok: false, error: "The AI didn't return an outline. Try again." };
    return { ok: true, outline };
  } catch (err) {
    return aiError(err, "draftOutline");
  }
}

/**
 * Write one slide of the outline and add it after the module's last
 * slide. A reply that breaks the limits (more than 50 words, the wrong
 * names) gets one more try with the problem pointed out; if it's still
 * not right, the slide is saved anyway and the builder flags it.
 */
export async function writeSlide(
  moduleId: string,
  token: string,
  input: { chunkIds: string[]; outline: unknown; index: number }
): Promise<Result<{ slide: Slide; problems: string[] }>> {
  const e = await editing(moduleId, token);
  if (!e.ok) return e;
  const m = await moduleInfo(e.admin, moduleId);
  if (!m) return { ok: false, error: "Module not found." };
  try {
    const src = await sources(input.chunkIds);
    const known = new Set(src.ids.keys());
    const outline = normalizeOutline(input.outline, known);
    const planned = outline[input.index];
    if (!planned) return { ok: false, error: "That slide isn't in the outline." };
    const { data: existing } = await e.admin.from("training_slides").select("title, body, position").eq("module_id", moduleId).order("position");
    const names = namesForSlides(outline.length, `${moduleId}:${outline[0]?.title ?? ""}`)[input.index];
    const written = (existing ?? []).map((s) => ({ title: s.title as string, body: s.body as string }));

    let draft: DraftedSlide | null = null;
    let problems: string[] = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      const raw = await askClaudeJson<unknown>({
        system: [
          { type: "text", text: WRITER_SYSTEM },
          { type: "text", text: src.text },
        ],
        cache: true,
        messages: [
          {
            role: "user",
            content: slideRequest({ module: m, outline, index: input.index, written, names, feedback: problems.length ? problems.join(" ") : undefined }),
          },
        ],
        schema: slideSchema,
        effort: "medium",
        maxTokens: 8000,
      });
      draft = toDraftedSlide(raw, planned, known);
      problems = draftProblems(draft, planned, names);
      if (!problems.length) break;
    }
    if (!draft) return { ok: false, error: "The AI didn't write the slide. Try again." };

    const citations = await verifiedCitations(draft.sourceIds.map((id) => src.ids.get(id)!).filter(Boolean));
    const position = ((existing ?? []).reduce((n, s) => Math.max(n, s.position as number), 0) as number) + 1;
    const { data: row, error } = await e.admin
      .from("training_slides")
      .insert({
        module_id: moduleId,
        position,
        topic: planned.topic,
        title: draft.title,
        body: draft.body,
        layout: draft.element?.type === "knowledge_check" ? "text" : "photo",
        narration_script: draft.narrationScript,
        element: draft.element,
        citations,
      })
      .select("id")
      .single();
    if (error || !row) {
      console.error("[writeSlide] insert", error?.message);
      return { ok: false, error: "The slide was written but couldn't be saved. Try again." };
    }
    const slide = await readSlide(e.admin, moduleId, row.id as string);
    return slide ? { ok: true, slide, problems } : { ok: false, error: "The slide was saved but couldn't be read back. Reload the page." };
  } catch (err) {
    return aiError(err, "writeSlide");
  }
}
