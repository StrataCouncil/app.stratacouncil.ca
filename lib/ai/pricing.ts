/**
 * Estimated cost of one Claude call, in US dollars, at the list price of
 * the model Stratasphere uses (per million tokens): input $4, output $20
 * (thinking included), cache reads $0.20, 5-minute cache writes $5.
 * An estimate for the Super Admin dashboard, not an invoice.
 */
export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

const PER_MILLION = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 };

export function estimateCostUsd(u: TokenUsage): number {
  return (
    (u.input * PER_MILLION.input + u.output * PER_MILLION.output + u.cacheRead * PER_MILLION.cacheRead + u.cacheWrite * PER_MILLION.cacheWrite) /
    1_000_000
  );
}
