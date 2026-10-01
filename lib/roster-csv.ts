import { EMAIL_RE } from "./strata.ts";

/**
 * Owner/lot roster CSV (doc02 §2a): the column mapping, parsing, and
 * writing. Pure functions — no Supabase, no Node APIs — so the upload
 * Server Actions and the export route share one definition of the format.
 *
 * Only the ten mapped fields exist here. council_member_name,
 * council_email, is_council_member and role are governance state, set
 * in-app by the admin, and are never read from or written to a CSV.
 */

export const rosterFields = [
  "full_name",
  "email",
  "unit_number",
  "unit_entitlement",
  "owner_type",
  "parking",
  "storage",
  "bike_rack",
  "strata_fees",
] as const;

export type RosterField = (typeof rosterFields)[number];

/** CSV header → field, in template column order (doc02 §2a's table). */
export const rosterColumns: { header: string; field: "lot_number" | RosterField }[] = [
  { header: "Strata Lot", field: "lot_number" },
  { header: "Owner Name", field: "full_name" },
  { header: "Email", field: "email" },
  { header: "Unit Number", field: "unit_number" },
  { header: "Unit Entitlement", field: "unit_entitlement" },
  { header: "Owner Type", field: "owner_type" },
  { header: "Parking Stall(s)", field: "parking" },
  { header: "Storage Locker(s)", field: "storage" },
  { header: "Bike Rack(s)", field: "bike_rack" },
  { header: "Strata Fees", field: "strata_fees" },
];

export const rosterFieldLabels: Record<RosterField, string> = {
  full_name: "Owner name",
  email: "Email",
  unit_number: "Unit number",
  unit_entitlement: "Unit entitlement",
  owner_type: "Owner type",
  parking: "Parking",
  storage: "Storage",
  bike_rack: "Bike rack",
  strata_fees: "Strata fees",
};

export const ownerTypes = ["owner_occupant", "owner_absentee", "developer"] as const;
export type OwnerType = (typeof ownerTypes)[number];

export const ownerTypeLabels: Record<OwnerType, string> = {
  owner_occupant: "Owner Occupant",
  owner_absentee: "Owner Absentee",
  developer: "Developer",
};

/**
 * A cell may hold more than one email (co-owners), separated by spaces,
 * commas or semicolons. Returns them normalized as "a@x.ca, b@y.ca", or
 * the first invalid one.
 */
export function parseEmails(raw: string): { ok: true; value: string } | { ok: false; invalid: string } {
  const parts = raw.split(/[\s,;]+/).map((p) => p.trim()).filter(Boolean);
  for (const p of parts) if (!EMAIL_RE.test(p)) return { ok: false, invalid: p };
  return { ok: true, value: parts.join(", ") };
}

/** One parsed upload row. A null field means the cell was blank: no change. */
export type RosterUploadRow = { lot_number: string } & {
  [F in RosterField]: F extends "unit_entitlement" | "strata_fees" ? number | null : string | null;
};

export type RosterParseResult =
  | { ok: true; rows: RosterUploadRow[] }
  | { ok: false; errors: string[] };

/**
 * The canonical lot number the pre-seeding trigger uses (0004): "SL" plus
 * the number zero-padded to three digits. Accepts the obvious ways a
 * spreadsheet ends up writing it — "SL1", "sl 001", "SL-001", "1" — but
 * only formatting is forgiven; whether the lot exists is checked against
 * the database, and an unknown lot rejects the upload.
 */
export function normalizeLotNumber(input: string): string | null {
  const match = input.trim().match(/^(?:SL)?[\s\-_#.]*(\d{1,5})$/i);
  if (!match) return null;
  return `SL${String(Number(match[1])).padStart(3, "0")}`;
}

function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z]/g, "");
}

const headerToField = new Map(rosterColumns.map((c) => [normalizeHeader(c.header), c.field]));

/** RFC 4180-style: quoted fields may contain commas, quotes ("") and newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // Excel's BOM

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Undo the formula-injection guard `toCsv` adds on export. */
function unguard(value: string) {
  return /^'[=+\-@]/.test(value) ? value.slice(1) : value;
}

function parseNumber(raw: string): number | null | "invalid" {
  const cleaned = raw.replace(/[$,\s]/g, "");
  if (cleaned === "") return null;
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return "invalid";
  return Number(cleaned);
}

