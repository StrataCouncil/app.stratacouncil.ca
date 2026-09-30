import { type NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeCommittedUntil } from "@/lib/stripe/prices";

/**
 * Stripe webhook receiver — the only place `subscriptions.status` (and
 * the rest of the billing columns) actually gets written, other than the
 * optimistic `cancel_at` mirror in billing/actions.ts. Configured in the
 * Stripe dashboard (Developers → Webhooks) to point at this route's
 * deployed URL, same one-receiver-many-event-types shape as
 * app/api/auth/send-email-hook/route.ts, but verified with Stripe's own
 * SDK (`stripe.webhooks.constructEvent`) instead of the hand-rolled
 * HMAC in lib/auth/verify-supabase-webhook.ts — Stripe signs its webhooks
 * the same way, but the SDK already does it, so there's no reason to
 * reimplement it here.
 *
 * doc01 §4b / doc00 changelog: binary active/deactivated, no past_due
 * state surfaced to the app — any Stripe subscription status other than
 * 'active' or 'trialing' maps to our 'deactivated'.
 */

function mapStatus(stripeStatus: Stripe.Subscription.Status): "active" | "deactivated" {
  return stripeStatus === "active" || stripeStatus === "trialing" ? "active" : "deactivated";
}

async function syncSubscription(sub: Stripe.Subscription) {
  const admin = createAdminClient();
  const corporationId = sub.metadata?.corporation_id;
  if (!corporationId) {
    console.error(`stripe-webhook: subscription ${sub.id} has no corporation_id metadata.`);
    return;
  }

  const { data: existing } = await admin
    .from("subscriptions")
    .select("committed_until, activated_at, billing_interval")
    .eq("corporation_id", corporationId)
    .maybeSingle();

  const status = mapStatus(sub.status);
  const billingInterval =
    (sub.metadata?.billing_interval as "monthly" | "annual" | undefined) ??
    existing?.billing_interval ??
    "monthly";

  const activatedAt =
    existing?.activated_at ?? (status === "active" ? new Date().toISOString() : null);

  // Computed once, at first activation, and never recalculated (doc01
  // §4b) — a later unit-count or webhook replay doesn't move the
  // committed-until anniversary.
  const committedUntil =
    billingInterval === "annual"
      ? existing?.committed_until ??
        (activatedAt ? computeCommittedUntil(new Date(activatedAt)).toISOString() : null)
      : null;

  // Stripe moved `current_period_end` from the Subscription object onto
  // each Subscription Item in its 2025 API versions; read both shapes so
  // this keeps working regardless of which API version the account is
  // pinned to (Checkout Sessions created above don't set this explicitly).
  const periodEndUnix: number | null =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sub as any).current_period_end ?? sub.items.data[0]?.current_period_end ?? null;
  const currentPeriodEnd = periodEndUnix ? new Date(periodEndUnix * 1000).toISOString() : null;

  await admin
    .from("subscriptions")
    .upsert(
      {
        corporation_id: corporationId,
        status,
        billing_interval: billingInterval,
        stripe_customer_id:
          typeof sub.customer === "string" ? sub.customer : sub.customer.id,
        stripe_subscription_id: sub.id,
        activated_at: activatedAt,
        committed_until: committedUntil,
        current_period_end: currentPeriodEnd,
        cancel_at: sub.cancel_at ? new Date(sub.cancel_at * 1000).toISOString() : null,
      },
      { onConflict: "corporation_id" }
    );

  // doc01 §4/§4b: the free trial meeting expires the instant a
  // subscription is ever activated, whether or not it was ever used.
  if (status === "active") {
    await admin
      .from("strata_corporations")
      .update({ free_meeting_used: true, free_meeting_used_at: new Date().toISOString() })
      .eq("strata_plan_number", corporationId)
      .eq("free_meeting_used", false);
  }
}

async function deactivate(sub: Stripe.Subscription) {
  const corporationId = sub.metadata?.corporation_id;
  if (!corporationId) return;
  const admin = createAdminClient();
  await admin
    .from("subscriptions")
    .update({ status: "deactivated", cancel_at: null })
    .eq("corporation_id", corporationId);
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secret) {
    console.error("stripe-webhook: STRIPE_WEBHOOK_SECRET is not set.");
    return NextResponse.json({ error: "Server misconfiguration." }, { status: 500 });
  }
  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature header." }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, signature, secret);
  } catch (error) {
    console.error("stripe-webhook: signature verification failed:", error);
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
        await syncSubscription(event.data.object as Stripe.Subscription);
        break;
      case "customer.subscription.deleted":
        await deactivate(event.data.object as Stripe.Subscription);
        break;
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.subscription) {
          const subId =
            typeof session.subscription === "string"
              ? session.subscription
              : session.subscription.id;
          const sub = await getStripe().subscriptions.retrieve(subId);
          await syncSubscription(sub);
        }
        break;
      }
      default:
        // Unhandled event types are expected and fine to ignore — we
        // only subscribed to these in the Stripe dashboard on purpose.
        break;
    }
  } catch (error) {
    console.error(`stripe-webhook: failed handling ${event.type}:`, error);
    return NextResponse.json({ error: "Handler failed." }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
