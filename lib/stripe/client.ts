import Stripe from "stripe";

/**
 * Server-only Stripe client. Never imported into anything that ships to
 * the browser — same rule as lib/supabase/admin.ts.
 *
 * Lazily constructed (not module-scoped at import time) so a missing
 * STRIPE_SECRET_KEY fails loudly the moment billing code actually runs,
 * rather than crashing every route that happens to import this file.
 */
let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (_stripe) return _stripe;

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "STRIPE_SECRET_KEY is not set. Add it in Vercel (Production + Preview), matching the pattern used for SUPABASE_WEBHOOK_SECRET etc."
    );
  }

  // No explicit apiVersion: pin via the Stripe dashboard instead of a
  // string literal here, so this doesn't have to change every time the
  // `stripe` package is upgraded (its type would otherwise force it).
  _stripe = new Stripe(key);
  return _stripe;
}
