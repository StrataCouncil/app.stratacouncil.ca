import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { demoLink, type DemoLanding } from "@/lib/demo";

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
  /** Still works (before midnight Pacific on the day it was made). */
  active: boolean;
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
    .select(DEMO_VISITOR_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) {
    console.error("[getDemoVisitors]", error.message);
    return { configured: true, visitors: [], error: "Couldn't reach the demo database." };
  }
  return { configured: true, visitors: (data ?? []).map(toDemoVisitor), error: null };
}
