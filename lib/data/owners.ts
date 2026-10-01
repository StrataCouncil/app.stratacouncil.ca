import { createClient } from "@/lib/supabase/server";
import type { OwnerType } from "@/lib/roster-csv";

/**
 * The owner/lot roster (`owners_and_council`, doc02 §2), read through the
 * signed-in user's RLS-scoped client: any connected member can read it
 * (0005), only the admin can write. One row per strata lot, pre-seeded
 * SL001..SLnnn when the corporation was approved.
 */
export interface OwnerLot {
  id: string;
  lotNumber: string;
  fullName: string | null;
  email: string | null;
  unitNumber: string | null;
  unitEntitlement: number | null;
  ownerType: OwnerType | null;
  parking: string | null;
  storage: string | null;
  bikeRack: string | null;
  strataFees: number | null;
  councilMemberName: string | null;
  councilEmail: string | null;
  isCouncilMember: boolean;
  role: "president" | "vice_president" | "treasurer" | "secretary" | null;
  updatedAt: string;
}

export interface OwnerRoster {
  isAdmin: boolean;
  unitCount: number | null;
  lots: OwnerLot[];
}

const num = (v: string | number | null) => (v === null ? null : Number(v));

export async function getOwnerRoster(corporationId: string): Promise<OwnerRoster | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: rows, error }, { data: admin }, { data: corp }] = await Promise.all([
    supabase
      .from("owners_and_council")
      .select("*")
      .eq("corporation_id", corporationId)
      .order("lot_number"),
    supabase
      .from("corporation_role_assignments")
      .select("role")
      .eq("corporation_id", corporationId)
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle(),
    supabase
      .from("strata_corporations")
      .select("unit_count")
      .eq("strata_plan_number", corporationId)
      .maybeSingle(),
  ]);
  if (error) console.error("[getOwnerRoster]", corporationId, error.message);

  return {
    isAdmin: Boolean(admin),
    unitCount: corp?.unit_count ?? null,
    lots: (rows ?? []).map((r) => ({
      id: r.id,
      lotNumber: r.lot_number,
      fullName: r.full_name,
      email: r.email,
      unitNumber: r.unit_number,
      unitEntitlement: num(r.unit_entitlement),
      ownerType: r.owner_type,
      parking: r.parking,
      storage: r.storage,
      bikeRack: r.bike_rack,
      strataFees: num(r.strata_fees),
      councilMemberName: r.council_member_name,
      councilEmail: r.council_email,
      isCouncilMember: r.is_council_member,
      role: r.role,
      updatedAt: r.updated_at,
    })),
  };
}
