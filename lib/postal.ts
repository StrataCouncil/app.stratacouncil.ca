/**
 * Canadian postal codes. Addresses are stored as one line ending in the
 * postal code ("1702 Coursier Ave, Revelstoke, BC, V0E 2S3"), so agendas,
 * minutes and the strata header print them as they are.
 */

// Letters D, F, I, O, Q and U are never used; W and Z never start a code.
const POSTAL = /^([ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z])\s?(\d[ABCEGHJ-NPRSTV-Z]\d)$/i;
const TRAILING = /,?\s*([ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z])\s?(\d[ABCEGHJ-NPRSTV-Z]\d)\s*$/i;

/** "v0e2s3" -> "V0E 2S3"; null if it isn't a valid Canadian postal code. */
export function normalizePostalCode(value: string): string | null {
  const m = POSTAL.exec(value.trim());
  return m ? `${m[1]} ${m[2]}`.toUpperCase() : null;
}

/** Split a stored one-line address into the street part and its postal code (if it ends in one). */
export function splitPostal(address: string): { street: string; postal: string } {
  const m = TRAILING.exec(address);
  if (!m) return { street: address.trim(), postal: "" };
  return { street: address.slice(0, m.index).trim().replace(/,\s*$/, ""), postal: `${m[1]} ${m[2]}`.toUpperCase() };
}

/** The stored one-line form. */
export function joinPostal(street: string, postal: string): string {
  const s = street.trim().replace(/,\s*$/, "");
  const p = normalizePostalCode(postal) ?? postal.trim().toUpperCase();
  return p ? `${s}, ${p}` : s;
}

/** True when a stored address ends in a valid postal code. */
export function hasPostalCode(address: string): boolean {
  return TRAILING.test(address);
}
