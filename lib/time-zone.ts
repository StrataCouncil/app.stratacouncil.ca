/**
 * British Columbia stayed on UTC-7 all year from November 1, 2026 (no
 * return to standard time). Time-zone data from before that change still
 * moves America/Vancouver to UTC-8 that day, and the servers and browsers
 * that format our times don't all have the new data: they showed every
 * time since then an hour early. So for times from then on, BC times are
 * formatted at a fixed UTC-7 ("Etc/GMT+7", whose sign is reversed by
 * convention); earlier times use America/Vancouver as before, which every
 * copy of the data gets right. Other zones are untouched.
 *
 * Pure, for the server and the browser alike.
 */

/** 2026-11-01 02:00 PDT, when BC would have fallen back. */
export const BC_FIXED_FROM = Date.UTC(2026, 10, 1, 9, 0, 0);

const BC_ZONES = new Set(["America/Vancouver"]);

/** The zone to format `at` in: `zone`, or fixed UTC-7 for a BC time from November 1, 2026. */
export function tz(zone: string, at?: Date | number | string | null): string {
  if (!BC_ZONES.has(zone)) return zone;
  const ms = at === undefined || at === null ? Date.now() : at instanceof Date ? at.getTime() : typeof at === "number" ? at : Date.parse(at);
  return Number.isFinite(ms) && ms >= BC_FIXED_FROM ? "Etc/GMT+7" : zone;
}
