import Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Server-only Stripe clients. Never imported into anything that ships to
 * the browser — same rule as lib/supabase/admin.ts.
 *
 * Two Stripe accounts' worth of keys (2026-10-05): live for every real
 * strata, sandbox (Stripe test mode) for a strata a Super Admin has marked
 * `stripe_sandbox` (0029), so billing can be tested on a test strata while
 * real customers are billed normally. Each strata's Stripe IDs belong to
 * one mode only.
 *
 *   live:    STRIPE_SECRET_KEY,      STRIPE_WEBHOOK_SECRET
 *   sandbox: STRIPE_TEST_SECRET_KEY, STRIPE_TEST_WEBHOOK_SECRET
 *
 * Lazily constructed so a missing key fails loudly the moment billing code
 * actually runs, rather than crashing every route that imports this file.
 */
export type StripeMode = "live" | "sandbox";

const clients: Partial<Record<StripeMode, Stripe>> = {};

export function getStripe(mode: StripeMode = "live"): Stripe {
  const cached = clients[mode];
  if (cached) return cached;

  const name = mode === "sandbox" ? "STRIPE_TEST_SECRET_KEY" : "STRIPE_SECRET_KEY";
  const key = process.env[name];
  if (!key) {
    throw new Error(`${name} is not set. Add it in Vercel (Production + Preview).`);
  }
  // A live key in the sandbox slot would bill a test strata for real.
  if (mode === "sandbox" && !/^(sk|rk)_test_/.test(key)) {
    throw new Error("STRIPE_TEST_SECRET_KEY must be a test-mode key (sk_test_…).");
  }

  // No explicit apiVersion: pin via the Stripe dashboard instead of a
  // string literal here, so this doesn't have to change every time the
  // `stripe` package is upgraded (its type would otherwise force it).
  const client = new Stripe(key);
  clients[mode] = client;
  return client;
}

/** Which Stripe a strata bills through: sandbox only when a Super Admin marked it. */
export async function stripeModeFor(corporationId: string): Promise<StripeMode> {
  const { data } = await createAdminClient()
    .from("strata_corporations")
    .select("stripe_sandbox")
    .eq("strata_plan_number", corporationId)
    .maybeSingle();
  return data?.stripe_sandbox ? "sandbox" : "live";
}

/** The Stripe client for this strata's mode. */
export async function stripeFor(corporationId: string): Promise<Stripe> {
  return getStripe(await stripeModeFor(corporationId));
}

/** Webhook signing secrets to try, in order; a mode without one is skipped. */
export function webhookSecrets(): Array<{ mode: StripeMode; secret: string }> {
  const out: Array<{ mode: StripeMode; secret: string }> = [];
  if (process.env.STRIPE_WEBHOOK_SECRET) out.push({ mode: "live", secret: process.env.STRIPE_WEBHOOK_SECRET });
  if (process.env.STRIPE_TEST_WEBHOOK_SECRET) out.push({ mode: "sandbox", secret: process.env.STRIPE_TEST_WEBHOOK_SECRET });
  return out;
}
