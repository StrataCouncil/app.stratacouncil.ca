import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireSuperAdmin } from "@/lib/data/admin";
import { demoLink, SANDBOX_PERSONAS, type DemoLanding } from "@/lib/demo";
import type { DemoActivityEvent } from "@/lib/demo-activity";

/**
 * The live site's view of the demo site's visitors (lib/demo.ts), for the
 * Super Admin console. The visitor list lives in the demo database
 * (demo_visitors, supabase/demo/demo.sql), reached with the demo
 * project's service-role key, set on the live project as
 * DEMO_SUPABASE_URL and DEMO_SUPABASE_SERVICE_ROLE_KEY. Server-only.
 */
export function demoDatabase(): SupabaseClient | null {
  const url = process.env.DEMO_SUPABASE_URL;
  const key = process.env.DEMO_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createSupabaseClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export interface DemoVisitor {
  id: string;
  fullName: string;
  email: string;
  link: string;
  landing: DemoLanding;
  createdAt: string;
  createdByName: string;
  expiresAt: string;
  firstOpenedAt: string | null;
  lastOpenedAt: string | null;
  /** Still works (before midnight Pacific, three days after the day it was made). */
  active: boolean;
  /** Entries in the visitor's activity log (lib/demo-activity.ts), when read. */
  activityCount?: number;
}

export type DemoVisitorList =
  | { configured: false }
  | { configured: true; visitors: DemoVisitor[]; error: string | null };

export const DEMO_VISITOR_COLUMNS =
  "id, token, full_name, email, landing, created_at, created_by_name, expires_at, first_opened_at, last_opened_at";

export function toDemoVisitor(row: Record<string, string | null>): DemoVisitor {
  return {
    id: row.id!,
    fullName: row.full_name ?? "",
    email: row.email ?? "",
    link: demoLink(row.token!),
    landing: row.landing === "training" ? "training" : "strata",
    createdAt: row.created_at!,
    createdByName: row.created_by_name ?? "",
    expiresAt: row.expires_at!,
    firstOpenedAt: row.first_opened_at,
    lastOpenedAt: row.last_opened_at,
    active: Date.parse(row.expires_at!) > Date.now(),
  };
}

/** The last week's links, newest first (older ones are deleted). */
export async function getDemoVisitors(): Promise<DemoVisitorList> {
  const db = demoDatabase();
  if (!db) return { configured: false };
  const { data, error } = await db
    .from("demo_visitors")
    .select(`${DEMO_VISITOR_COLUMNS}, demo_activity(count)`)
    // Sandboxes are listed on their own (getSandboxes), not as visitors.
    .is("sandbox_id", null)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) {
    console.error("[getDemoVisitors]", error.message);
    return { configured: true, visitors: [], error: "Couldn't reach the demo database." };
  }
  return {
    configured: true,
    visitors: (data ?? []).map((row) => {
      const counted = (row as { demo_activity?: Array<{ count: number }> }).demo_activity;
      return { ...toDemoVisitor(row as unknown as Record<string, string | null>), activityCount: counted?.[0]?.count ?? 0 };
    }),
    error: null,
  };
}

export type DemoActivityResult =
  | { ok: true; visitor: DemoVisitor; events: DemoActivityEvent[]; truncated: boolean }
  | { ok: false; error: string };

const ACTIVITY_LIMIT = 5000;

/** One visitor's activity log, oldest first. Super Admins only. */
export async function getDemoActivity(visitorId: string): Promise<DemoActivityResult | null> {
  if (!(await requireSuperAdmin())) return null;
  const db = demoDatabase();
  if (!db) return { ok: false, error: "The demo database isn't connected." };
  const [{ data: row }, { data: events, error }] = await Promise.all([
    db.from("demo_visitors").select(DEMO_VISITOR_COLUMNS).eq("id", visitorId).maybeSingle(),
    db.from("demo_activity").select("id, at, kind, path, detail").eq("visitor_id", visitorId).order("at").order("id").limit(ACTIVITY_LIMIT),
  ]);
  if (!row) return { ok: false, error: "That demo link isn't in the demo database any more (they're kept for 7 days)." };
  if (error) {
    console.error("[getDemoActivity]", error.message);
    return { ok: false, error: "Couldn't read the activity log." };
  }
  const list = (events ?? []) as DemoActivityEvent[];
  return { ok: true, visitor: toDemoVisitor(row as unknown as Record<string, string | null>), events: list, truncated: list.length >= ACTIVITY_LIMIT };
}

/** A Super Admin's sandbox on the demo site (lib/demo.ts, SANDBOX_*): one link per person. */
export interface Sandbox {
  id: string;
  createdAt: string;
  createdByName: string;
  emailTo: string;
  expiresAt: string;
  /** Built (the first link has been opened). */
  ready: boolean;
  people: Array<{ visitorId: string; persona: string; label: string; name: string; link: string; lastOpenedAt: string | null }>;
}

export type SandboxList = { configured: false } | { configured: true; sandboxes: Sandbox[]; error: string | null };

/** Sandboxes still working, newest first. Super Admins only. */
export async function getSandboxes(): Promise<SandboxList> {
  if (!(await requireSuperAdmin())) return { configured: true, sandboxes: [], error: null };
  const db = demoDatabase();
  if (!db) return { configured: false };
  const { data, error } = await db
    .from("demo_visitors")
    .select("id, token, full_name, sandbox_id, persona, email_to, expires_at, created_at, created_by_name, corporation_id, last_opened_at")
    .not("sandbox_id", "is", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) {
    console.error("[getSandboxes]", error.message);
    return { configured: true, sandboxes: [], error: "Couldn't reach the demo database." };
  }
  const order = (persona: string) => {
    const i = SANDBOX_PERSONAS.findIndex((p) => p.key === persona);
    return i < 0 ? 99 : i;
  };
  const groups = new Map<string, Sandbox>();
  for (const r of data ?? []) {
    const id = r.sandbox_id as string;
    const box: Sandbox = groups.get(id) ?? {
      id,
      createdAt: r.created_at,
      createdByName: r.created_by_name ?? "",
      emailTo: r.email_to ?? "",
      expiresAt: r.expires_at,
      ready: false,
      people: [],
    };
    if (r.persona === "admin" && r.corporation_id) box.ready = true;
    box.people.push({
      visitorId: r.id,
      persona: r.persona as string,
      label: SANDBOX_PERSONAS.find((p) => p.key === r.persona)?.label ?? (r.persona as string),
      name: r.full_name ?? "",
      link: demoLink(r.token as string),
      lastOpenedAt: r.last_opened_at,
    });
    groups.set(id, box);
  }
  for (const box of groups.values()) box.people.sort((a, b) => order(a.persona) - order(b.persona));
  return { configured: true, sandboxes: [...groups.values()], error: null };
}
