/**
 * The Library's markup: how a playbook, guide or template is written and
 * stored (library_resources.draft_markup, 0049). Close to Markdown, so
 * staff can edit it by hand, with a few additions for boxes:
 *
 *   ## Step 1. Assess the situation {0–5 min}   heading, optional timing
 *   ### If water is near electrical equipment    subheading
 *   Plain lines are paragraphs (blank line between them).
 *   - bullet          1. numbered          [ ] checklist item
 *   | Question | Who decides |                   table (first row is the header;
 *   |---|---|                                     the dashes line is optional)
 *   :::summary The first 30 minutes               a box, until a line with :::
 *   :::important   :::warning   :::note   :::sample Notice to owners
 *   :::fineprint                                  small print, no box (a disclaimer)
 *   **bold** works anywhere in a line.
 *
 * Pure, so the console's preview and the members' page read it the same way.
 */

export const MARKUP_MAX_CHARS = 60000;

export const BOX_TONES = ["summary", "important", "warning", "note", "sample", "fineprint"] as const;
export type BoxTone = (typeof BOX_TONES)[number];

export type Block =
  | { type: "heading"; level: 2 | 3; text: string; timing: string | null; id: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; style: "bullet" | "number" | "check"; items: string[] }
  | { type: "table"; head: string[]; rows: string[][] }
  | { type: "box"; tone: BoxTone; title: string | null; blocks: Block[] };

const BULLET = /^\s*[-*•]\s+(?!\[[ xX]?\]\s)(.*)$/;
const NUMBER = /^\s*\d{1,2}[.)]\s+(.*)$/;
const CHECK = /^\s*(?:[-*]\s+)?\[[ xX]?\]\s+(.*)$/;
const HEADING = /^(#{2,3})\s+(.+?)\s*$/;
const FENCE = /^\s*:::\s*([a-z]*)\s*(.*)$/i;
const TABLE = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/** "Step 1 {0–5 min}" → ["Step 1", "0–5 min"]. */
function splitTiming(text: string): [string, string | null] {
  const m = text.match(/^(.*?)\s*\{([^{}]{1,40})\}\s*$/);
  return m ? [m[1].trim(), m[2].trim()] : [text.trim(), null];
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/\*\*/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());

function parseLines(lines: string[], ids: Map<string, number>): Block[] {
  const out: Block[] = [];
  let para: string[] = [];
  let list: { style: "bullet" | "number" | "check"; items: string[] } | null = null;
  let table: string[][] | null = null;

  const flush = () => {
    if (para.length) out.push({ type: "paragraph", text: para.join(" ") });
    if (list && list.items.length) out.push({ type: "list", ...list });
    if (table && table.length) {
      const [head, ...rows] = table;
      const width = head.length;
      out.push({ type: "table", head, rows: rows.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? "")) });
    }
    para = [];
    list = null;
    table = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\s+$/, "");
    if (!line.trim()) {
      flush();
      continue;
    }

    const fence = line.match(FENCE);
    if (fence) {
      flush();
      const tone = fence[1].toLowerCase();
      if (!(BOX_TONES as readonly string[]).includes(tone)) continue; // a stray closing ":::"
      const inner: string[] = [];
      i++;
      while (i < lines.length && !/^\s*:::\s*$/.test(lines[i])) inner.push(lines[i++]);
      out.push({ type: "box", tone: tone as BoxTone, title: fence[2].trim() || null, blocks: parseLines(inner, ids) });
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      flush();
      const [text, timing] = splitTiming(heading[2]);
      const base = slugify(text) || "section";
      const n = ids.get(base) ?? 0;
      ids.set(base, n + 1);
      out.push({ type: "heading", level: heading[1].length === 2 ? 2 : 3, text, timing, id: n ? `${base}-${n + 1}` : base });
      continue;
    }

    if (TABLE.test(line)) {
      if (!table) {
        flush();
        table = [];
      }
      if (!TABLE_RULE.test(line)) table.push(cells(line));
      continue;
    }
    if (table) flush();

    const check = line.match(CHECK);
    const bullet = !check && line.match(BULLET);
    const number = !check && !bullet && line.match(NUMBER);
    const item = check ?? bullet ?? number;
    if (item) {
      const style = check ? "check" : bullet ? "bullet" : "number";
      if (para.length || (list && list.style !== style)) flush();
      if (!list) list = { style, items: [] };
      list.items.push(item[1].trim());
      continue;
    }

    // An indented line right after a list item continues it.
    if (list && /^\s{2,}\S/.test(lines[i])) {
      list.items[list.items.length - 1] += ` ${line.trim()}`;
      continue;
    }
    if (list) flush();
    para.push(line.trim());
  }
  flush();
  return out;
}

export function parseMarkup(markup: string): Block[] {
  return parseLines(String(markup ?? "").slice(0, MARKUP_MAX_CHARS).replace(/\r\n?/g, "\n").split("\n"), new Map());
}

/** "Call **911** now" → ["Call ", {bold: "911"}, " now"]. */
export function inlineParts(text: string): Array<string | { bold: string }> {
  const out: Array<string | { bold: string }> = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push({ bold: m[1] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** The text of every block, for search and for checking an item isn't empty. */
export function plainText(blocks: Block[]): string {
  return blocks
    .map((b) => {
      if (b.type === "heading" || b.type === "paragraph") return b.text;
      if (b.type === "list") return b.items.join(" ");
      if (b.type === "table") return [...b.head, ...b.rows.flat()].join(" ");
      return [b.title ?? "", plainText(b.blocks)].join(" ");
    })
    .join(" ")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
