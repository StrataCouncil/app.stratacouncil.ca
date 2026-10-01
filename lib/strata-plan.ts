/**
 * Reading a Strata Plan PDF's text (pure helpers; the server action in
 * app/strata/actions.ts does the I/O and the AI call). The lot count
 * comes from the plan, not the requester, so a strata can't be created
 * with fewer lots than it has.
 */

/** "EPS-9048" → "EPS9048", the form the plan and the legal name use. */
export function compactPlanNumber(normalized: string) {
  return normalized.replace("-", "");
}

/** BC's legal name for a strata corporation: "The Owners, Strata Plan EPS9048". */
export function legalNameFor(normalized: string) {
  return `The Owners, Strata Plan ${compactPlanNumber(normalized)}`;
}

/** Whether the plan's text mentions this plan number (any spacing or dash). */
export function mentionsPlanNumber(text: string, normalized: string) {
  const [prefix, number] = normalized.split("-");
  if (!prefix || !number) return false;
  return new RegExp(`\\b${prefix}\\s*[-.]?\\s*0*${number}\\b`, "i").test(text);
}

/** Every distinct plan number the text mentions, normalized. */
export function planNumbersIn(text: string): string[] {
  const found = new Set<string>();
  const re = /\b(BCS|LMS|NWS|VIS|KAS|NES|EPS|VR|EPP|LMP|KAP|VIP|NEP|PGS|PRS|CAS)\s*[-.]?\s*(\d{2,6})\b/gi;
  for (const m of text.matchAll(re)) found.add(`${m[1].toUpperCase()}-${Number(m[2])}`);
  return [...found];
}

/** The highest strata lot number the text mentions ("Strata Lot 102", "SL 102", "Lot 102"). */
export function highestLotMentioned(text: string): number | null {
  let max = 0;
  // "District Lot 1234" is a land survey parcel, not a strata lot.
  const re = /(?<!district\s)\b(?:strata\s+lot|SL|lot)\s*(?:no\.?\s*)?(\d{1,4})\b/gi;
  for (const m of text.matchAll(re)) {
    const n = Number(m[1]);
    if (n > max && n <= 5000) max = n;
  }
  return max || null;
}

export interface ParsedPlan {
  planNumberMatches: boolean;
  /** Plan numbers the text names, when it doesn't name the one requested. */
  otherPlanNumbers: string[];
  lots: number | null;
  /** "consistent" when the AI's count equals the highest lot the text names. */
  lotsCheck: "consistent" | "differs" | "unchecked";
  unitEntitlementTotal: number | null;
  filedYear: number | null;
}

/** Combine the AI's reading with what the text says directly. */
export function reconcilePlan(
  text: string,
  normalized: string,
  ai: { lots: number | null; totalUnitEntitlement: number | null; filedYear: number | null }
): ParsedPlan {
  const matches = mentionsPlanNumber(text, normalized);
  const highest = highestLotMentioned(text);
  const lots = ai.lots && ai.lots > 0 && ai.lots <= 5000 ? Math.trunc(ai.lots) : highest;
  return {
    planNumberMatches: matches,
    otherPlanNumbers: matches ? [] : planNumbersIn(text).filter((p) => p !== normalized).slice(0, 5),
    lots,
    lotsCheck: lots && highest ? (lots === highest ? "consistent" : "differs") : "unchecked",
    unitEntitlementTotal:
      ai.totalUnitEntitlement && ai.totalUnitEntitlement > 0 ? ai.totalUnitEntitlement : null,
    filedYear: ai.filedYear && ai.filedYear > 1960 && ai.filedYear <= new Date().getFullYear() ? ai.filedYear : null,
  };
}
