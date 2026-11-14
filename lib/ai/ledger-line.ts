/**
 * One carried decision, in full but without repetition: every entry is a
 * carried motion (the block's heading says so), votes read for-against-
 * abstain, and a title the motion already states isn't repeated.
 */
export function ledgerLine(d: Record<string, unknown>): string {
  const votes = d.votes_for != null ? ` (${d.votes_for}-${d.votes_against ?? 0}-${d.votes_abstain ?? 0})` : "";
  const who = d.mover ? ` Moved ${d.mover}${d.seconder ? `, seconded ${d.seconder}` : ""}.` : "";
  const where = `${String(d.decided_at).slice(0, 10)}, ${d.meeting_type ?? "meeting"}${d.source === "historic_minutes" ? ", past minutes" : ""}`;
  const title = String(d.title ?? "").trim();
  const motion = String(d.motion_text ?? "").trim();
  const squash = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  // Whole words only: "Roof" isn't stated by "Peak Roofing".
  if (title && motion && squash(title) && ` ${squash(motion)} `.includes(` ${squash(title)} `)) {
    return `[${where}]${votes}${who} ${motion}`;
  }
  return `[${where}] ${title}${votes}.${who}${motion ? ` Motion: ${motion}` : ""}`;
}
