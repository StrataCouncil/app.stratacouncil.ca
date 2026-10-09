import { knowledgeResourceKindLabels, type KnowledgeResourceKind } from "../placeholder-data.ts";
import { MARKUP_MAX_CHARS } from "./markup.ts";

/**
 * Library items (0049): shared shapes and the tidying the AI's reply and
 * the console's edits both go through. Pure.
 */

export const LIBRARY_KINDS = Object.keys(knowledgeResourceKindLabels) as KnowledgeResourceKind[];
export const PASTE_MAX_CHARS = 40000;
export const SOURCES_MAX = 20;
export const CLAIMS_MAX = 15;

/** A Legislation Library section an item cites. */
export interface LibrarySource {
  chunkId: string;
  label: string;
}

/** A statement the AI flagged for checking, with the sections that may support it. */
export interface LibraryClaim {
  statement: string;
  query: string;
  suggestions: Array<LibrarySource & { snippet: string }>;
}

/** What members read. */
export interface PublishedLibraryItem {
  kind: KnowledgeResourceKind;
  title: string;
  summary: string;
  tags: string[];
  markup: string;
  sources: LibrarySource[];
}

/** An item as the console edits it. */
export interface LibraryDraft extends PublishedLibraryItem {
  id: string;
  claims: LibraryClaim[];
  publishedAt: string | null;
  updatedAt: string;
  /** The draft differs from what members see. */
  changed: boolean;
}

const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

export function normalizeKind(v: unknown): KnowledgeResourceKind {
  return LIBRARY_KINDS.includes(v as KnowledgeResourceKind) ? (v as KnowledgeResourceKind) : "playbook";
}

export function normalizeTags(v: unknown): string[] {
  const list = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [];
  return [...new Set(list.map((t) => str(t, 40).toLowerCase()).filter(Boolean))].slice(0, 8);
}

export function normalizeSources(v: unknown): LibrarySource[] {
  const seen = new Set<string>();
  return (Array.isArray(v) ? v : [])
    .map((x) => {
      const o = (x ?? {}) as Record<string, unknown>;
      return { chunkId: str(o.chunkId, 64), label: str(o.label, 300) };
    })
    .filter((s) => s.chunkId && !seen.has(s.chunkId) && seen.add(s.chunkId))
    .slice(0, SOURCES_MAX);
}

export function normalizeClaims(v: unknown): LibraryClaim[] {
  return (Array.isArray(v) ? v : [])
    .map((x) => {
      const o = (x ?? {}) as Record<string, unknown>;
      return {
        statement: str(o.statement, 500),
        query: str(o.query, 300),
        suggestions: (Array.isArray(o.suggestions) ? o.suggestions : []).slice(0, 4).map((s) => {
          const p = (s ?? {}) as Record<string, unknown>;
          return { chunkId: str(p.chunkId, 64), label: str(p.label, 300), snippet: str(p.snippet, 400) };
        }),
      };
    })
    .filter((c) => c.statement)
    .slice(0, CLAIMS_MAX);
}

export function normalizeItem(raw: unknown): PublishedLibraryItem {
  const o = (raw ?? {}) as Record<string, unknown>;
  return {
    kind: normalizeKind(o.kind),
    title: str(o.title, 200),
    summary: str(o.summary, 600),
    tags: normalizeTags(o.tags),
    markup: typeof o.markup === "string" ? o.markup.replace(/\r\n?/g, "\n").trim().slice(0, MARKUP_MAX_CHARS) : "",
    sources: normalizeSources(o.sources),
  };
}

/** Why an item can't be published yet, if anything. */
export function publishProblems(item: PublishedLibraryItem): string[] {
  const p: string[] = [];
  if (!item.title) p.push("Give it a title.");
  if (!item.summary) p.push("Add a one-line summary.");
  if (item.markup.length < 40) p.push("Add the content.");
  return p;
}

export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
