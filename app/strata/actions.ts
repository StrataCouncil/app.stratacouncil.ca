"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { inviteIsPending, notifyInviteAccepted } from "@/lib/email/invite-accepted";
import { IS_DEMO } from "@/lib/demo";
import { EMAIL_RE, isJurisdictionCode, normalizeStrataPlanNumber } from "@/lib/strata";
import { extractDocumentText } from "@/lib/kb/extract";
import { stripPII } from "@/lib/pii";
import { askClaudeJson } from "@/lib/ai/claude";
import { reconcilePlan } from "@/lib/strata-plan";
import { hasPostalCode } from "@/lib/postal";

/**
 * Server Actions behind /strata — connecting to a strata (doc01 §4,
 * doc03 "Zero, one, and many connections"):
 *
 *   1. lookupStrata — SP# first, always. A match routes into the join
 *      flow (no upload at all); no match routes into creation.
 *   2a. requestToJoin — self-serve `corporation_join_requests` row; the
 *       corporation's admin approves or denies it from Council & Roles.
 *   2b. createStrataPlanUpload + submitCreationRequest — upload the Strata
 *       Plan, enter its identity fields, attest, and leave a pending
 *       `corporation_creation_requests` row for Super Admin review. No
 *       corporation exists until that review approves it.
 *
 * The uploaded plan is the one place this uses the service-role client:
 * there's no corporation yet for documents/storage RLS to scope it to, so
 * the upload goes through a server-minted signed URL into a private
 * bucket, under a path prefixed with the uploader's own user id, and the
 * `documents` row is written server-side after checking that prefix.
 */

const STRATA_PLAN_BUCKET = "strata-plans";
const MAX_PLAN_BYTES = 50 * 1024 * 1024;

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? { supabase, user } : null;
}

export type LookupResult =
  | { status: "invalid" }
  | {
      status: "found";
      strataPlanNumber: string;
      name: string;
      membershipStatus: "active" | "invited" | "removed" | null;
      pendingJoinRequest: boolean;
    }
  | {
      status: "not_found";
      strataPlanNumber: string;
      /** This user's own request for this SP# is waiting on review. */
      pendingCreationRequest: boolean;
      /** Someone else's request for this SP# is waiting on review. */
      pendingCreationRequestByOther: boolean;
    };

const DEMO_ONE_STRATA = "In the demo you have one strata, your own.";

export async function lookupStrata(input: string): Promise<LookupResult> {
  if (IS_DEMO) return { status: "invalid" };
  const strataPlanNumber = normalizeStrataPlanNumber(input);
  if (!strataPlanNumber) return { status: "invalid" };

  const ctx = await requireUser();
  if (!ctx) return { status: "invalid" };
  const { supabase, user } = ctx;

  const { data: matches, error } = await supabase.rpc("lookup_strata_corporation", {
    p_strata_plan_number: strataPlanNumber,
  });
  if (error) console.error("[lookupStrata]", error.message);
  const match = matches?.[0] as
    | { strata_plan_number: string; legal_name: string; building_name: string | null }
    | undefined;

  if (match) {
    const [{ data: membership }, { data: pending }] = await Promise.all([
      supabase
        .from("corporation_memberships")
        .select("status")
        .eq("corporation_id", strataPlanNumber)
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("corporation_join_requests")
        .select("id")
        .eq("corporation_id", strataPlanNumber)
        .eq("requested_by", user.id)
        .eq("status", "pending")
        .maybeSingle(),
    ]);

    return {
      status: "found",
      strataPlanNumber,
      name: match.building_name || match.legal_name,
      membershipStatus: (membership?.status as "active" | "invited" | "removed" | undefined) ?? null,
      pendingJoinRequest: Boolean(pending),
    };
  }

  const [{ data: pendingCreation }, { data: anyPending }] = await Promise.all([
    supabase
      .from("corporation_creation_requests")
      .select("id")
      .eq("requested_by", user.id)
      .eq("parsed_strata_plan_number", strataPlanNumber)
      .eq("status", "pending")
      .maybeSingle(),
    supabase.rpc("strata_plan_has_pending_request", { p_strata_plan_number: strataPlanNumber }),
  ]);

  return {
    status: "not_found",
    strataPlanNumber,
    pendingCreationRequest: Boolean(pendingCreation),
    pendingCreationRequestByOther: !pendingCreation && anyPending === true,
  };
}

