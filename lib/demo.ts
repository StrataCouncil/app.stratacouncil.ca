/**
 * The demo site (demo.stratacouncil.ca): this same app, deployed a second
 * time with DEMO_MODE=true and its own Supabase project. Each visitor
 * arrives through a personal link made in the live site's Super Admin
 * console, gets their own copy of a fictional strata as its admin, and
 * loses it at midnight Pacific, when the link stops working.
 *
 * In the demo: nothing goes through Stripe (every demo strata is already
 * subscribed), no email is sent, nobody can sign up or sign in except
 * through a link, and there's no way into another strata.
 *
 * Pure (no server-only imports), so middleware can use it too.
 */
export const IS_DEMO = process.env.DEMO_MODE === "true";

/** Where a demo link opens: the visitor's strata, or Council Training. */
export type DemoLanding = "strata" | "training";

export const DEMO_LANDINGS: { value: DemoLanding; label: string }[] = [
  { value: "strata", label: "Stratasphere" },
  { value: "training", label: "Council Training" },
];

/** Where demo links point. Read on the live site, which makes them. */
export const DEMO_URL = (process.env.DEMO_APP_URL || "https://demo.stratacouncil.ca").replace(/\/+$/, "");

export const DEMO_TIME_ZONE = "America/Los_Angeles";

/** The visitor's sign-in link. */
export function demoLink(token: string) {
  return `${DEMO_URL}/start/${token}`;
}

/** A link token: 32 random bytes, base64url (43 characters). */
export function newDemoToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function isDemoToken(value: string) {
  return /^[A-Za-z0-9_-]{32,64}$/.test(value);
}

function pacificParts(at: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: DEMO_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}

/**
 * Midnight at the end of `now`'s day in British Columbia, as an instant:
 * when a link made at `now` stops working. Midnight Pacific is 07:00 UTC
 * in summer (PDT) and 08:00 UTC in winter (PST); daylight saving changes
 * at 2 a.m., so midnight is never skipped or doubled.
 */
export function endOfDemoDay(now: Date = new Date()): Date {
  const today = pacificParts(now);
  for (const utcHour of [7, 8]) {
    const candidate = new Date(Date.UTC(today.year, today.month - 1, today.day + 1, utcHour));
    const p = pacificParts(candidate);
    if (p.hour === 0 && p.minute === 0) return candidate;
  }
  throw new Error("Couldn't work out midnight Pacific.");
}

/** "Tuesday, October 7" for the day a link works. */
export function demoDayLabel(expiresAt: Date) {
  // The day that ends at expiresAt: a minute before it.
  return new Date(expiresAt.getTime() - 60_000).toLocaleDateString("en-CA", {
    timeZone: DEMO_TIME_ZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}
