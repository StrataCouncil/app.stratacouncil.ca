import { normalizePostalCode } from "./postal.ts";

/**
 * The billing address on a strata's subscription (0030): the building's
 * civic address, or a management company's office. It goes to Stripe as
 * the customer's address, which is what Stripe calculates GST from.
 */
export interface BillingAddress {
  line1: string;
  line2: string;
  city: string;
  province: string;
  postalCode: string;
}

export const PROVINCES = ["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"] as const;

/** "1702 Coursier Ave, Revelstoke, BC, V0E 2S1" -> parts. Null when it can't tell. */
export function parseCivicAddress(address: string | null | undefined): BillingAddress | null {
  const parts = String(address ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 3) return null;
  let postalCode = "";
  const last = normalizePostalCode(parts[parts.length - 1]);
  if (last) {
    postalCode = last;
    parts.pop();
  }
  const province = parts[parts.length - 1]?.toUpperCase();
  if (!(PROVINCES as readonly string[]).includes(province ?? "")) return null;
  parts.pop();
  const city = parts.pop() ?? "";
  const line1 = parts.join(", ");
  if (!line1 || !city) return null;
  return { line1, line2: "", city, province: province!, postalCode };
}

/** Checks a typed address; the cleaned address, or what's wrong. */
export function readBillingAddress(input: Partial<Record<keyof BillingAddress, unknown>>):
  | { ok: true; address: BillingAddress }
  | { ok: false; error: string } {
  const clean = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  const address: BillingAddress = {
    line1: clean(input.line1, 200),
    line2: clean(input.line2, 200),
    city: clean(input.city, 100),
    province: clean(input.province, 2).toUpperCase(),
    postalCode: normalizePostalCode(clean(input.postalCode, 10)) ?? "",
  };
  if (!address.line1) return { ok: false, error: "Enter the street address." };
  if (!address.city) return { ok: false, error: "Enter the city." };
  if (!(PROVINCES as readonly string[]).includes(address.province)) return { ok: false, error: "Choose the province." };
  if (!address.postalCode) return { ok: false, error: "Enter a valid postal code, like V0E 2S1." };
  return { ok: true, address };
}

/** The address as Stripe takes it. */
export function toStripeAddress(a: BillingAddress) {
  return {
    line1: a.line1,
    line2: a.line2 || undefined,
    city: a.city,
    state: a.province,
    postal_code: a.postalCode,
    country: "CA",
  };
}

/** One line, for showing on the review step. */
export function formatBillingAddress(a: BillingAddress): string {
  return [a.line1, a.line2, a.city, a.province, a.postalCode].filter(Boolean).join(", ");
}