export type SimpleResult = { ok: true } | { ok: false; error: string };

export async function requestToJoin(strataPlanNumber: string): Promise<SimpleResult> {
  // The demo (lib/demo.ts): each visitor has their own strata, and no other.
  if (IS_DEMO) return { ok: false, error: DEMO_ONE_STRATA };
  const ctx = await requireUser();
  if (!ctx) return { ok: false, error: "Please sign in again." };
  const { supabase, user } = ctx;

  const { error } = await supabase
    .from("corporation_join_requests")
    .insert({ corporation_id: strataPlanNumber, requested_by: user.id });

  if (error) {
    if (error.code === "23505") return { ok: true }; // already pending
    console.error("[requestToJoin]", error.code, error.message);
    return { ok: false, error: "Couldn't send your request. Please try again." };
  }

  revalidatePath("/strata");
  return { ok: true };
}

export async function acceptInvite(inviteId: string) {
  const ctx = await requireUser();
  if (!ctx) redirect("/login");

  const wasPending = await inviteIsPending(inviteId);
  const { data: corporationId, error } = await ctx.supabase.rpc("accept_corporation_invite", {
    p_invite_id: inviteId,
  });
  if (error || !corporationId) {
    const message = error?.code === "P0001" ? error.message : "Couldn't accept that invitation.";
    redirect(`/strata?connect=1&error=${encodeURIComponent(message)}`);
  }
  if (wasPending) await notifyInviteAccepted(corporationId, ctx.user.id);

  // Same as /invite/[id]: an invite-created account may have no name yet.
  const { data: profile } = await ctx.supabase
    .from("profiles")
    .select("full_name")
    .eq("id", ctx.user.id)
    .single();
  const destination = `/strata/${corporationId}`;
  if (!profile?.full_name?.trim()) {
    redirect(`/welcome?next=${encodeURIComponent(destination)}`);
  }
  redirect(destination);
}

/** Hide one of your own turned-down requests from the list (0025). */
export async function dismissRequest(kind: "join" | "creation", requestId: string) {
  const ctx = await requireUser();
  if (!ctx) redirect("/login");
  const { error } = await ctx.supabase.rpc("dismiss_my_request", { p_kind: kind, p_request_id: requestId });
  if (error) console.error("[dismissRequest]", error.message);
  revalidatePath("/strata");
}

export type UploadTicket =
  | { ok: true; path: string; token: string }
  | { ok: false; error: string };

/**
 * Mints a one-time signed upload URL so the browser uploads the plan
 * straight to Storage — a Strata Plan PDF is routinely larger than a
 * Server Action / serverless request body allows.
 */
export async function createStrataPlanUpload(file: {
  name: string;
  size: number;
  type: string;
}): Promise<UploadTicket> {
  // The demo (lib/demo.ts): each visitor has their own strata, and no other.
  if (IS_DEMO) return { ok: false, error: DEMO_ONE_STRATA };
  const ctx = await requireUser();
  if (!ctx) return { ok: false, error: "Please sign in again." };

  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    return { ok: false, error: "Upload the Strata Plan as a PDF." };
  }
  if (file.size > MAX_PLAN_BYTES) {
    return { ok: false, error: "That file is over 50 MB. Upload a smaller copy of the plan." };
  }

  const path = `${ctx.user.id}/${randomUUID()}.pdf`;
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(STRATA_PLAN_BUCKET)
    .createSignedUploadUrl(path);

  if (error || !data) {
    console.error("[createStrataPlanUpload]", error?.message);
    return { ok: false, error: "Couldn't start the upload. Please try again." };
  }
  return { ok: true, path: data.path, token: data.token };
}

