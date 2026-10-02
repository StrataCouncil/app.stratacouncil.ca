import { chunkText } from "./chunk.ts";

/**
 * Splitting BC legislation into citable pieces (doc04 §5). Acts and
 * regulations as published on BC Laws read:
 *
 *   Part 4 — Meetings
 *   ...
 *   Notice of general meetings            <- heading line
 *   45 (1) The strata corporation must... <- section number starts a line
 *
 * Each section becomes its own chunk (split further only when it's long),
 * headed with the Act, section number and heading, so retrieval matches on
 * them and an answer can cite "Strata Property Act, s. 45".
 *
 * Pure, no network. Anything that doesn't look sectioned (guidance, or an
 * extraction that lost its line breaks) falls back to ordinary chunks.
 */

export interface LegislationSection {
  number: string;
  heading: string | null;
  part: string | null;
  body: string;
}

export interface LegislationChunk {
  /** Short label stored as the chunk's title, e.g. "s. 45 Notice of general meetings". */
  title: string;
  /** What's embedded and shown to Stratasphere: a citation header, then the text. */
  text: string;
}

const SECTION_START = /^(\d{1,3}(?:\.\d{1,3})?(?:-\d{1,3}(?:\.\d{1,3})?)?)\s+(?=\(\d+(?:\.\d+)?\)|\[Repealed|\(?[A-Z"“])/;
/** "75 [Repealed 2021-2-96.]" or "46 Repealed." */
const REPEALED = /^\S+\s+\[?(Repealed|Spent)\b/;
/** Heading and number on one line: "Notice of general meetings 45 (1) The strata corporation..." */
const INLINE_START = /^([A-Z][^.;:]{2,98}?)\s+(\d{1,3}(?:\.\d{1,2})?)\s+(?=\(1\)\s)/;
/** A prescribed form ("Form A", "Form K.1") starts here; everything up to the next one is that form. */
const FORM_LINE = /^Form\s+[A-Z](?:\.\d+)?$/;
/** King's Printer page furniture, not law. */
const BOILERPLATE = /^(Copyright ©.*|Victoria, British Columbia, Canada(\s+Licence)?|Disclaimer)$/;
/** "Schedule of Standard Bylaws", when it opens a block of Divisions rather than heading a section. */
const SCHEDULE_LINE = /^Schedule of [A-Z]/;
const PART_LINE = /^(Part|Division|Schedule)\s+[\dA-Z.]+\b.*$/;
/** Fewer than this many characters after the number is a contents-page entry, not a section. */
const MIN_SECTION_BODY = 40;
const MIN_SECTIONS = 5;

/**
 * Only the whole number is compared: inserted sections don't sort as
 * decimals (6.2, 6.21, 6.22, 6.3 in the Strata Property Regulation).
 */
function sectionValue(n: string) {
  return Number(n.split("-")[0].split(".")[0]);
}

function isHeadingLine(line: string) {
  return (
    line.length > 0 &&
    line.length <= 160 &&
    /^[A-Z]/.test(line) &&
    (!/[.;:,]$/.test(line) || /\b[A-Z]\.[A-Z]\.$/.test(line)) &&
    !SECTION_START.test(line) &&
    !PART_LINE.test(line)
  );
}

export function parseSections(text: string): LegislationSection[] {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => !BOILERPLATE.test(l));
  const sections: LegislationSection[] = [];
  let current: { number: string; heading: string | null; part: string | null; lines: string[] } | null = null;
  let part: string | null = null;
  let top: string | null = null;
  let division: string | null = null;
  let last = 0;

  const flush = () => {
    if (!current) return;
    const body = current.lines.join("\n").trim();
    if (body.replace(/^\S+\s*/, "").length >= MIN_SECTION_BODY) {
      sections.push({ number: current.number, heading: current.heading, part: current.part, body });
    }
    current = null;
  };

  let inForms = false;
  const partsSeen = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Forms come after the sections. Inside one, numbered lines are the
    // form's own items, not sections.
    if (FORM_LINE.test(line) && (sections.length || current) && formTitleAfter(lines, i)) {
      flush();
      inForms = true;
      current = { number: line, heading: null, part: null, lines: [] };
      continue;
    }
    if (inForms) {
      if (current && !current.heading && line && !/^[([]/.test(line)) current.heading = sentenceCase(line);
      if (current) current.lines.push(line);
      continue;
    }
    const isSchedule = SCHEDULE_LINE.test(line) && PART_LINE.test(nextLine(lines, i));
    if ((PART_LINE.test(line) || isSchedule) && line.length <= 120) {
      flush();
      const label = line.replace(/\s+/g, " ");
      if (/^Division\b/.test(label)) {
        division = label;
      } else {
        top = label;
        division = null;
      }
      part = division && top ? `${top}; ${division}` : (division ?? top);
      // A Part seen before means the contents page is over: numbering starts again.
      if (partsSeen.has(part!)) last = 0;
      partsSeen.add(part!);
      continue;
    }
    const plain = SECTION_START.exec(line);
    const inline = plain ? null : INLINE_START.exec(line);
    const m = plain ? { number: plain[1], heading: null as string | null, rest: line } : inline
      ? { number: inline[2], heading: inline[1].trim(), rest: line.slice(inline[1].length).trim() }
      : null;
    if (m) {
      const value = sectionValue(m.number);
      // Numbers climb through an Act. A smaller number is either a restart
      // (the body after a contents page, or a new schedule: allowed from 1)
      // or a stray number at the start of a wrapped line (ignored). A big
      // jump is a stray number too (a year, a page number).
      const restart = value <= 1;
      const plausible = restart || last === 0 || (value >= last && value <= last + 60);
      if (plausible) {
        flush();
        let back = i - 1;
        while (back >= 0 && !lines[back]) back--;
        const prev = lines[back] ?? "";
        const headingAbove = !m.heading && isHeadingLine(prev) ? prev : null;
        // A heading line above was already appended to the previous section's body; take it back.
        if (headingAbove && sections.length) {
          const before = sections[sections.length - 1];
          if (before.body.endsWith(`\n${headingAbove}`)) {
            before.body = before.body.slice(0, -headingAbove.length - 1).trim();
            if (before.body.replace(/^\S+\s*/, "").length < MIN_SECTION_BODY) sections.pop();
          }
        }
        current = { number: m.number, heading: m.heading ?? headingAbove, part, lines: [m.rest] };
        last = value;
        continue;
      }
    }
    if (current) current.lines.push(line);
  }
  flush();
  return tidy(sections);
}

/**
 * The contents page repeats every section number and heading. Where a
 * number appears twice in the same Part, keep the fuller one (the body);
 * then, if most sections have headings, drop one-line sections without one
 * (contents entries with no body twin, consequential-amendment tables).
 */
function tidy(sections: LegislationSection[]) {
  const best = new Map<string, LegislationSection>();
  for (const s of sections) {
    const key = `${s.part ?? ""}|${s.number}`;
    const seen = best.get(key);
    if (!seen || s.body.length > seen.body.length) best.set(key, s);
  }
  let out = sections.filter((s) => best.get(`${s.part ?? ""}|${s.number}`) === s && !REPEALED.test(s.body));
  const headed = out.filter((s) => s.heading).length;
  // Unheaded leftovers in a headed Act are table rows ("52 Credit Union Incorporation Act"):
  // a short first line with no sentence punctuation and no subsection.
  const looksLikeRow = (s: LegislationSection) => {
    const first = s.body.split("\n")[0];
    return first.length < 100 && !/[.:;,]$/.test(first) && !/^\S+\s+\(/.test(first);
  };
  if (headed >= out.length / 2) {
    out = out.filter((s) => s.heading || (s.body.includes("\n") && !s.number.includes("-") && !looksLikeRow(s)));
  }
  return out;
}

/**
 * A real form opens with its title in capitals ("PROXY APPOINTMENT"),
 * after any amendment note or "(Section 56)". A "Form A" line in the
 * contents doesn't.
 */
function formTitleAfter(lines: string[], i: number) {
  for (let j = i + 1; j < Math.min(lines.length, i + 8); j++) {
    const l = lines[j];
    if (!l || /^[([]/.test(l)) continue;
    return /[A-Z]{3}/.test(l) && l === l.toUpperCase() && !FORM_LINE.test(l);
  }
  return false;
}

function nextLine(lines: string[], i: number) {
  for (let j = i + 1; j < lines.length; j++) if (lines[j]) return lines[j];
  return "";
}

function sentenceCase(line: string) {
  return line === line.toUpperCase() ? line.charAt(0) + line.slice(1).toLowerCase() : line;
}

/** "This Act is current to August 5, 2026" -> "2026-08-05". */
export function detectCurrentTo(text: string): string | null {
  const m = /current to\s+([A-Z][a-z]+\.?\s+\d{1,2},\s+\d{4})/i.exec(text.slice(0, 20000));
  if (!m) return null;
  const d = new Date(`${m[1].replace(".", "")} UTC`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function citation(title: string, shortName: string | null | undefined, currentTo: string | null) {
  const name = shortName ? `${title} (${shortName})` : title;
  return currentTo ? `${name}, current to ${currentTo}` : name;
}

export function chunkLegislation(
  text: string,
  {
    title,
    shortName,
    kind,
    currentTo,
  }: { title: string; shortName?: string | null; kind: "act" | "regulation" | "guidance"; currentTo: string | null }
): { chunks: LegislationChunk[]; sections: number } {
  const source = citation(title, shortName, currentTo);
  if (kind !== "guidance") {
    const sections = parseSections(text);
    if (sections.length >= MIN_SECTIONS) {
      const chunks: LegislationChunk[] = [];
      for (const s of sections) {
        const isForm = s.number.startsWith("Form");
        const isStandardBylaw = /^Schedule of Standard Bylaws/.test(s.part ?? "");
        const ref = isForm ? s.number : isStandardBylaw ? `Standard Bylaw ${s.number}` : `s. ${s.number}`;
        const long = isForm ? s.number : isStandardBylaw ? `Standard Bylaw ${s.number}` : `section ${s.number}`;
        const label = `${ref}${s.heading ? ` ${s.heading}` : ""}`;
        const header = `${source}, ${long}${s.heading ? `: ${s.heading}` : ""}${s.part ? ` [${s.part}]` : ""}`;
        const pieces = chunkText(s.body);
        pieces.forEach((piece, i) => {
          chunks.push({
            title: label.slice(0, 200),
            text: `${header}${pieces.length > 1 ? ` (part ${i + 1} of ${pieces.length})` : ""}\n${piece}`,
          });
        });
      }
      return { chunks, sections: sections.length };
    }
  }
  return {
    chunks: chunkText(text).map((piece) => ({ title: title.slice(0, 200), text: `${source}\n${piece}` })),
    sections: 0,
  };
}
