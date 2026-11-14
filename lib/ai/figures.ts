/**
 * Does an answer state a key figure? (The recall check, lib/ai/recall.ts.)
 * Figures are matched by value, not by spelling:
 *
 *   "$23,333.33"   matches 23,333.33, $23333.33, or 23 333,33 written as 23,333.33
 *   "5 months"     matches "5 months" (the number, then the word)
 *   "4.5%"         matches 4.5% or 4.5 per cent
 *   "2027-01-31"   matches 2027-01-31, January 31, 2027, Jan 31, 2027, or 31 January 2027
 *
 * A number in the answer matches when it equals the figure to the figure's
 * own decimal places ("$4,666.67" is found in "$4,666.67", not in "$4,666.70"
 * or "$4,667"). Anything else is matched as text, ignoring case and spacing.
 * Pure: unit-tested in tests/figures.test.ts.
 */

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

const squash = (s: string) =>
  s
    .normalize("NFKC")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

interface NumericFigure {
  value: number;
  decimals: number;
  unit: string;
}

/** A figure that's a number: optional $, the number, an optional unit (%, months, days...). */
export function parseNumericFigure(figure: string): NumericFigure | null {
  const m = /^\s*(?:us\$|ca\$|c\$|\$)?\s*(-?\d{1,3}(?:,\d{3})+|-?\d+)(\.\d+)?\s*(%|[a-z][a-z ]*)?\s*$/i.exec(figure);
  if (!m) return null;
  const whole = m[1].replace(/,/g, "");
  const decimals = m[2] ? m[2].length - 1 : 0;
  return { value: Number(`${whole}${m[2] ?? ""}`), decimals, unit: (m[3] ?? "").trim().toLowerCase() };
}

/** Every number in a text, with what follows it. */
function numbersIn(text: string): Array<{ value: number; after: string }> {
  const out: Array<{ value: number; after: string }> = [];
  const re = /(?<![\d.])-?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(?![\d])/g;
  for (const m of text.matchAll(re)) {
    // "2026-09-01": the parts of a date aren't amounts.
    const before = text[m.index! - 1];
    const next = text[m.index! + m[0].length];
    if (before === "-" && /\d/.test(text[m.index! - 2] ?? "")) continue;
    if (next === "-" && /\d/.test(text[m.index! + m[0].length + 1] ?? "")) continue;
    out.push({ value: Number(`${m[0].replace(/,/g, "")}`), after: text.slice(m.index! + m[0].length, m.index! + m[0].length + 20) });
  }
  return out;
}

function unitFollows(after: string, unit: string): boolean {
  if (!unit) return true;
  const a = squash(after);
  if (unit === "%") return a.startsWith("%") || a.startsWith("per cent") || a.startsWith("percent");
  // "month" matches "months", and the reverse.
  const stem = unit.replace(/s$/, "");
  return a.startsWith(stem);
}

/** Every way a date could be written in an answer. */
function dateSpellings(iso: string): string[] | null {
  const m = /^\s*(\d{4})-(\d{2})-(\d{2})\s*$/.exec(iso);
  if (!m) return null;
  const [y, mo, d] = [m[1], Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const long = MONTHS[mo - 1];
  const short = long.slice(0, 3);
  return [`${y}-${m[2]}-${m[3]}`, `${long} ${d}, ${y}`, `${short} ${d}, ${y}`, `${short}. ${d}, ${y}`, `${d} ${long} ${y}`, `${long} ${d} ${y}`, `${d} ${short} ${y}`];
}

export function figureFound(answer: string, figure: string): boolean {
  const f = figure.trim();
  if (!f) return false;
  const text = squash(answer);

  const dates = dateSpellings(f);
  if (dates) return dates.some((s) => text.includes(s));

  const n = parseNumericFigure(f);
  if (n) {
    const scale = 10 ** n.decimals;
    return numbersIn(text).some((x) => Math.round(x.value * scale) === Math.round(n.value * scale) && Number(x.value.toFixed(n.decimals)) === x.value && unitFollows(x.after, n.unit));
  }
  return text.includes(squash(f));
}

/** One figure per line, trimmed, empty lines dropped. */
export function figureLines(v: string): string[] {
  return v
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 100)
    .map((l) => l.slice(0, 200));
}