export type PlanParseResult =
  | {
      ok: true;
      status: "parsed";
      lots: number | null;
      lotsCheck: "consistent" | "differs" | "unchecked";
      unitEntitlementTotal: number | null;
      filedYear: number | null;
    }
  | { ok: true; status: "no_text" | "failed" }
  | { ok: true; status: "wrong_plan"; found: string[] }
  | { ok: false; error: string };

const PLAN_SCHEMA = {
  type: "object",
  properties: {
    lots: { type: "integer", description: "Number of strata lots; 0 if the plan doesn't show it." },
    totalUnitEntitlement: { type: "number", description: "Aggregate unit entitlement total; 0 if not shown." },
    filedYear: { type: "integer", description: "Year the plan was filed or deposited at the LTSA; 0 if not shown." },
  },
  required: ["lots", "totalUnitEntitlement", "filedYear"],
  additionalProperties: false,
};

/**
 * Reads an uploaded Strata Plan right after upload: checks it's the plan
 * that was looked up, and takes the number of strata lots from the plan
 * itself so nobody types it in. The text is read on our servers; only a
 * PII-stripped copy goes to the AI. A scanned plan (no text layer) isn't
 * sent anywhere: the requester types the lot count and the reviewer checks
 * it against the plan. The result is stored server-side and is what
 * `submitCreationRequest` uses, so the browser can't change it.
 */
export async function parseStrataPlan(strataPlanNumber: string, planStoragePath: string): Promise<PlanParseResult> {
  // The demo (lib/demo.ts): each visitor has their own strata, and no other.
  if (IS_DEMO) return { ok: false, error: DEMO_ONE_STRATA };
  const ctx = await requireUser();
  if (!ctx) return { ok: false, error: "Please sign in again." };
  const sp = normalizeStrataPlanNumber(strataPlanNumber);
  if (!sp) return { ok: false, error: "Enter a valid Strata Plan number." };
  if (!planStoragePath.startsWith(`${ctx.user.id}/`) || planStoragePath.includes("..")) {
    return { ok: false, error: "Upload the Strata Plan again." };
  }

  const admin = createAdminClient();
  const save = (row: Record<string, unknown>) =>
    admin.from("strata_plan_parses").upsert({
      storage_path: planStoragePath,
      requested_by: ctx.user.id,
      strata_plan_number: sp,
      plan_number_matches: false,
      ...row,
    });

  const { data: file, error: downloadError } = await admin.storage.from(STRATA_PLAN_BUCKET).download(planStoragePath);
  if (downloadError || !file) return { ok: false, error: "The upload didn't finish. Upload the plan again." };

  try {
    const extracted = await extractDocumentText(new Uint8Array(await file.arrayBuffer()), "plan.pdf", "application/pdf");
    if (extracted.status !== "ok") {
      await save({ status: "no_text" });
      return { ok: true, status: "no_text" };
    }
    const text = extracted.text;

    const precheck = reconcilePlan(text, sp, { lots: null, totalUnitEntitlement: null, filedYear: null });
    if (!precheck.planNumberMatches) {
      await save({ status: "parsed", plan_number_matches: false });
      return { ok: true, status: "wrong_plan", found: precheck.otherPlanNumbers };
    }

    const ai = await askClaudeJson<{ lots: number; totalUnitEntitlement: number; filedYear: number }>({
      effort: "low",
      maxTokens: 2000,
      system:
        "You read British Columbia LTSA Strata Plans. Report the number of strata lots (the highest strata lot number, " +
        "or the row count of the Schedule of Unit Entitlement), the aggregate unit entitlement total, and the year the plan " +
        "was filed or deposited. Use 0 for anything the text doesn't show. Some names and addresses are redacted; ignore them.",
      messages: [{ role: "user", content: `Strata Plan text:\n\n${stripPII(text).slice(0, 150000)}` }],
      schema: PLAN_SCHEMA,
    });
    const parsed = reconcilePlan(text, sp, {
      lots: ai.lots || null,
      totalUnitEntitlement: ai.totalUnitEntitlement || null,
      filedYear: ai.filedYear || null,
    });
    await save({
      status: "parsed",
      plan_number_matches: true,
      lots: parsed.lots,
      lots_check: parsed.lotsCheck,
      unit_entitlement_total: parsed.unitEntitlementTotal,
      filed_year: parsed.filedYear,
    });
    if (!parsed.lots) return { ok: true, status: "failed" };
    return {
      ok: true,
      status: "parsed",
      lots: parsed.lots,
      lotsCheck: parsed.lotsCheck,
      unitEntitlementTotal: parsed.unitEntitlementTotal,
      filedYear: parsed.filedYear,
    };
  } catch (error) {
    console.error("[parseStrataPlan]", error instanceof Error ? error.message : error);
    await save({ status: "failed" });
    return { ok: true, status: "failed" };
  }
}

