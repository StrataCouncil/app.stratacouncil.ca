import type { SupabaseClient } from "@supabase/supabase-js";
import { IS_DEMO } from "@/lib/demo";
import { demoRestricted } from "@/lib/demo-sandbox";
import { DEMO_COUNCIL_EVENTS, inngest } from "@/lib/inngest/client";

/**
 * The demo's fictional council takes part (lib/inngest/demo-council.ts):
 * when a visitor opens a Discussion, the fictional members vote on it over
 * the next minute or two; when they launch a meeting, the members arrive;
 * when they open a vote, the members present vote, a few seconds apart.
 * Votes are random (mostly For), as a real council's would be.
 *
 * Only on the demo site, and never in a Super Admin's sandbox, where real
 * people play the council. Server only.
 */

export type DemoCouncilEvent = keyof typeof DEMO_COUNCIL_EVENTS;

/** Tells the background job; never fails the visitor's action. */
export async function nudgeDemoCouncil(kind: DemoCouncilEvent, data: Record<string, string>): Promise<void> {
  if (!IS_DEMO || !(await demoRestricted())) return;
  try {
    await inngest.send({ name: DEMO_COUNCIL_EVENTS[kind], data });
  } catch (err) {
    console.error("[nudgeDemoCouncil]", kind, err instanceof Error ? err.message : err);
  }
}

export interface FictionalMember {
  userId: string;
  lot: string;
  name: string;
}

const COUNCIL_ROLES = ["president", "vice_president", "treasurer", "secretary", "member_at_large"];

/** The strata's fictional council members (demo_cast accounts with a council role and a lot). */
export async function fictionalCouncil(admin: SupabaseClient, corpId: string): Promise<FictionalMember[]> {
  const [{ data: members }, { data: roles }, { data: cast }] = await Promise.all([
    admin.from("corporation_memberships").select("user_id, lot_number").eq("corporation_id", corpId).eq("status", "active").not("lot_number", "is", null),
    admin.from("corporation_role_assignments").select("user_id, role").eq("corporation_id", corpId).in("role", COUNCIL_ROLES),
    admin.from("demo_cast").select("user_id"),
  ]);
  const onCouncil = new Set((roles ?? []).map((r) => r.user_id as string));
  const fictional = new Set((cast ?? []).map((c) => c.user_id as string));
  const list = (members ?? []).filter((m) => onCouncil.has(m.user_id as string) && fictional.has(m.user_id as string));
  if (!list.length) return [];
  const { data: profiles } = await admin.from("profiles").select("id, full_name").in("id", list.map((m) => m.user_id as string));
  const names = new Map((profiles ?? []).map((p) => [p.id as string, (p.full_name as string) ?? ""]));
  return list.map((m) => ({ userId: m.user_id as string, lot: m.lot_number as string, name: names.get(m.user_id as string) ?? "" }));
}

/** The strata's fictional manager, if they're on it (they join meetings, but don't vote). */
export async function fictionalManager(admin: SupabaseClient, corpId: string): Promise<string | null> {
  const [{ data: roles }, { data: cast }] = await Promise.all([
    admin.from("corporation_role_assignments").select("user_id").eq("corporation_id", corpId).eq("role", "manager"),
    admin.from("demo_cast").select("user_id"),
  ]);
  const fictional = new Set((cast ?? []).map((c) => c.user_id as string));
  return (roles ?? []).map((r) => r.user_id as string).find((id) => fictional.has(id)) ?? null;
}
