/**
 * Campaign tags on a sign-up (0066). stratacouncil.ca adds the tags a
 * visitor first arrived with to its /signup links; the sign-up form carries
 * them as hidden fields and sendOtp passes them to the new account. The
 * database keeps the same five keys and the same 100-character limit
 * (signup_campaign_from), whatever is sent.
 */
export const CAMPAIGN_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;
export type CampaignKey = (typeof CAMPAIGN_KEYS)[number];
export type Campaign = Partial<Record<CampaignKey, string>>;

const MAX = 100;

/** The campaign tags from anything with a get(key) (URLSearchParams, FormData); null when there are none. */
export function readCampaign(source: { get(key: string): unknown }): Campaign | null {
  const out: Campaign = {};
  for (const key of CAMPAIGN_KEYS) {
    const value = source.get(key);
    if (typeof value !== "string") continue;
    const trimmed = value.trim().slice(0, MAX);
    if (trimmed) out[key] = trimmed;
  }
  return Object.keys(out).length ? out : null;
}