export interface CreationRequestInput {
  strataPlanNumber: string;
  legalName: string;
  buildingName: string;
  address: string;
  /** Picked from the address lookup rather than typed. */
  addressVerified: boolean;
  /** Only used when the plan couldn't be read (scanned); otherwise the plan's count wins. */
  unitCount: number;
  jurisdiction: string;
  planStoragePath: string;
  planFileName: string;
  attestationFullName: string;
  attestationAddress: string;
  attestationEmail: string;
  attestationPhone: string;
  attestationConfirmed: boolean;
}

export async function submitCreationRequest(input: CreationRequestInput): Promise<SimpleResult> {
  // The demo (lib/demo.ts): each visitor has their own strata, and no other.
  if (IS_DEMO) return { ok: false, error: DEMO_ONE_STRATA };
  const ctx = await requireUser();
  if (!ctx) return { ok: false, error: "Please sign in again." };
  const { supabase, user } = ctx;

  const strataPlanNumber = normalizeStrataPlanNumber(input.strataPlanNumber);
  const legalName = input.legalName.trim();
  const address = input.address.trim();
  const buildingName = input.buildingName.trim().slice(0, 200);
  const attestation = {
    fullName: input.attestationFullName.trim(),
    address: input.attestationAddress.trim(),
    email: input.attestationEmail.trim(),
    phone: input.attestationPhone.trim(),
  };

  if (!strataPlanNumber) return { ok: false, error: "Enter a valid Strata Plan number, e.g. BCS-1234." };
  if (!legalName) return { ok: false, error: "Enter the corporation's legal name." };
  if (!address) return { ok: false, error: "Enter the corporation's civic address." };
  if (!hasPostalCode(address)) return { ok: false, error: "Add the postal code to the corporation's civic address." };
  if (!hasPostalCode(input.attestationAddress)) return { ok: false, error: "Add the postal code to your mailing address." };
  if (!isJurisdictionCode(input.jurisdiction)) return { ok: false, error: "Choose a jurisdiction." };
  if (!attestation.fullName || !attestation.address || !attestation.phone) {
    return { ok: false, error: "Complete every attestation field." };
  }
  if (!EMAIL_RE.test(attestation.email)) return { ok: false, error: "Enter a valid attestation email." };
  if (!input.attestationConfirmed) return { ok: false, error: "Confirm the attestation to continue." };

  // The upload ticket put the file under the uploader's own folder; refuse
  // to attach anything else.
  if (!input.planStoragePath.startsWith(`${user.id}/`) || input.planStoragePath.includes("..")) {
    return { ok: false, error: "Upload the Strata Plan again." };
  }

  const admin = createAdminClient();

  // The lot count comes from the plan as read on upload (parseStrataPlan),
  // never from the browser, unless the plan couldn't be read.
  const { data: parse } = await admin
    .from("strata_plan_parses")
    .select("status, plan_number_matches, lots, lots_check, unit_entitlement_total, filed_year")
    .eq("storage_path", input.planStoragePath)
    .eq("requested_by", user.id)
    .eq("strata_plan_number", strataPlanNumber)
    .maybeSingle();
  if (!parse) return { ok: false, error: "Upload the Strata Plan again so it can be read." };
  if (parse.status === "parsed" && !parse.plan_number_matches) {
    return { ok: false, error: `That file isn't the Strata Plan for ${strataPlanNumber}. Upload the right plan.` };
  }
  const fromPlan = parse.status === "parsed" && Boolean(parse.lots);
  const unitCount = fromPlan ? (parse.lots as number) : Math.trunc(Number(input.unitCount));
  if (!Number.isFinite(unitCount) || unitCount < 1 || unitCount > 5000) {
    return { ok: false, error: "Enter the number of strata lots shown on the plan." };
  }

  const [folder, fileName] = input.planStoragePath.split("/");
  const { data: stored } = await admin.storage
    .from(STRATA_PLAN_BUCKET)
    .list(folder, { search: fileName });
  if (!stored?.some((f) => f.name === fileName)) {
    return { ok: false, error: "The Strata Plan upload didn't finish. Upload it again." };
  }

  const { data: existing } = await supabase.rpc("lookup_strata_corporation", {
    p_strata_plan_number: strataPlanNumber,
  });
  if (existing?.length) {
    return {
      ok: false,
      error: `${strataPlanNumber} is already on StrataCouncil.ca — look it up again to request to join instead.`,
    };
  }

  const { data: document, error: documentError } = await admin
    .from("documents")
    .insert({
      corporation_id: null,
      category: "legal_governance",
      title: `Strata Plan ${strataPlanNumber} (${input.planFileName.slice(0, 200)})`,
      // Always a PDF (checked at upload); the extension is what marks it indexable.
      file_name: /\.pdf$/i.test(input.planFileName) ? input.planFileName.slice(0, 300) : `${input.planFileName.slice(0, 290) || "strata-plan"}.pdf`,
      mime_type: "application/pdf",
      source_type: "strata_plan",
      storage_path: `${STRATA_PLAN_BUCKET}/${input.planStoragePath}`,
      uploaded_by: user.id,
    })
    .select("id")
    .single();
  if (documentError || !document) {
    console.error("[submitCreationRequest] documents insert:", documentError?.message);
    return { ok: false, error: "Couldn't save the uploaded plan. Please try again." };
  }

  const { error } = await supabase.from("corporation_creation_requests").insert({
    strata_plan_document_id: document.id,
    parsed_strata_plan_number: strataPlanNumber,
    parsed_legal_name: legalName,
    parsed_address: address,
    parsed_unit_count: unitCount,
    parsed_jurisdiction: input.jurisdiction,
    building_name: buildingName || null,
    address_verified: Boolean(input.addressVerified),
    unit_count_source: fromPlan ? "plan" : "manual",
    lots_check: fromPlan ? parse.lots_check : null,
    parsed_unit_entitlement_total: parse.unit_entitlement_total,
    parsed_filed_year: parse.filed_year,
    requested_by: user.id,
    attestation_full_name: attestation.fullName,
    attestation_address: attestation.address,
    attestation_email: attestation.email,
    attestation_phone: attestation.phone,
    attestation_confirmed: true,
    attestation_confirmed_at: new Date().toISOString(),
  });

  if (error) {
    await admin.from("documents").delete().eq("id", document.id);
    if (error.code === "23505") {
      // One pending request per SP#, from anyone (doc01 §1).
      return {
        ok: false,
        error: `A request to add ${strataPlanNumber} is already being reviewed. Once it's approved, look it up again to request to join.`,
      };
    }
    console.error("[submitCreationRequest]", error.code, error.message);
    return { ok: false, error: "Couldn't submit your request. Please try again." };
  }

  revalidatePath("/strata");
  return { ok: true };
}
