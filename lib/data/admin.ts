import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Reads for the Super Admin console (/admin). Platform staff need to see
 * across every corporation, including tables whose RLS is member-scoped
 * (`subscriptions`) or self-scoped (`profiles` — a requester's name), so
 * these use the service-role client — but only after `requireSuperAdmin()`
 * has checked `profiles.is_super_admin` for the signed-in user. Every
 * export here calls it first; none of them trust the page to have.
 */
async function requireSuperAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("profiles")
    .select("is_super_admin")
    .eq("id", user.id)
    .single();
  return data?.is_super_admin ? { supabase, user } : null;
}

export interface AdminCorporation {
  id: string;
  strataPlanNumber: string;
  buildingName: string | null;
  legalName: string;
  address: string;
  jurisdiction: string;
  unitCount: number;
  subscriptionStatus: "active" | "deactivated" | "none";
  freeMeetingUsed: boolean;
  createdAt: string;
}

export async function getAllCorporations(): Promise<AdminCorporation[]> {
  if (!(await requireSuperAdmin())) return [];
  const admin = createAdminClient();

  const [{ data: corps, error }, { data: subs }] = await Promise.all([
    admin
      .from("strata_corporations")
      .select("strata_plan_number, building_name, legal_name, address, jurisdiction, unit_count, free_meeting_used, created_at")
      .order("strata_plan_number"),
    admin.from("subscriptions").select("corporation_id, status"),
  ]);
  if (error) console.error("[getAllCorporations]", error.message);

  const statusByCorp = new Map((subs ?? []).map((s) => [s.corporation_id, s.status]));

  return (corps ?? []).map((c) => ({
    id: c.strata_plan_number,
    strataPlanNumber: c.strata_plan_number,
    buildingName: c.building_name,
    legalName: c.legal_name,
    address: c.address,
    jurisdiction: c.jurisdiction,
    unitCount: c.unit_count,
    subscriptionStatus: (statusByCorp.get(c.strata_plan_number) as "active" | "deactivated" | undefined) ?? "none",
    freeMeetingUsed: c.free_meeting_used,
    createdAt: c.created_at,
  }));
}

export interface CreationRequestSummary {
  id: string;
  strataPlanNumber: string;
  legalName: string;
  requesterName: string;
  requesterEmail: string;
  requestedAt: string;
}

export async function getPendingCreationRequests(): Promise<CreationRequestSummary[]> {
  if (!(await requireSuperAdmin())) return [];
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("corporation_creation_requests")
    .select("id, parsed_strata_plan_number, parsed_legal_name, requested_at, requester:profiles!corporation_creation_requests_requested_by_fkey(full_name, email)")
    .eq("status", "pending")
    .order("requested_at");
  if (error) console.error("[getPendingCreationRequests]", error.message);

  return (data ?? []).map((r) => {
    const requester = (Array.isArray(r.requester) ? r.requester[0] : r.requester) as
      | { full_name: string | null; email: string | null }
      | null;
    return {
      id: r.id,
      strataPlanNumber: r.parsed_strata_plan_number ?? "",
      legalName: r.parsed_legal_name ?? "",
      requesterName: requester?.full_name || requester?.email || "Unknown",
      requesterEmail: requester?.email ?? "",
      requestedAt: r.requested_at,
    };
  });
}

export interface CreationRequestDetail {
  id: string;
  status: "pending" | "approved" | "denied";
  strataPlanNumber: string;
  legalName: string;
  address: string;
  unitCount: number | null;
  /** "plan": read from the uploaded plan; "manual": typed (scanned plan). */
  unitCountSource: "plan" | "manual";
  /** Whether the AI's lot count matched the highest lot the plan's text names. */
  lotsCheck: "consistent" | "differs" | "unchecked" | null;
  unitEntitlementTotal: number | null;
  filedYear: number | null;
  buildingName: string;
  addressVerified: boolean;
  jurisdiction: string;
  requesterName: string;
  requesterEmail: string;
  attestation: {
    fullName: string;
    address: string;
    email: string;
    phone: string;
    confirmed: boolean;
    confirmedAt: string | null;
  };
  planUrl: string | null;
  planTitle: string | null;
  requestedAt: string;
  resolvedAt: string | null;
  corporationAlreadyExists: boolean;
}

export async function getCreationRequest(id: string): Promise<CreationRequestDetail | null> {
  if (!(await requireSuperAdmin())) return null;
  const admin = createAdminClient();

  const { data: r, error } = await admin
    .from("corporation_creation_requests")
    .select("*, requester:profiles!corporation_creation_requests_requested_by_fkey(full_name, email), plan:documents!corporation_creation_requests_strata_plan_document_id_fkey(title, storage_path)")
    .eq("id", id)
    .maybeSingle();
  if (error) console.error("[getCreationRequest]", error.message);
  if (!r) return null;

  const requester = (Array.isArray(r.requester) ? r.requester[0] : r.requester) as
    | { full_name: string | null; email: string | null }
    | null;
  const plan = (Array.isArray(r.plan) ? r.plan[0] : r.plan) as
    | { title: string | null; storage_path: string | null }
    | null;

  let planUrl: string | null = null;
  if (plan?.storage_path?.startsWith("strata-plans/")) {
    const { data: signed } = await admin.storage
      .from("strata-plans")
      .createSignedUrl(plan.storage_path.slice("strata-plans/".length), 60 * 30);
    planUrl = signed?.signedUrl ?? null;
  }

  const { data: existing } = await admin
    .from("strata_corporations")
    .select("strata_plan_number")
    .eq("strata_plan_number", r.parsed_strata_plan_number ?? "")
    .maybeSingle();

  return {
    id: r.id,
    status: r.status,
    strataPlanNumber: r.parsed_strata_plan_number ?? "",
    legalName: r.parsed_legal_name ?? "",
    address: r.parsed_address ?? "",
    unitCount: r.parsed_unit_count,
    unitCountSource: r.unit_count_source === "plan" ? "plan" : "manual",
    lotsCheck: r.lots_check ?? null,
    unitEntitlementTotal: r.parsed_unit_entitlement_total ?? null,
    filedYear: r.parsed_filed_year ?? null,
    buildingName: r.building_name ?? "",
    addressVerified: Boolean(r.address_verified),
    jurisdiction: r.parsed_jurisdiction ?? "",
    requesterName: requester?.full_name || requester?.email || "Unknown",
    requesterEmail: requester?.email ?? "",
    attestation: {
      fullName: r.attestation_full_name ?? "",
      address: r.attestation_address ?? "",
      email: r.attestation_email ?? "",
      phone: r.attestation_phone ?? "",
      confirmed: r.attestation_confirmed,
      confirmedAt: r.attestation_confirmed_at,
    },
    planUrl,
    planTitle: plan?.title ?? null,
    requestedAt: r.requested_at,
    resolvedAt: r.resolved_at,
    corporationAlreadyExists: Boolean(existing) && r.status === "pending",
  };
}
