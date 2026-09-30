"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe/client";
import { getPriceIds, type BillingInterval } from "@/lib/stripe/prices";

/**
 * Server Actions behind billing/page.tsx's buttons. These are the
 * "handful of operations" lib/supabase/admin.ts reserves the service-role
 * client for: `subscriptions` has no client write policy at all
 * (0005_rls.sql), so authorization has to be checked here in application
 * code instead of leaning on RLS — every action below starts by
 * confirming the caller is a signed-in admin of this corporation before
 * touching Stripe or the service-role client.
 */

async function requireAdmin(corporationId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const { data, error } = await supabase
    .from("corporation_role_assignments")
    .select("role")
    .eq("corporation_id", corporationId)
    .eq("user_id", user.id)
    .eq("role", "admin")
    .maybeSingle();

  if (error || !data) {
    throw new Error("Only a corporation admin can manage billing.");
  }
  return user;
}

async function siteUrl() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

async function getOrCreateStripeCustomer(corporationId: string) {
  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("corporation_id", corporationId)
    .maybeSingle();

  if (existing?.stripe_customer_id) return existing.stripe_customer_id;

  const { data: corp } = await admin
    .from("strata_corporations")
    .select("legal_name, building_name")
    .eq("strata_plan_number", corporationId)
    .single();

  const stripe = getStripe();
  const customer = await stripe.customers.create({
    name: corp?.building_name ?? corp?.legal_name ?? corporationId,
    metadata: { corporation_id: corporationId },
  });

  // Upsert a placeholder row so the customer id is on file even before
  // any webhook fires — status stays at its 'deactivated' default until
  // the webhook confirms an actual active subscription.
  await admin
    .from("subscriptions")
    .upsert(
      { corporation_id: corporationId, stripe_customer_id: customer.id },
      { onConflict: "corporation_id" }
    );

  return customer.id;
}

/** "Subscribe" / "Change plan" CTA — sends the admin to Stripe Checkout
 * for a new subscription, or to replace the existing one. Checkout (not a
 * hand-built card form) so PAD/Interac and 3DS are handled by Stripe. */
export async function startCheckout(corporationId: string, interval: BillingInterval) {
  await requireAdmin(corporationId);

  const admin = createAdminClient();
  const { data: corp } = await admin
    .from("strata_corporations")
    .select("unit_count")
    .eq("strata_plan_number", corporationId)
    .single();
  if (!corp) throw new Error("Corporation not found.");

  const customerId = await getOrCreateStripeCustomer(corporationId);
  const { base, perUnit } = getPriceIds(interval);
  const origin = await siteUrl();

  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [
      { price: base, quantity: 1 },
      { price: perUnit, quantity: corp.unit_count },
    ],
    automatic_tax: { enabled: true },
    subscription_data: {
      metadata: { corporation_id: corporationId, billing_interval: interval },
    },
    success_url: `${origin}/strata/${corporationId}/billing?checkout=success`,
    cancel_url: `${origin}/strata/${corporationId}/billing?checkout=cancelled`,
  });

  if (!session.url) throw new Error("Stripe did not return a Checkout URL.");
  redirect(session.url);
}

/** Payment-method update / "Invoices" — both live in the Stripe-hosted
 * Billing Portal rather than a hand-built card form or invoice list. */
export async function openBillingPortal(corporationId: string) {
  await requireAdmin(corporationId);

  const admin = createAdminClient();
  const { data: sub } = await admin
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("corporation_id", corporationId)
    .maybeSingle();
  if (!sub?.stripe_customer_id) {
    throw new Error("No billing account on file yet — subscribe first.");
  }

  const origin = await siteUrl();
  const stripe = getStripe();
  const portal = await stripe.billingPortal.sessions.create({
    customer: sub.stripe_customer_id,
    return_url: `${origin}/strata/${corporationId}/billing`,
  });

  redirect(portal.url);
}

