import type { SupabaseClient } from "@supabase/supabase-js";
import { stripPII, type KnownPerson } from "@/lib/pii";

/**
 * Everything one corporation's text needs before it leaves for an AI
 * service: every name it knows (owners and council on the lot roster by
 * lot number, connected members as Council Member), plus — for the global
 * precedent pool only — the corporation's own identity, so a precedent
 * can't be traced back to a building.
 */
export interface StripContext {
  people: KnownPerson[];
  identity: string[];
}

export async function loadStripContext(admin: SupabaseClient, corpId: string): Promise<StripContext> {
  const [{ data: lots }, { data: members }, { data: corp }] = await Promise.all([
    admin.from("owners_and_council").select("lot_number, full_name, council_member_name").eq("corporation_id", corpId),
    admin
      .from("corporation_memberships")
      .select("profile:profiles!corporation_memberships_user_id_fkey(full_name)")
      .eq("corporation_id", corpId),
    admin
      .from("strata_corporations")
      .select("strata_plan_number, legal_name, building_name, address")
      .eq("strata_plan_number", corpId)
      .maybeSingle(),
  ]);

  const people: KnownPerson[] = [];
  for (const lot of lots ?? []) {
    for (const name of splitNames(lot.full_name)) people.push({ name, lotNumber: lot.lot_number });
    for (const name of splitNames(lot.council_member_name)) people.push({ name, lotNumber: lot.lot_number });
  }
  for (const m of (members ?? []) as unknown as Array<{ profile: { full_name: string | null } | null }>) {
    for (const name of splitNames(m.profile?.full_name ?? null)) people.push({ name });
  }

  const identity = [corp?.legal_name, corp?.building_name, corp?.address, corp?.strata_plan_number]
    .filter((s): s is string => Boolean(s && s.trim().length >= 3))
    .map((s) => s.trim());

  return { people, identity };
}

/** "Jane & John Smith", "Jane Smith and John Smith", "Smith, Jane; Lee, Kim" → individual "First Last" names. */
function splitNames(raw: string | null): string[] {
  if (!raw) return [];
  const parts = raw
    .split(/\s*(?:&|\band\b|;|\/|\+)\s*/i)
    .map((s) => s.trim())
    .filter(Boolean)
    // "Lee, Kim" → "Kim Lee", so the full-name match (and its lot number) applies.
    .map((s) => s.replace(/^([^,]+),\s*(.+)$/, "$2 $1"));
  // "Jane & John Smith": give the bare first name the shared surname too.
  const last = parts[parts.length - 1]?.split(" ");
  const surname = last && last.length > 1 ? last[last.length - 1] : null;
  return parts.flatMap((p) => (surname && !p.includes(" ") && !p.includes(",") ? [p, `${p} ${surname}`] : [p]));
}

/** For this corporation's own chunks and for prompts sent on its behalf. */
export function stripForCorporation(text: string, ctx: StripContext) {
  return stripPII(text, ctx.people);
}

/** For the cross-corporation precedent pool: also remove who the corporation is. */
export function stripForGlobal(text: string, ctx: StripContext) {
  let out = text;
  for (const term of [...ctx.identity].sort((a, b) => b.length - a.length)) {
    const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"), "gi");
    out = out.replace(re, "[strata corporation]");
  }
  // Plan numbers survive stripPII on purpose (public records); here, any
  // plan number at all could identify the source.
  out = out.replace(/\b(?:BCS|EPS|LMS|VAS|VIS|KAS|NES|NWS|EPP|BCP|LMP|VIP|KAP)\s?-?\d{2,6}\b/g, "[strata plan]");
  return stripPII(out, ctx.people);
}
