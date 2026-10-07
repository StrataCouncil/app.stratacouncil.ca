import { DEMO_LIMITS, IS_DEMO, type DemoLimit } from "@/lib/demo";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * The demo site's limits and activity log for the signed-in visitor
 * (lib/demo.ts). Server only. The visitor is known from their account's
 * app_metadata, which only the service role can set (lib/demo-server.ts).
 * Outside the demo, nothing is limited and nothing is logged.
 */

async function visitorId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const id = user?.app_metadata?.demo_visitor_id;
  return typeof id === "string" ? id : null;
}

/**
 * Takes one of `what` if any are left. False when the limit is reached
 * (or the visitor can't be told apart, which fails closed).
 */
export async function takeDemoAllowance(what: DemoLimit): Promise<boolean> {
  if (!IS_DEMO) return true;
  const id = await visitorId();
  if (!id) return false;
  const { data, error } = await createAdminClient().rpc("demo_use", { p_visitor_id: id, p_what: what, p_limit: DEMO_LIMITS[what] });
  if (error) console.error("[takeDemoAllowance]", error.message);
  return data === true;
}

/** Gives one back, when what it was taken for failed. */
export async function refundDemoAllowance(what: DemoLimit, knownVisitorId?: string | null) {
  if (!IS_DEMO) return;
  const id = knownVisitorId ?? (await visitorId());
  if (!id) return;
  const { error } = await createAdminClient().rpc("demo_use", { p_visitor_id: id, p_what: what, p_limit: 0, p_refund: true });
  if (error) console.error("[refundDemoAllowance]", error.message);
}

/** How many of each are left, or null outside the demo. */
export async function demoAllowanceLeft(): Promise<Record<DemoLimit, number> | null> {
  if (!IS_DEMO) return null;
  const none = { chat: 0, meeting: 0, meetings: 0, motions: 0 };
  const id = await visitorId();
  if (!id) return none;
  const { data } = await createAdminClient()
    .from("demo_visitors")
    .select("chat_questions, meeting_questions, meetings_created, motion_drafts")
    .eq("id", id)
    .maybeSingle();
  if (!data) return none;
  return {
    chat: Math.max(DEMO_LIMITS.chat - data.chat_questions, 0),
    meeting: Math.max(DEMO_LIMITS.meeting - data.meeting_questions, 0),
    meetings: Math.max(DEMO_LIMITS.meetings - data.meetings_created, 0),
    motions: Math.max(DEMO_LIMITS.motions - data.motion_drafts, 0),
  };
}

const clip = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : v);

/** Long text (a question, an answer) is kept to 8,000 characters, anything else to 500. */
function tidy(detail: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(detail).slice(0, 20)) {
    out[k.slice(0, 40)] = typeof v === "string" ? clip(v, k === "question" || k === "answer" || k === "text" ? 8000 : 500) : v;
  }
  return out;
}

export interface DemoEvent {
  kind: string;
  path?: string | null;
  detail?: Record<string, unknown>;
  at?: string;
}

/** Writes to the visitor's activity log (demo_activity). Never throws. */
export async function logDemoActivity(events: DemoEvent | DemoEvent[], knownVisitorId?: string | null) {
  if (!IS_DEMO) return;
  try {
    const id = knownVisitorId ?? (await visitorId());
    if (!id) return;
    const rows = (Array.isArray(events) ? events : [events]).slice(0, 100).map((e) => ({
      visitor_id: id,
      kind: e.kind.slice(0, 60),
      path: e.path ? e.path.slice(0, 500) : null,
      detail: tidy(e.detail ?? {}),
      ...(e.at && !Number.isNaN(Date.parse(e.at)) ? { at: e.at } : {}),
    }));
    const { error } = await createAdminClient().from("demo_activity").insert(rows);
    if (error) console.error("[logDemoActivity]", error.message);
  } catch (err) {
    console.error("[logDemoActivity]", err instanceof Error ? err.message : err);
  }
}

/** For the activity route: the visitor behind a request, if any. */
export const demoVisitorId = visitorId;