/** "Change billing interval" — swaps the existing subscription's two
 * line items (base + per-unit) onto the other plan's Prices in place,
 * rather than starting a second subscription. Switching onto the annual
 * plan restarts the 12-month commitment window from today (the webhook
 * recomputes `committed_until` once it sees the new activation-shaped
 * state — see stripe-webhook-route.ts's `syncSubscription`). */
export async function changePlan(corporationId: string, newInterval: BillingInterval) {
  await requireAdmin(corporationId);

  const admin = createAdminClient();
  const { data: sub } = await admin
    .from("subscriptions")
    .select("stripe_subscription_id, billing_interval")
    .eq("corporation_id", corporationId)
    .maybeSingle();
  if (!sub?.stripe_subscription_id) {
    throw new Error("No active subscription to change.");
  }
  if (sub.billing_interval === newInterval) return;

  const { data: corp } = await admin
    .from("strata_corporations")
    .select("unit_count")
    .eq("strata_plan_number", corporationId)
    .single();
  if (!corp) throw new Error("Corporation not found.");

  const stripe = getStripe();
  const current = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
  const { base, perUnit } = getPriceIds(newInterval);

  // Two existing items (base qty 1, per-unit qty N) swapped for the new
  // plan's two Prices in place — `deleted: true` removes each old item
  // as the corresponding new one is added, same subscription throughout.
  const items = current.items.data.map((item, i) => ({
    id: item.id,
    price: i === 0 ? base : perUnit,
    quantity: i === 0 ? 1 : corp.unit_count,
  }));

  await stripe.subscriptions.update(sub.stripe_subscription_id, {
    items,
    proration_behavior: "create_prorations",
    metadata: { corporation_id: corporationId, billing_interval: newInterval },
    // A plan change is a fresh commitment, not a cancellation — clear any
    // pending cancel_at so switching plans also un-schedules a cancel.
    cancel_at_period_end: false,
    cancel_at: null,
  });

  // Reset so the webhook treats this as a fresh activation and
  // recomputes committed_until for the new interval (see note above).
  await admin
    .from("subscriptions")
    .update({ billing_interval: newInterval, activated_at: new Date().toISOString(), committed_until: null, cancel_at: null })
    .eq("corporation_id", corporationId);
}

/**
 * Cancel — doc01 §4b's Stripe-native design, no early-termination fee.
 * Monthly: `cancel_at_period_end`, so it runs out the current monthly
 * anniversary. Annual: `cancel_at` set to the stored 12-month
 * `committed_until` (the term the corporation already committed to,
 * computed once at activation) — access and billing continue exactly as
 * before until that date, then the subscription simply doesn't renew.
 * Either way this only *schedules* the stop; the webhook is what flips
 * `status` to 'deactivated' once Stripe actually ends it.
 */
export async function cancelSubscription(corporationId: string) {
  await requireAdmin(corporationId);

  const admin = createAdminClient();
  const { data: sub } = await admin
    .from("subscriptions")
    .select("stripe_subscription_id, billing_interval, committed_until")
    .eq("corporation_id", corporationId)
    .maybeSingle();

  if (!sub?.stripe_subscription_id) {
    throw new Error("No active subscription to cancel.");
  }

  const stripe = getStripe();
  let updated;
  if (sub.billing_interval === "annual" && sub.committed_until) {
    const cancelAtUnix = Math.floor(new Date(sub.committed_until).getTime() / 1000);
    updated = await stripe.subscriptions.update(sub.stripe_subscription_id, {
      cancel_at: cancelAtUnix,
    });
  } else {
    updated = await stripe.subscriptions.update(sub.stripe_subscription_id, {
      cancel_at_period_end: true,
    });
  }

  // Optimistic local mirror — the webhook will reconfirm this, but the
  // admin shouldn't have to reload to see "cancels on <date>".
  await admin
    .from("subscriptions")
    .update({
      cancel_at: updated.cancel_at
        ? new Date(updated.cancel_at * 1000).toISOString()
        : null,
    })
    .eq("corporation_id", corporationId);
}
