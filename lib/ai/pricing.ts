/**
 * Estimated cost of one Claude call, in US dollars, at the list price of
 * the model Stratasphere uses (per million tokens): input $4, output $20
 * (thinking included), cache reads $0.20, 5-minute cache writes $5, and
 * 1-hour cache writes $8 (twice the input price; PR 5 caches the bylaws,
 * ledger and platform records for an hour). An estimate for the Super
 * Admin dashboard, not an invoice.
 */
export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  /** All cache writes, both lifetimes. */
  cacheWrite: number;
  /** The part of cacheWrite cached for an hour (absent: none). */
  cacheWrite1h?: number;
}

const PER_MILLION = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5, cacheWrite1h: 8 };

export function estimateCostUsd(u: TokenUsage): number {
  const hour = Math.min(u.cacheWrite1h ?? 0, u.cacheWrite);
  return (
    (u.input * PER_MILLION.input +
      u.output * PER_MILLION.output +
      u.cacheRead * PER_MILLION.cacheRead +
      (u.cacheWrite - hour) * PER_MILLION.cacheWrite +
      hour * PER_MILLION.cacheWrite1h) /
    1_000_000
  );
}
