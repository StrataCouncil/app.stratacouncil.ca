/**
 * Which turns of a long Stratasphere conversation to keep. Under the budget,
 * all of them. Over it, the newest turns that fit in half the budget,
 * starting at a question. Dropping in one large step means the cached
 * prefix changes rarely, not on every question.
 */
export interface StoredTurn {
  role: string;
  content: string;
  context: string | null;
}

export function trimHistory<T extends StoredTurn>(turns: T[], budget: number): { turns: T[]; trimmed: boolean } {
  const size = (m: StoredTurn) => m.content.length + (m.context?.length ?? 0);
  if (turns.reduce((n, m) => n + size(m), 0) <= budget) return { turns, trimmed: false };
  let kept = 0;
  let cut = turns.length;
  while (cut > 0 && kept + size(turns[cut - 1]) <= budget / 2) kept += size(turns[--cut]);
  while (cut < turns.length && turns[cut].role !== "user") cut++;
  return { turns: turns.slice(cut), trimmed: true };
}

/**
 * Meeting Mode (PR 4b): a meeting is one conversation, but each answer only
 * builds on the questions asked about the same agenda item, so answers in a
 * live meeting stay quick and on point. A question's answer follows it, so
 * it goes with it. The newest `max` turns, starting at a question.
 */
export function turnsForItem<T extends { role: string; focus?: unknown }>(turns: T[], meetingId: string, itemId: string, max = 10): T[] {
  const out: T[] = [];
  let on = false;
  for (const t of turns) {
    if (t.role === "user") {
      const f = (t.focus ?? null) as { kind?: string; meetingId?: string; itemId?: string } | null;
      on = Boolean(f && f.kind === "agenda_item" && f.meetingId === meetingId && f.itemId === itemId);
    }
    if (on) out.push(t);
  }
  let kept = out.slice(-max);
  while (kept.length && kept[0].role !== "user") kept = kept.slice(1);
  return kept;
}
