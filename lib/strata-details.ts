import { jurisdictions } from "./strata.ts";

/**
 * The strata's editable details (the Overview's "Strata details" card,
 * update_strata_details in 0096). Shared by the dialog and its Server
 * Action, so both agree on what changed. Nothing here touches Supabase.
 */

export const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** "February 1 to January 31", or null when it isn't set. */
export function fiscalYearLabel(startMonth: number | null | undefined): string | null {
  if (!startMonth || startMonth < 1 || startMonth > 12) return null;
  const end = startMonth === 1 ? 12 : startMonth - 1;
  // February ends on the 28th or 29th; say "end of February" rather than guess.
  const endDay = end === 2 ? "end of February" : `${MONTHS[end - 1]} ${DAYS_IN_MONTH[end - 1]}`;
  return `${MONTHS[startMonth - 1]} 1 to ${endDay}`;
}

export interface StrataDetails {
  buildingName: string | null;
  address: string;
  fiscalYearStartMonth: number | null;
  legalName: string;
  jurisdiction: string;
  unitCount: number;
}

/** Fields the strata's Admin may change; the rest are for Super Admins. */
export const ADMIN_FIELDS = ["buildingName", "address", "fiscalYearStartMonth"] as const;
export const SUPER_ADMIN_FIELDS = ["legalName", "jurisdiction", "unitCount"] as const;
type Field = (typeof ADMIN_FIELDS)[number] | (typeof SUPER_ADMIN_FIELDS)[number];

const COLUMN: Record<Field, string> = {
  buildingName: "building_name",
  address: "address",
  fiscalYearStartMonth: "fiscal_year_start_month",
  legalName: "legal_name",
  jurisdiction: "jurisdiction",
  unitCount: "unit_count",
};

export const FIELD_LABELS: Record<Field, string> = {
  buildingName: "Building name",
  address: "Address",
  fiscalYearStartMonth: "Fiscal year",
  legalName: "Legal name",
  jurisdiction: "Jurisdiction",
  unitCount: "Number of strata lots",
};

export interface DetailChange {
  field: Field;
  label: string;
  from: string;
  to: string;
}

function shown(field: Field, value: StrataDetails[Field]): string {
  if (field === "fiscalYearStartMonth") return fiscalYearLabel(value as number | null) ?? "Not set";
  if (field === "jurisdiction") return jurisdictions.find((j) => j.code === value)?.label ?? String(value ?? "");
  if (value === null || value === undefined || value === "") return "None";
  return String(value);
}

function tidy(field: Field, value: StrataDetails[Field]): StrataDetails[Field] {
  if (typeof value !== "string") return value;
  const t = value.trim().replace(/\s+/g, " ");
  if (field === "buildingName") return t || null;
  if (field === "jurisdiction") return t.toUpperCase();
  return t;
}

/**
 * What would change, in words for the confirm step, and the JSON for
 * update_strata_details. Only the fields this person may change are
 * compared; the database checks the same rule again.
 */
export function detailChanges(
  before: StrataDetails,
  after: StrataDetails,
  superAdmin: boolean
): { changes: DetailChange[]; patch: Record<string, string | number | null> } {
  const fields: Field[] = superAdmin ? [...ADMIN_FIELDS, ...SUPER_ADMIN_FIELDS] : [...ADMIN_FIELDS];
  const changes: DetailChange[] = [];
  const patch: Record<string, string | number | null> = {};
  for (const field of fields) {
    const was = tidy(field, before[field]);
    const now = tidy(field, after[field]);
    if (was === now) continue;
    changes.push({ field, label: FIELD_LABELS[field], from: shown(field, was), to: shown(field, now) });
    patch[COLUMN[field]] = now as string | number | null;
  }
  return { changes, patch };
}

/** A problem with the form, in words, or null. The database checks again. */
export function detailsProblem(d: StrataDetails, superAdmin: boolean): string | null {
  if ((d.buildingName ?? "").trim().length > 120) return "The building name can be up to 120 characters.";
  const address = d.address.trim();
  if (!address || address.length > 300) return "Enter the address (up to 300 characters).";
  if (d.fiscalYearStartMonth !== null && !(Number.isInteger(d.fiscalYearStartMonth) && d.fiscalYearStartMonth >= 1 && d.fiscalYearStartMonth <= 12)) {
    return "Choose the month the fiscal year starts.";
  }
  if (superAdmin) {
    const legal = d.legalName.trim();
    if (!legal || legal.length > 200) return "Enter the legal name (up to 200 characters).";
    if (!jurisdictions.some((j) => j.code === d.jurisdiction)) return "Choose a jurisdiction.";
    if (!Number.isInteger(d.unitCount) || d.unitCount < 1 || d.unitCount > 10000) return "Enter the number of strata lots.";
  }
  return null;
}
