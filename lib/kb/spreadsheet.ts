import JSZip from "jszip";

/**
 * Text out of a spreadsheet, on our own servers, so Stratasphere can read
 * budgets and other workbooks. Each sheet becomes a heading and one line
 * per row, cells separated by " | ". Cell values are what the sheet shows
 * after its last save (formulas give their saved result). Dates come out
 * as YYYY-MM-DD; other number formats come out as plain numbers.
 */

const CELL_SEP = " | ";

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");
}

/** The text of every <t> in a fragment (a shared string or an inline string, rich text included). */
function textRuns(xml: string): string {
  return [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1])).join("");
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? decodeXml(m[1]) : null;
}

/** "B12" → column index 1 (zero-based). */
function columnIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

/** Which cell style indexes format numbers as dates. */
function dateStyles(stylesXml: string | null): Set<number> {
  const out = new Set<number>();
  if (!stylesXml) return out;
  const customDate = new Set<number>();
  for (const m of stylesXml.matchAll(/<numFmt\s[^>]*>/g)) {
    const id = Number(attr(m[0], "numFmtId"));
    const code = (attr(m[0], "formatCode") ?? "").replace(/"[^"]*"|\[[^\]]*\]|\\./g, "");
    if (/[dmy]/i.test(code) && !/^[#0.,%\s]*$/.test(code)) customDate.add(id);
  }
  const cellXfs = stylesXml.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? "";
  [...cellXfs.matchAll(/<xf\s[^>]*?\/?>/g)].forEach((m, i) => {
    const id = Number(attr(m[0], "numFmtId") ?? "0");
    if (BUILTIN_DATE_FORMATS.has(id) || customDate.has(id)) out.add(i);
  });
  return out;
}

/** An Excel serial date (1900 system) as YYYY-MM-DD. */
export function excelDate(serial: number): string {
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  return new Date(ms).toISOString().slice(0, 10);
}

function rowsToText(rows: string[][]): string {
  return rows
    .map((cells) => {
      let end = cells.length;
      while (end > 0 && !cells[end - 1]) end--;
      return cells.slice(0, end).map((c) => c.replace(/\s+/g, " ").trim()).join(CELL_SEP);
    })
    .filter((line) => line.replace(/[|\s]/g, ""))
    .join("\n");
}

/** Every sheet of an .xlsx workbook as text. */
export async function xlsxText(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const read = async (name: string) => (zip.file(name) ? await zip.file(name)!.async("string") : null);

  const workbook = (await read("xl/workbook.xml")) ?? "";
  const rels = (await read("xl/_rels/workbook.xml.rels")) ?? "";
  const shared = await read("xl/sharedStrings.xml");
  const strings = shared ? [...shared.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textRuns(m[1])) : [];
  const dates = dateStyles(await read("xl/styles.xml"));

  const targets = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\s[^>]*>/g)) {
    const id = attr(m[0], "Id");
    const target = attr(m[0], "Target");
    if (id && target) targets.set(id, target.replace(/^\/?(xl\/)?/, "xl/"));
  }

  const sections: string[] = [];
  for (const m of workbook.matchAll(/<sheet\s[^>]*>/g)) {
    const name = attr(m[0], "name") ?? "Sheet";
    const relId = attr(m[0], "r:id");
    const path = relId ? targets.get(relId) : null;
    const xml = path ? await read(path) : null;
    if (!xml) continue;

    const rows: string[][] = [];
    for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];
      for (const c of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const tag = `<c${c[1]}>`;
        const body = c[2] ?? "";
        const type = attr(tag, "t");
        const ref = attr(tag, "r");
        const style = Number(attr(tag, "s") ?? "0");
        const raw = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
        let value = "";
        if (type === "s" && raw !== undefined) value = strings[Number(raw)] ?? "";
        else if (type === "inlineStr") value = textRuns(body);
        else if (type === "b") value = raw === "1" ? "TRUE" : raw === "0" ? "FALSE" : "";
        else if (raw !== undefined) {
          const decoded = decodeXml(raw);
          const n = Number(decoded);
          value = type !== "str" && type !== "e" && dates.has(style) && Number.isFinite(n) ? excelDate(n) : decoded;
        }
        const col = ref ? columnIndex(ref) : cells.length;
        while (cells.length < col) cells.push("");
        cells[col] = value;
      }
      rows.push(cells);
    }
    const text = rowsToText(rows);
    if (text) sections.push(`Sheet: ${name}\n${text}`);
  }
  return sections.join("\n\n");
}

/** A CSV file as text, one line per row. Handles quoted cells, commas and line breaks inside quotes. */
export function csvText(source: string): string {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const s = source.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rowsToText(rows);
}
