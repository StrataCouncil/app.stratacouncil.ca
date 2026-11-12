/**
 * The Stratasphere plans (docs/learn-decide-remember.md §4):
 *
 *   Monthly: $30 a month per strata, plus $3 a month per strata lot.
 *   Yearly:  $300 a year per strata, plus $30 a year per strata lot,
 *            charged once a year (two months free).
 *   GST (5%) on top, calculated by Stripe Tax. No cap.
 *   Enterprise: over ENTERPRISE_LOTS lots, or a management company:
 *            "Talk to us", and a price the Super Admin sets for that strata.
 *
 * In Stripe each plan is two Prices: a flat base and a per-unit (per lot)
 * price. Monthly is interval=month; yearly ("annual" in the code and the
 * database) is interval=year.
 *
 * Env vars (Vercel Production + Preview): STRIPE_PRICE_MONTHLY_BASE,
 * STRIPE_PRICE_MONTHLY_UNIT, STRIPE_PRICE_ANNUAL_BASE,
 * STRIPE_PRICE_ANNUAL_UNIT, and STRIPE_TEST_PRICE_* for sandbox stratas.
 */
export type BillingInterval = "monthly" | "annual";

export function getPriceIds(
  interval: BillingInterval,
  mode: "live" | "sandbox" = "live"
): {
  base: string;
  perUnit: string;
} {
  // Sandbox stratas use the test-mode Prices: STRIPE_TEST_PRICE_*.
  const prefix = mode === "sandbox" ? "STRIPE_TEST_PRICE_" : "STRIPE_PRICE_";
  const which = interval === "monthly" ? "MONTHLY" : "ANNUAL";
  const base = process.env[`${prefix}${which}_BASE`];
  const perUnit = process.env[`${prefix}${which}_UNIT`];

  if (!base || !perUnit) {
    throw new Error(`Missing Stripe price env vars for the ${interval} plan. Expected ${prefix}${which}_BASE and ${prefix}${which}_UNIT.`);
  }

  return { base, perUnit };
}

/**
 * The rates, per billing period, kept in step with the Stripe Prices by
 * hand (no API call is cheap enough for every page view).
 */
export const PLAN_RATES: Record<BillingInterval, { base: number; perLot: number; period: "month" | "year" }> = {
  monthly: { base: 30, perLot: 3, period: "month" },
  annual: { base: 300, perLot: 30, period: "year" },
};

/** Above this many lots, a strata talks to us (Enterprise) instead of subscribing itself. */
export const ENTERPRISE_LOTS = 100;

/** Stripe's limit on one Canadian pre-authorized debit, in dollars: a larger charge is card only. */
export const PAD_LIMIT = 3000;

export const GST_RATE = 0.05;

export interface PlanPrice {
  subtotal: number;
  gst: number;
  total: number;
  /** What the amounts are per. */
  period: "month" | "year";
  /** The total spread over a month, for comparing plans and adding up stratas. */
  monthlyTotal: number;
  monthlySubtotal: number;
}

const cents = (n: number) => Math.round(n * 100) / 100;

function priced(subtotal: number, period: "month" | "year"): PlanPrice {
  const gst = cents(subtotal * GST_RATE);
  const total = cents(subtotal + gst);
  const months = period === "year" ? 12 : 1;
  return { subtotal: cents(subtotal), gst, total, period, monthlyTotal: total / months, monthlySubtotal: subtotal / months };
}

/** Subtotal, GST, and total per billing period for a strata's lot count and plan. */
export function calculateBilling(unitCount: number, interval: BillingInterval): PlanPrice {
  const { base, perLot, period } = PLAN_RATES[interval];
  return priced(base + perLot * Math.max(0, unitCount), period);
}

/** An Enterprise price: an agreed amount (before GST) per month or per year. */
export function customBilling(amount: number, interval: BillingInterval): PlanPrice {
  return priced(amount, interval === "annual" ? "year" : "month");
}

/** Pre-authorized debit is offered only when one charge stays within Stripe's limit. */
export function padAllowed(price: PlanPrice): boolean {
  return price.total <= PAD_LIMIT;
}

/** "a month" or "a year". */
export function perPeriod(period: "month" | "year") {
  return period === "year" ? "a year" : "a month";
}

/** The end of the first 12-month annual term, from when that term began.
 * Stored as subscriptions.committed_until. Not moved by a unit-count change;
 * later terms are found with currentTermEnd(). */
export function computeCommittedUntil(activatedAt: Date): Date {
  const d = new Date(activatedAt);
  d.setFullYear(d.getFullYear() + 1);
  return d;
}

/**
 * The annual plan renews into a new 12-month term on each anniversary
 * (doc01 §4b). Given the first term's end, the end of the term running
 * now: the first anniversary that is still in the future.
 */
export function currentTermEnd(firstTermEnd: Date, now: Date = new Date()): Date {
  const end = new Date(firstTermEnd);
  for (let years = 1; end.getTime() <= now.getTime(); years++) {
    end.setTime(firstTermEnd.getTime());
    end.setFullYear(firstTermEnd.getFullYear() + years);
  }
  return end;
}

/**
 * When the running annual term ends, for a subscriptions row. Falls back
 * to the activation date when committed_until was never stored.
 */
export function annualTermEnd(row: { committed_until: string | null; activated_at: string | null }, now: Date = new Date()): Date | null {
  const first = row.committed_until
    ? new Date(row.committed_until)
    : row.activated_at
      ? computeCommittedUntil(new Date(row.activated_at))
      : null;
  return first ? currentTermEnd(first, now) : null;
}
