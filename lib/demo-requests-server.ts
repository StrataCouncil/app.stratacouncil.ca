import type { SupabaseClient } from "@supabase/supabase-js";
import { APP_URL } from "@/lib/app-url";
import type { Campaign } from "@/lib/campaign";
import { requireSuperAdmin } from "@/lib/data/admin";
import { IS_DEMO } from "@/lib/demo";
import { DEMO_REQUEST_SOURCES, campaignLine, parseDemoRequest, type DemoRequestSource } from "@/lib/demo-requests";
import { sendTransactionalEmail } from "@/lib/email/mailtrap";
import { demoRequestNoticeEmail } from "@/lib/email/templates";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Demo requests (0067), server side: saving a request from
 * stratacouncil.ca and emailing staff a notice that links to the console,
 * and the console's list. Service role throughout; the console list only
 * after requireSuperAdmin().
 */

/** Who hears about new requests. */
const NOTICE_TO = process.env.DEMO_REQUESTS_TO || "jeremy@stratacouncil.ca";
/** More than this many requests in an hour, from anyone, is turned away. */
const MAX_PER_HOUR = 30;
const KEEP_DAYS = 30;

export type DemoRequestReply = { status: "sent" | "error"; message?: string };

export async function submitDemoRequest(body: unknown): Promise<DemoRequestReply> {
  if (IS_DEMO) return { status: "error", message: "Demo requests aren't taken on the demo site." };
  const input = parseDemoRequest(body);
  if (!input.ok) return { status: "error", message: input.message };
  if ("bot" in input) return { status: "sent" };

  const admin = createAdminClient();
  const failed: DemoRequestReply = { status: "error", message: "Something went wrong. Please try again, or email support@stratacouncil.ca." };

  // Someone pressing the button twice, or coming back before we answer, is one request.
  const { data: waiting } = await admin
    .from("demo_requests")
    .select("id")
    .eq("email", input.email)
    .is("handled_at", null)
    .limit(1)
    .maybeSingle();
  if (waiting) return { status: "sent" };

  const { count } = await admin
    .from("demo_requests")
    .select("id", { count: "exact", head: true })
    .gt("created_at", new Date(Date.now() - 3600_000).toISOString());
  if ((count ?? 0) >= MAX_PER_HOUR) return failed;

  const { error } = await admin
    .from("demo_requests")
    .insert({ full_name: input.name, email: input.email, source: input.source, campaign: input.campaign });
  if (error) {
    console.error("[submitDemoRequest] insert", error.message);
    return failed;
  }
  await forgetHandledRequests(admin);

  // The request is saved and shows in the console either way; the notice is a heads-up.
  const mail = demoRequestNoticeEmail({
    name: input.name,
    email: input.email,
    where: DEMO_REQUEST_SOURCES[input.source].toLowerCase(),
    campaign: campaignLine(input.campaign),
    consoleUrl: `${APP_URL}/admin/demo#requests`,
  });
  await sendTransactionalEmail({ to: NOTICE_TO, ...mail }).catch((err: unknown) =>
    console.error("[submitDemoRequest] notice", err instanceof Error ? err.message : err)
  );
  return { status: "sent" };
}

/** Handled requests go 30 days after they were handled, the same as demo links. */
export async function forgetHandledRequests(admin: SupabaseClient) {
  const { error } = await admin
    .from("demo_requests")
    .delete()
    .lt("handled_at", new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString());
  if (error) console.error("[forgetHandledRequests]", error.message);
}

export interface DemoRequest {
  id: string;
  fullName: string;
  email: string;
  source: DemoRequestSource;
  campaign: Campaign | null;
  createdAt: string;
  handledAt: string | null;
  outcome: "sent" | "dismissed" | null;
  handledByName: string | null;
}

export const DEMO_REQUEST_COLUMNS = "id, full_name, email, source, campaign, created_at, handled_at, outcome, handled_by_name";

export function toDemoRequest(r: Record<string, unknown>): DemoRequest {
  return {
    id: r.id as string,
    fullName: r.full_name as string,
    email: r.email as string,
    source: r.source === "coming-soon" ? "coming-soon" : "home",
    campaign: (r.campaign as Campaign | null) ?? null,
    createdAt: r.created_at as string,
    handledAt: (r.handled_at as string | null) ?? null,
    outcome: (r.outcome as "sent" | "dismissed" | null) ?? null,
    handledByName: (r.handled_by_name as string | null) ?? null,
  };
}

/** For the console: waiting requests first (oldest first), then the last 30 days' handled ones. */
export async function getDemoRequests(): Promise<DemoRequest[]> {
  if (!(await requireSuperAdmin())) return [];
  const { data, error } = await createAdminClient()
    .from("demo_requests")
    .select(DEMO_REQUEST_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) console.error("[getDemoRequests]", error.message);
  const all = (data ?? []).map(toDemoRequest);
  return [...all.filter((r) => !r.handledAt).reverse(), ...all.filter((r) => r.handledAt)];
}
