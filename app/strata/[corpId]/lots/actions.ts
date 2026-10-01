"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  ownerTypes,
  parseRosterCsv,
  rosterFieldLabels,
  rosterFields,
  type RosterField,
  type RosterUploadRow,
} from "@/lib/roster-csv";
import { EMAIL_RE } from "@/lib/strata";

/**
 * Server Actions behind Strata Lots (doc02 §2a). Every write goes through
 * the signed-in user's own client: RLS (0005) only lets the admin write
 * `owners_and_council`, and `apply_owner_roster_upload()` (0011) applies
 * an upload atomically with the doc's rules — blank means no change,
 * unknown or repeated lots reject the whole file, and the four governance
 * fields are out of a CSV's reach.
 *
 * Upload is two steps: preview (parse + diff against what's stored, no
 * writes) then apply (re-parse and write). The server re-parses on apply
 * rather than trusting a diff the browser sends back.
 */

const MAX_CSV_CHARS = 900_000; // under the 1 MB Server Action body limit

export type FieldChange = { field: RosterField; label: string; from: string; to: string };
export type LotChange = { lotNumber: string; changes: FieldChange[] };

export type PreviewResult =
  | { ok: false; errors: string[] }
  | { ok: true; lotsInFile: number; changedLots: LotChange[]; fieldCount: number };

export type ApplyResult =
  | { ok: false; errors: string[] }
  | { ok: true; lotsChanged: number; fieldsChanged: number };

function display(value: string | number | null | undefined) {
  return value === null || value === undefined || value === "" ? "(blank)" : String(value);
}

function sameValue(a: string | number | null, b: string | number | null) {
  if (typeof a === "number" || typeof b === "number") {
    return a !== null && b !== null && Number(a) === Number(b);
  }
  return a === b;
}

function parse(csv: string): { ok: true; rows: RosterUploadRow[] } | { ok: false; errors: string[] } {
  if (csv.length > MAX_CSV_CHARS) {
    return { ok: false, errors: ["That file is too large for a roster. Upload it as a plain CSV."] };
  }
  return parseRosterCsv(csv);
}

export async function previewRosterUpload(corporationId: string, csv: string): Promise<PreviewResult> {
  const parsed = parse(csv);
  if (!parsed.ok) return parsed;

  const supabase = await createClient();
  const { data: current, error } = await supabase
    .from("owners_and_council")
    .select(`lot_number, ${rosterFields.join(", ")}`)
    .eq("corporation_id", corporationId);
  if (error) {
    console.error("[previewRosterUpload]", error.message);
    return { ok: false, errors: ["Couldn't read the current roster. Please try again."] };
  }

  const byLot = new Map(
    ((current ?? []) as unknown as Record<string, string | number | null>[]).map((r) => [
      r.lot_number as string,
      r,
    ])
  );

  const seen = new Set<string>();
  const duplicates = new Set<string>();
  const unknown: string[] = [];
  for (const row of parsed.rows) {
    if (seen.has(row.lot_number)) duplicates.add(row.lot_number);
    seen.add(row.lot_number);
    if (!byLot.has(row.lot_number)) unknown.push(row.lot_number);
  }
  const errors: string[] = [];
  if (duplicates.size) {
    errors.push(`These strata lots appear more than once in the file: ${[...duplicates].join(", ")}.`);
  }
  if (unknown.length) {
    errors.push(
      `These strata lots aren't on this strata's plan: ${unknown.slice(0, 20).join(", ")}${
        unknown.length > 20 ? `, …and ${unknown.length - 20} more` : ""
      }. Check the file is for the right strata.`
    );
  }
  if (errors.length) return { ok: false, errors };

  const changedLots: LotChange[] = [];
  for (const row of parsed.rows) {
    const stored = byLot.get(row.lot_number)!;
    const changes: FieldChange[] = [];
    for (const field of rosterFields) {
      const incoming = row[field];
      const existing = stored[field] ?? null;
      if (incoming === null || sameValue(incoming, existing)) continue;
      changes.push({
        field,
        label: rosterFieldLabels[field],
        from: display(existing),
        to: display(incoming),
      });
    }
    if (changes.length) changedLots.push({ lotNumber: row.lot_number, changes });
  }

  return {
    ok: true,
    lotsInFile: parsed.rows.length,
    changedLots,
    fieldCount: changedLots.reduce((n, l) => n + l.changes.length, 0),
  };
}

