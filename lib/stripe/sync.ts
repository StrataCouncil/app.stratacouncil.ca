import type Stripe from "stripe";
import { stripeModeFor, type StripeMode } from "@/lib/stripe/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeCommittedUntil } from "@/lib/stripe/prices";

/**
 * Stripe subscription state into `subscriptions` (doc01 §4b): binary
 * active/deactivated for access, any Stripe status other than 'active' or
 * 'trialing' maps to 'deactivated'. Stripe's raw status is kept alongside
 * (`stripe_status`) so a first payment still processing reads as Pending.
 */

function mapStatus(stripeStatus: Stripe.Subscription.Status): "active" | "deactivated" {
  return stripeStatus === "active" || stripeStatus === "trialing" ? "active" : "deactivated";
}

/**
 * A strata's Stripe IDs belong to one mode (0029). An event from the other
 * mode, such as a sandbox event for a live strata, is ignored.
 */
export async function sameMode(corporationId: string, mode: StripeMode) {
  const corpMode = await stripeModeFor(corporationId);
  if (corpMode !== mode) {
    console.warn(`stripe-webhook: ignoring a ${mode} event for ${corporationId}, which bills through ${corpMode}.`);
    return false;
  }
  return true;
}

/**
 * Mirror a Stripe subscription into `subscriptions`. Called by the webhook
 * for every subscription event, and by the pay step right after it creates
 * the subscription, so a card payment shows Active at once instead of
 * waiting for the webhook.
 */
export async function syncSubscription(sub: Stripe.Subscription, mode: StripeMode): Promise<boolean> {
  const admin = createAdminClient();
  const corporationId = sub.metadata?.corporation_id;
  if (!corporationId) {
    console.error(`stripe-webhook: subscription ${sub.id} has no corporation_id metadata.`);
    return false;
  }
  if (!(await sameMode(corporationId, mode))) return false;

  const { data: existing } = await admin
    .from("subscriptions")
    .select("committed_until, activated_at, billing_interval, stripe_subscription_id, pending_interval")
    .eq("corporation_id", corporationId)
    .maybeSingle();

  const status = mapStatus(sub.status);
  const billingInterval =
    (sub.metadata?.billing_interval as "monthly" | "annual" | undefined) ??
    existing?.billing_interval ??
    "monthly";

  const activatedAt =
    existing?.activated_at ?? (status === "active" ? new Date().toISOString() : null);

  // Stripe moved `current_period_end` from the Subscription object onto
  // each Subscription Item in its 2025 API versions; read both shapes so
  // this keeps working regardless of which API version the account is
  // pinned to (Checkout Sessions created above don't set this explicitly).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const subAny = sub as any;
  const periodEndUnix: number | null =
    subAny.current_period_end ?? subAny.items?.data?.[0]?.current_period_end ?? null;
  const periodStartUnix: number | null =
    subAny.current_period_start ?? subAny.items?.data?.[0]?.current_period_start ?? null;
  const currentPeriodEnd = periodEndUnix ? new Date(periodEndUnix * 1000).toISOString() : null;

  // The first annual term's end, stored once per term start (doc01 §4b):
  // a new annual subscription, or a scheduled switch onto annual landing
  // now. Later renewals roll forward from it (currentTermEnd), and a
  // unit-count change or webhook replay doesn't move it.
  const startsAnnualTerm =
    billingInterval === "annual" &&
    (!existing?.committed_until ||
      existing.billing_interval !== "annual" ||
      existing.stripe_subscription_id !== sub.id);
  const termStart = periodStartUnix ? new Date(periodStartUnix * 1000) : activatedAt ? new Date(activatedAt) : new Date();
  const committedUntil =
    billingInterval !== "annual"
      ? null
      : startsAnnualTerm
        ? status === "active"
          ? computeCommittedUntil(termStart).toISOString()
          : null
        : existing!.committed_until;

  // A scheduled switch is done once the new interval is in force, and
  // gone if the schedule was released (kept the current plan).
  const switchSettled =
    Boolean(existing?.pending_interval) && (existing!.pending_interval === billingInterval || !sub.schedule);

  const { error: writeError } = await admin
    .from("subscriptions")
    .upsert(
      {
        corporation_id: corporationId,
        status,
        // Stripe's own status: "incomplete" while a first payment (often a
        // pre-authorized debit) is still processing, shown as Pending (0030).
        stripe_status: sub.status,
        billing_interval: billingInterval,
        stripe_customer_id:
          typeof sub.customer === "string" ? sub.customer : sub.customer.id,
        stripe_subscription_id: sub.id,
        activated_at: activatedAt,
        committed_until: committedUntil,
        current_period_end: currentPeriodEnd,
        cancel_at: sub.cancel_at ? new Date(sub.cancel_at * 1000).toISOString() : null,
        ...(switchSettled ? { pending_interval: null, pending_interval_at: null, stripe_schedule_id: null } : {}),
      },
      { onConflict: "corporation_id" }
    );
  if (writeError) {
    console.error(`[syncSubscription] ${corporationId}:`, writeError.message);
    return false;
  }

  // doc01 §4/§4b: the free trial meeting expires the instant a
  // subscription is ever activated, whether or not it was ever used.
  if (status === "active") {
    await admin
      .from("strata_corporations")
      .update({ free_meeting_used: true, free_meeting_used_at: new Date().toISOString() })
      .eq("strata_plan_number", corporationId)
      .eq("free_meeting_used", false);
  }
  return true;
}
