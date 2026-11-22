import { detectCurrentTo } from "./legislation.ts";

/**
 * Knowledge Base entries kept current from BC Laws (0101). An entry with a
 * BC Laws link is fetched from the King's Printer's own site, turned into
 * plain text that parseSections() reads section by section, and
 * re-indexed whenever BC Laws publishes a newer consolidation. Nothing is
 * fetched from anywhere else: the link must be a BC Laws "complete
 * document" link, checked here and by the table's constraint.
 */

export const BC_LAWS_ORIGIN = "https://www.bclaws.gov.bc.ca";
const DOC_PATH = "/civix/document/id/complete/statreg/";
const ID = /^[A-Za-z0-9_]{2,40}$/;

/** "https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/98043_00" -> "98043_00"; anything else -> null. */
export function bcLawsDocumentId(link: string): string | null {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    return null;
  }
  if (url.origin !== BC_LAWS_ORIGIN || !url.pathname.startsWith(DOC_PATH)) return null;
  const id = url.pathname.slice(DOC_PATH.length).replace(/\/+$/, "");
  return ID.test(id) ? id : null;
}

export function bcLawsUrl(id: string) {
  return `${BC_LAWS_ORIGIN}${DOC_PATH}${id}`;
}

/** The canonical link for whatever was entered, or null if it isn't a BC Laws document link. */
export function normalizeBcLawsLink(link: string): string | null {
  const id = bcLawsDocumentId(link);
  return id ? bcLawsUrl(id) : null;
}

/**
 * Long Acts are published in parts: "98043_00" is the contents page and
 * "98043_01" to "98043_18" are the Act. Returns the part ids linked from a
 * contents page, in order, or [] for a document published whole.
 */
export function bcLawsPartIds(html: string, id: string): string[] {
  if (!id.endsWith("_00")) return [];
  const base = id.slice(0, -3);
  const found = new Set<string>();
  const re = new RegExp(`\\b${base}_(\\d{2})\\b`, "g");
  for (const m of html.matchAll(re)) if (m[1] !== "00") found.add(`${base}_${m[1]}`);
  return [...found].sort();
}

function decodeEntities(s: string) {
  return s
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

/**
 * A BC Laws page as plain text, one block per line. Whitespace inside the
 * markup is collapsed first, so a section number and its text stay on one
 * line ("98 (1) If a proposed expenditure..."), with its heading on the
 * line above: the shape parseSections() expects.
 */
export function bcLawsHtmlToText(html: string): string {
  let h = html.replace(/<(script|style|noscript|head)\b[\s\S]*?<\/\1>/gi, " ");
  h = h.replace(/\s+/g, " ");
  h = h
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|table|section|article)>/gi, "\n")
    .replace(/<(p|h[1-6]|tr|li)\b[^>]*>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " ")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(h)
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

const TIMEOUT_MS = 30_000;

async function getPage(id: string): Promise<string> {
  const res = await fetch(bcLawsUrl(id), {
    redirect: "error",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { accept: "text/html" },
  });
  if (!res.ok) throw new Error(`BC Laws returned ${res.status} for ${id}.`);
  return res.text();
}

/** Just the "current to" date of a BC Laws document: one request. */
export async function fetchBcLawsCurrentTo(link: string): Promise<string | null> {
  const id = bcLawsDocumentId(link);
  if (!id) throw new Error("That isn't a BC Laws document link.");
  return detectCurrentTo(bcLawsHtmlToText(await getPage(id)));
}

/** The whole document as text (every part of a long Act), and its "current to" date. */
export async function fetchBcLawsText(link: string): Promise<{ text: string; currentTo: string | null; parts: number }> {
  const id = bcLawsDocumentId(link);
  if (!id) throw new Error("That isn't a BC Laws document link.");
  const first = await getPage(id);
  const partIds = bcLawsPartIds(first, id);
  const pages = partIds.length ? [] : [first];
  for (const part of partIds) pages.push(await getPage(part));
  const text = pages.map(bcLawsHtmlToText).join("\n");
  if (text.length < 500) throw new Error("BC Laws returned almost no text.");
  return { text, currentTo: detectCurrentTo(text) ?? detectCurrentTo(bcLawsHtmlToText(first)), parts: Math.max(partIds.length, 1) };
}
