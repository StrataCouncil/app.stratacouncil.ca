/**
 * The hourly safeguard (stratasphere_allowed, 0090): 30 answers an hour per
 * person, counted from stratasphere_usage. Pure, for the message that says
 * when they can ask again.
 */
export const HOURLY_LIMIT = 30;

/**
 * When the person is under the limit again: the HOURLY_LIMIT-th newest
 * answer turns an hour old (rounded up to the minute). Null if they aren't
 * at the limit.
 */
export function nextAskAt(recent: string[], now = Date.now()): string | null {
  const times = recent
    .map((t) => Date.parse(t))
    .filter(Number.isFinite)
    .sort((x, y) => y - x);
  if (times.length < HOURLY_LIMIT) return null;
  const at = Math.ceil((times[HOURLY_LIMIT - 1] + 3_600_000) / 60_000) * 60_000;
  return at > now ? new Date(at).toISOString() : null;
}
