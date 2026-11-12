/**
 * What the person is looking at when they ask Stratasphere (PR 4a,
 * docs/learn-decide-remember.md §5). The page passes a small reference,
 * never record text; the server re-reads the record with the person's own
 * access (lib/ai/focus.ts) and refuses anything they couldn't open.
 *
 * Shared by the browser (the panel) and the server, so nothing here reads
 * the database.
 *
 * Discussions: only a closed one whose motion carried is a decision (it
 * awaits ratification at a meeting), so only that can be a focus; an open
 * discussion is never sent to Stratasphere.
 */
export type FocusRef =
  | { kind: "meeting"; meetingId: string }
  | { kind: "agenda_item"; meetingId: string; itemId: string }
  | { kind: "document"; documentId: string }
  | { kind: "discussion"; discussionId: string };

/** As saved with a question (conversation_messages.focus): the reference and the label the server gave it. */
export type SavedFocus = FocusRef & { label: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ITEM = /^[A-Za-z0-9_-]{1,64}$/;

/** A reference from the browser, checked for shape only (the server still checks access). Null if it isn't one. */
export function parseFocusRef(raw: unknown): FocusRef | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = (k: string) => (typeof r[k] === "string" && UUID.test(r[k] as string) ? (r[k] as string) : null);
  switch (r.kind) {
    case "meeting": {
      const meetingId = id("meetingId");
      return meetingId ? { kind: "meeting", meetingId } : null;
    }
    case "agenda_item": {
      const meetingId = id("meetingId");
      const itemId = typeof r.itemId === "string" && ITEM.test(r.itemId) ? r.itemId : null;
      return meetingId && itemId ? { kind: "agenda_item", meetingId, itemId } : null;
    }
    case "document": {
      const documentId = id("documentId");
      return documentId ? { kind: "document", documentId } : null;
    }
    case "discussion": {
      const discussionId = id("discussionId");
      return discussionId ? { kind: "discussion", discussionId } : null;
    }
    default:
      return null;
  }
}

/** The same record? (The panel keeps a conversation per page.) */
export function sameFocus(a: FocusRef | null, b: FocusRef | null): boolean {
  if (!a || !b) return a === b;
  return JSON.stringify(focusKey(a)) === JSON.stringify(focusKey(b));
}

function focusKey(f: FocusRef) {
  switch (f.kind) {
    case "meeting":
      return [f.kind, f.meetingId];
    case "agenda_item":
      return [f.kind, f.meetingId, f.itemId];
    case "document":
      return [f.kind, f.documentId];
    case "discussion":
      return [f.kind, f.discussionId];
  }
}

/**
 * A topic from a title, for a question: "Roof Replacement" -> "roof
 * replacement", and "Roof replacement: quotes" -> "roof replacement" (the
 * subject before a colon or dash). Keeps acronyms (AGM, CRF).
 */
function topic(title: string) {
  const whole = title.trim().replace(/\s+/g, " ");
  const subject = whole.split(/\s*(?::|\s[–—-]\s)\s*/)[0];
  const t = (subject.length >= 3 ? subject : whole).replace(/[.?!:;]+$/, "");
  return t
    .split(" ")
    .map((w) => (/^[A-Z0-9]{2,}$/.test(w) ? w : w.toLowerCase()))
    .join(" ")
    .slice(0, 80);
}

/**
 * Suggested questions for an empty conversation, built from the record's
 * kind and title by templates: no AI, no cost.
 */
export function suggestionsFor(focus: { kind: FocusRef["kind"] | "none"; title?: string | null }): string[] {
  const t = focus.title ? topic(focus.title) : "";
  switch (focus.kind) {
    case "agenda_item":
      return t
        ? [`What have we decided about ${t} before?`, "What do our bylaws say about this?", "Summarize the attachments."]
        : ["What do our bylaws say about this?", "Summarize the attachments."];
    case "meeting":
      return ["What's on this agenda, in brief?", "What did we decide at our last meeting?", "Is anything on this agenda something we've decided before?"];
    case "document":
      return ["Summarize this document.", "What does this mean for council?", "Does this conflict with our bylaws?"];
    case "discussion":
      return t
        ? ["What did council decide here?", `Have we decided anything about ${t} before?`, "What do our bylaws say about this?"]
        : ["What did council decide here?", "What do our bylaws say about this?"];
    default:
      return ["What have we decided in the last year?", "What do our bylaws say about pets?", "When is our next meeting?"];
  }
}

/** Where a saved focus links back to in the app, if it has its own page. */
export function focusHref(corpId: string, f: FocusRef): string | null {
  const base = `/strata/${encodeURIComponent(corpId)}`;
  switch (f.kind) {
    case "meeting":
    case "agenda_item":
      return `${base}/meetings/${f.meetingId}`;
    case "discussion":
      return `${base}/discussions/${f.discussionId}`;
    case "document":
      return `${base}/documents`;
  }
}
