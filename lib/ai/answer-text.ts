/**
 * Stratasphere's answers as people read them (lib/ai/stratasphere.ts):
 * plain text in paragraphs, with nothing the person shouldn't see.
 *
 *  - Citation tags. Every record sent with a question carries a tag (D1 a
 *    document's passages, L2 a Knowledge Base section, E14 a ledger
 *    decision, and so on), and the answer puts the tags it used in square
 *    brackets after each fact: "...by January 19, 2028 [L1, E3]." The tags
 *    become the answer's sources; the brackets are taken out of the text.
 *  - Markup symbols and emoji: asterisks, pound-sign headings, bullet
 *    dashes, emoji. Never shown, even if the model writes them.
 *  - Spacing: paragraphs separated by one blank line.
 *
 * Works on a stream too (answerCleaner): text that might still turn into a
 * tag or a symbol is held back until the next piece shows what it is.
 * Pure: unit-tested in tests/answer-text.test.ts.
 */

const TAG = "[A-Z]\\d{0,4}";
const TAG_LIST = new RegExp(`[ \\t]*\\[(${TAG}(?:\\s*[,;]\\s*${TAG})*)\\]`, "g");
// ™, ©, and ® are pictographic in Unicode but belong in names ("Stratasphere™").
const EMOJI = /(?![™©®])[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}]/gu;

function tagsIn(list: string): string[] {
  return list.split(/[,;]/).map((t) => t.trim()).filter(Boolean);
}

/** The tags an answer cites, in the order it first cites them (only tags that were sent). */
export function citedTags(raw: string, valid: Set<string>): string[] {
  const out: string[] = [];
  for (const m of raw.matchAll(TAG_LIST)) {
    const tags = tagsIn(m[1]);
    if (!tags.every((t) => valid.has(t))) continue;
    for (const t of tags) if (!out.includes(t)) out.push(t);
  }
  return out;
}

/** The answer as the person reads it. `final` trims the ends. */
export function cleanAnswer(raw: string, valid: Set<string>, final = true): string {
  let t = raw.replace(/\r\n?/g, "\n");
  t = t.replace(TAG_LIST, (whole, list: string) => (tagsIn(list).every((x) => valid.has(x)) ? "" : whole));
  t = t.replace(/\*\*|__/g, "");
  t = t.replace(/(^|[^\w*])\*(?=\S)([^*\n]+?)\*(?!\w)/g, "$1$2");
  t = t.replace(/^[ \t]*#{1,6}[ \t]*/gm, "");
  t = t.replace(/^[ \t]*[-*•][ \t]+/gm, "");
  t = t.replace(EMOJI, "");
  t = t.replace(/[ \t]+$/gm, "");
  t = t.replace(/\n{3,}/g, "\n\n");
  return final ? t.trim() : t.replace(/^\s+/, "");
}

/**
 * How much of a streamed answer is safe to show: not an unclosed bracket
 * that may be a tag, and not trailing spaces or symbols that may begin a
 * heading, a bullet, or bold text.
 */
export function safeLength(raw: string): number {
  let n = raw.length;
  const open = raw.lastIndexOf("[");
  if (open >= 0 && raw.indexOf("]", open) < 0 && n - open <= 40) n = open;
  while (n > 0 && " \t\n*#_-•".includes(raw[n - 1])) n--;
  return n;
}

/**
 * Cleans a streamed answer piece by piece. `push` each piece as it comes;
 * `finish` at the end, which sends whatever was held back. `onText` gets
 * only clean text, and in order.
 */
export function answerCleaner(valid: Set<string>, onText: (delta: string) => void) {
  let raw = "";
  let shown = "";
  const send = (next: string) => {
    if (next.startsWith(shown)) {
      if (next.length > shown.length) onText(next.slice(shown.length));
      shown = next;
    }
    // Otherwise a later piece changed how earlier text cleans (rare): keep
    // what's shown, and the final text (saved and shown on reload) is exact.
  };
  return {
    push(delta: string) {
      raw += delta;
      send(cleanAnswer(raw.slice(0, safeLength(raw)), valid, false));
    },
    finish(): string {
      const text = cleanAnswer(raw, valid, true);
      // The trimmed end may be shorter than what's shown; only add, never retract.
      if (text.startsWith(shown) && text.length > shown.length) onText(text.slice(shown.length));
      return text;
    },
    raw: () => raw,
  };
}

/**
 * The answer in pieces for the recall check: the text, cleaned, with the
 * tags it cited at each point, so a reviewer sees which record backs which
 * fact.
 */
export function answerSegments(raw: string, valid: Set<string>): Array<{ text: string } | { tags: string[] }> {
  const out: Array<{ text: string } | { tags: string[] }> = [];
  let last = 0;
  for (const m of raw.matchAll(TAG_LIST)) {
    const tags = tagsIn(m[1]);
    if (!tags.every((t) => valid.has(t))) continue;
    out.push({ text: raw.slice(last, m.index) }, { tags });
    last = m.index! + m[0].length;
  }
  out.push({ text: raw.slice(last) });
  return out
    .map((s) => ("text" in s ? { text: cleanAnswer(s.text, valid, false) } : s))
    .filter((s) => !("text" in s) || s.text.length > 0);
}
