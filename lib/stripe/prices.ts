/**
 * Stripe Price IDs for the two StrataSphere™ plans (doc01 §4b). Both
 * annual and monthly are `interval=month` in Stripe — annual is a
 * discounted monthly rate paid over a committed 12-month term, not a
 * once-a-year lump sum (changed to avoid Stripe's CAD $3,000 per-
 * transaction cap on Canadian pre-authorized debits). Four Prices exist:
 * a flat base price and a per-unit (per-strata-lot) price, for each plan.
 *
 * Env vars (Vercel Production + Preview, same pattern as
 * SUPABASE_WEBHOOK_SECRET): STRIPE_PRICE_MONTHLY_BASE,
 * STRIPE_PRICE_MONTHLY_UNIT, STRIPE_PRICE_ANNUAL_BASE,
 * STRIPE_PRICE_ANNUAL_UNIT.
 */
export type BillingInterval = "monthly" | "annual";

export function getPriceIds(interval: BillingInterval): {
  base: string;
  perUnit: string;
} {
  const base =
    interval === "monthly"
      ? process.env.STRIPE_PRICE_MONTHLY_BASE
      : process.env.STRIPE_PRICE_ANNUAL_BASE;
  const perUnit =
    interval === "monthly"
      ? process.env.STRIPE_PRICE_MONTHLY_UNIT
      : process.env.STRIPE_PRICE_ANNUAL_UNIT;

  if (!base || !perUnit) {
    throw new Error(
      `Missing Stripe price env vars for the ${interval} plan. Expected STRIPE_PRICE_${interval.toUpperCase()}_BASE and STRIPE_PRICE_${interval.toUpperCase()}_UNIT.`
    );
  }

  return { base, perUnit };
}

// Display-side rates, kept in one place so billing/page.tsx's estimate
// matches what Stripe will actually charge without a live API call just
// to render a summary. Must be kept in sync with the Stripe dashboard by
// hand — there's no API call cheap enough to do this per page-render.
export const DISPLAY_RATES: Record<
  BillingInterval,
  { basePriceMonthly: number; perUnitMonthly: number }
> = {
  monthly: { basePriceMonthly: 99, perUnitMonthly: 2.49 },
  annual: { basePriceMonthly: 82.5, perUnitMonthly: 2.08 },
};

/** Subtotal/GST/total for a corporation's unit count and chosen plan. Both
 * plans bill monthly — annual's "discount" is just a lower monthly rate in
 * exchange for the 12-month commitment, not a once-a-year charge. */
export function calculateBilling(unitCount: number, interval: BillingInterval) {
  const { basePriceMonthly, perUnitMonthly } = DISPLAY_RATES[interval];
  const subtotal = basePriceMonthly + perUnitMonthly * unitCount;
  const gst = subtotal * 0.05;
  return { subtotal, gst, total: subtotal + gst };
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
