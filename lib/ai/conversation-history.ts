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