export async function applyRosterUpload(corporationId: string, csv: string): Promise<ApplyResult> {
  const parsed = parse(csv);
  if (!parsed.ok) return parsed;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("apply_owner_roster_upload", {
    p_corporation_id: corporationId,
    p_rows: parsed.rows,
  });
  if (error) {
    console.error("[applyRosterUpload]", error.code, error.message);
    return {
      ok: false,
      errors: [error.code === "P0001" ? error.message : "Couldn't apply the upload. Nothing was changed."],
    };
  }

  const result = (data as { lots_changed: number; fields_changed: number }[] | null)?.[0];
  revalidatePath(`/strata/${corporationId}/lots`);
  return { ok: true, lotsChanged: result?.lots_changed ?? 0, fieldsChanged: result?.fields_changed ?? 0 };
}

export type LotEdit = {
  fullName: string;
  email: string;
  unitNumber: string;
  unitEntitlement: string;
  ownerType: string;
  parking: string;
  storage: string;
  bikeRack: string;
  strataFees: string;
  councilMemberName: string;
  councilEmail: string;
  isCouncilMember: boolean;
  role: string;
};

export type SaveLotResult = { ok: true } | { ok: false; error: string };

const lotRoles = ["president", "vice_president", "treasurer", "secretary"];

/**
 * Direct edit of one lot (doc02 §2a): the ten roster fields plus the four
 * governance fields an upload never touches. Unlike an upload, this is a
 * plain edit — what the admin typed is what's saved, and clearing a field
 * here does clear it.
 */
export async function saveLot(
  corporationId: string,
  lotNumber: string,
  edit: LotEdit
): Promise<SaveLotResult> {
  const text = (v: string) => v.trim() || null;
  const number = (v: string, label: string): number | null | string => {
    const cleaned = v.replace(/[$,\s]/g, "");
    if (!cleaned) return null;
    return /^-?\d+(\.\d+)?$/.test(cleaned) ? Number(cleaned) : `${label} must be a number.`;
  };

  const unitEntitlement = number(edit.unitEntitlement, "Unit entitlement");
  const strataFees = number(edit.strataFees, "Strata fees");
  for (const v of [unitEntitlement, strataFees]) if (typeof v === "string") return { ok: false, error: v };

  const email = text(edit.email);
  const councilEmail = text(edit.councilEmail);
  if (email && !EMAIL_RE.test(email)) return { ok: false, error: "Enter a valid owner email." };
  if (councilEmail && !EMAIL_RE.test(councilEmail)) {
    return { ok: false, error: "Enter a valid council delegate email." };
  }
  const ownerType = text(edit.ownerType);
  if (ownerType && !(ownerTypes as readonly string[]).includes(ownerType)) {
    return { ok: false, error: "Unknown owner type." };
  }
  const role = text(edit.role);
  if (role && !lotRoles.includes(role)) return { ok: false, error: "Unknown council role." };
  if (role && !edit.isCouncilMember) {
    return { ok: false, error: "A council role needs the lot marked as a council member." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("owners_and_council")
    .update({
      full_name: text(edit.fullName),
      email,
      unit_number: text(edit.unitNumber),
      unit_entitlement: unitEntitlement,
      owner_type: ownerType,
      parking: text(edit.parking),
      storage: text(edit.storage),
      bike_rack: text(edit.bikeRack),
      strata_fees: strataFees,
      council_member_name: text(edit.councilMemberName),
      council_email: councilEmail,
      is_council_member: edit.isCouncilMember,
      role,
    })
    .eq("corporation_id", corporationId)
    .eq("lot_number", lotNumber)
    .select("id");

  if (error) {
    console.error("[saveLot]", error.code, error.message);
    return { ok: false, error: "Couldn't save this lot." };
  }
  if (!data?.length) return { ok: false, error: "Only this strata's admin can edit the roster." };

  revalidatePath(`/strata/${corporationId}/lots`);
  return { ok: true };
}
