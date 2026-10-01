"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isJurisdictionCode, normalizeStrataPlanNumber } from "@/lib/strata";

/**
 * Super Admin review of `corporation_creation_requests` (doc01 §4).
 * Both go through the reviewer's own client: approval is
 * `approve_corporation_creation_request()` (0010), which checks
 * `is_super_admin()` itself and does the whole creation atomically;
 * denial is a plain update that RLS ("super admin resolves creation
 * requests", 0005) gates.
 *
 * The reviewer submits the identity fields they verified against the
 * uploaded Strata Plan — corrected if the requester got something wrong —
 * and those, not the originally typed values, become the corporation.
 */

export type ReviewResult = { ok: false; error: string } | undefined;

export async function approveCreationRequest(
  requestId: string,
  _prev: ReviewResult,
  formData: FormData
): Promise<ReviewResult> {
  const strataPlanNumber = normalizeStrataPlanNumber(String(formData.get("strataPlanNumber") ?? ""));
  const legalName = String(formData.get("legalName") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  const unitCount = Math.trunc(Number(formData.get("unitCount")));
  const jurisdiction = String(formData.get("jurisdiction") ?? "");

  if (!strataPlanNumber) return { ok: false, error: "Enter a valid Strata Plan number, e.g. BCS-1234." };
  if (!legalName || !address) return { ok: false, error: "Legal name and address are required." };
  if (!Number.isFinite(unitCount) || unitCount < 1) return { ok: false, error: "Unit count must be at least 1." };
  if (!isJurisdictionCode(jurisdiction)) return { ok: false, error: "Choose a jurisdiction." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_corporation_creation_request", {
    p_request_id: requestId,
    p_strata_plan_number: strataPlanNumber,
    p_legal_name: legalName,
    p_address: address,
    p_unit_count: unitCount,
    p_jurisdiction: jurisdiction,
  });

  if (error) {
    console.error("[approveCreationRequest]", error.code, error.message);
    return {
      ok: false,
      error: error.code === "P0001" ? error.message : "Couldn't approve this request.",
    };
  }

  revalidatePath("/admin");
  redirect(`/admin/${strataPlanNumber}`);
}

export async function denyCreationRequest(requestId: string): Promise<ReviewResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const { data, error } = await supabase
    .from("corporation_creation_requests")
    .update({ status: "denied", reviewed_by: user.id, resolved_at: new Date().toISOString() })
    .eq("id", requestId)
    .eq("status", "pending")
    .select("id");

  if (error || !data?.length) {
    console.error("[denyCreationRequest]", error?.message);
    return { ok: false, error: "Couldn't deny this request — it may already be resolved." };
  }

  revalidatePath("/admin");
  redirect("/admin");
}
