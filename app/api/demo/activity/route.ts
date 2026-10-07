import { NextResponse, type NextRequest } from "next/server";
import { IS_DEMO } from "@/lib/demo";
import { demoVisitorId, logDemoActivity, type DemoEvent } from "@/lib/demo-usage";

/**
 * The demo's activity log, from the browser (components/DemoGuard.tsx):
 * pages viewed and for how long, clicks, messages shown, errors. Only
 * these kinds are accepted; what visitors ask the Stratasphere and what
 * they make is logged on the server, where it happens.
 */
const BROWSER_KINDS = new Set(["view", "leave", "click", "alert", "limit", "error"]);

export async function POST(request: NextRequest) {
  if (!IS_DEMO) return new NextResponse(null, { status: 404 });
  const id = await demoVisitorId();
  if (!id) return new NextResponse(null, { status: 204 });
  const body = (await request.json().catch(() => null)) as { events?: unknown } | null;
  const now = Date.now();
  const events: DemoEvent[] = (Array.isArray(body?.events) ? body.events : [])
    .slice(0, 50)
    .filter((e): e is { kind: string; path?: unknown; detail?: unknown; at?: unknown } => Boolean(e) && BROWSER_KINDS.has((e as { kind?: string }).kind ?? ""))
    .map((e) => {
      const at = typeof e.at === "string" ? Date.parse(e.at) : NaN;
      // The browser's clock, if it's plausible: events are sent in batches.
      const ok = at > now - 15 * 60_000 && at < now + 60_000;
      return {
        kind: e.kind,
        path: typeof e.path === "string" ? e.path : null,
        detail: e.detail && typeof e.detail === "object" && !Array.isArray(e.detail) ? (e.detail as Record<string, unknown>) : {},
        at: ok ? new Date(at).toISOString() : undefined,
      };
    });
  if (events.length) await logDemoActivity(events, id);
  return new NextResponse(null, { status: 204 });
}