function parseOwnerType(raw: string): OwnerType | "invalid" {
  const key = raw.toLowerCase().replace(/[^a-z]/g, "");
  if (key === "owneroccupant" || key === "occupant") return "owner_occupant";
  if (key === "ownerabsentee" || key === "absentee") return "owner_absentee";
  if (key === "developer") return "developer";
  return "invalid";
}

const MAX_ERRORS = 20;

/**
 * Parses an uploaded roster. Columns are matched by header, in any order;
 * a missing column is the same as a blank one (no change). A row is
 * skipped if every mapped cell is blank. Any invalid cell fails the whole
 * file — partial uploads would leave the roster half-updated in a way
 * nobody asked for.
 */
export function parseRosterCsv(text: string): RosterParseResult {
  const rows = parseCsv(text).filter(
    (r) => !(r.length === 1 && r[0].trim() === "") && !r[0]?.trim().startsWith("#")
  );
  if (rows.length === 0) return { ok: false, errors: ["The file is empty."] };

  const header = rows[0].map((h) => headerToField.get(normalizeHeader(h)) ?? null);
  const lotIndex = header.indexOf("lot_number");
  if (lotIndex === -1) {
    return {
      ok: false,
      errors: [
        'The first row needs a "Strata Lot" column header. Start from the template so the columns line up.',
      ],
    };
  }

  const errors: string[] = [];
  const parsed: RosterUploadRow[] = [];

  rows.slice(1).forEach((cells, i) => {
    const line = i + 2; // 1-based, after the header
    const value = (field: string) => {
      const index = header.indexOf(field as RosterField);
      return index === -1 ? "" : unguard((cells[index] ?? "").trim());
    };

    const rawLot = (cells[lotIndex] ?? "").trim();
    const anyData = rosterFields.some((f) => value(f) !== "");
    if (!anyData) return; // e.g. the template's blank pre-listed lots
    if (!rawLot) {
      errors.push(`Row ${line}: has data but no strata lot.`);
      return;
    }
    const lot = normalizeLotNumber(rawLot);
    if (!lot) {
      errors.push(`Row ${line}: "${rawLot}" isn't a strata lot number (expected something like SL001).`);
      return;
    }

    const row: RosterUploadRow = {
      lot_number: lot,
      full_name: value("full_name") || null,
      email: value("email") || null,
      unit_number: value("unit_number") || null,
      unit_entitlement: null,
      owner_type: null,
      parking: value("parking") || null,
      storage: value("storage") || null,
      bike_rack: value("bike_rack") || null,
      strata_fees: null,
    };

    if (row.email) {
      const emails = parseEmails(row.email);
      if (emails.ok) row.email = emails.value;
      else errors.push(`Row ${line} (${lot}): "${emails.invalid}" isn't a valid email.`);
    }
    for (const field of ["unit_entitlement", "strata_fees"] as const) {
      const n = parseNumber(value(field));
      if (n === "invalid") {
        errors.push(`Row ${line} (${lot}): ${rosterFieldLabels[field]} "${value(field)}" isn't a number.`);
      } else {
        row[field] = n;
      }
    }
    const rawType = value("owner_type");
    if (rawType) {
      const type = parseOwnerType(rawType);
      if (type === "invalid") {
        errors.push(`Row ${line} (${lot}): Owner Type "${rawType}" should be Owner Occupant, Owner Absentee, or Developer.`);
      } else {
        row.owner_type = type;
      }
    }

    parsed.push(row);
  });

  if (errors.length > 0) {
    const extra = errors.length - MAX_ERRORS;
    return {
      ok: false,
      errors: extra > 0 ? [...errors.slice(0, MAX_ERRORS), `…and ${extra} more.`] : errors,
    };
  }
  if (parsed.length === 0) return { ok: false, errors: ["The file has no strata lot rows."] };
  return { ok: true, rows: parsed };
}

/**
 * One CSV cell. Quoted when needed; a value a spreadsheet would treat as a
 * formula (leading = + - @) gets a leading apostrophe, which
 * `parseRosterCsv` strips again on re-upload.
 */
function csvCell(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export type RosterCsvRow = { lot_number: string } & Partial<
  Record<RosterField, string | number | null>
>;

export function toRosterCsv(rows: RosterCsvRow[]): string {
  const lines = [rosterColumns.map((c) => csvCell(c.header)).join(",")];
  for (const row of rows) {
    lines.push(
      rosterColumns
        .map((c) => {
          const v = row[c.field];
          return csvCell(c.field === "owner_type" && v ? ownerTypeLabels[v as OwnerType] ?? v : v);
        })
        .join(",")
    );
  }
  return lines.join("\r\n") + "\r\n";
}
