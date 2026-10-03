import { type NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeCommittedUntil } from "@/lib/stripe/prices";
import { sendTransactionalEmail } from "@/lib/email/mailtrap";
import { invoiceCopyEmail } from "@/lib/email/templates";

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
        ...(switchSettled ? { pending_interval: null, pending_interval_at: null, stripe_schedule_id: null } : {}),
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
    .update({ status: "deactivated", cancel_at: null, pending_interval: null, pending_interval_at: null, stripe_schedule_id: null })
    .eq("corporation_id", corporationId);
}

/**
 * subscriptions.billing_email can list several contacts (0018). Stripe
 * emails its receipt to the Customer's email (the first); everyone else
 * gets a copy with the hosted invoice link. Best effort.
 */
async function copyInvoiceToContacts(invoice: Stripe.Invoice) {
  const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
  if (!customerId || !invoice.hosted_invoice_url) return;
  const admin = createAdminClient();
  const { data: sub } = await admin
    .from("subscriptions")
    .select("corporation_id, billing_email")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  const others = (sub?.billing_email ?? "")
    .split(",")
    .map((e: string) => e.trim())
    .filter(Boolean)
    .slice(1);
  if (!sub || others.length === 0) return;
  const { data: corp } = await admin
    .from("strata_corporations")
    .select("building_name, legal_name")
    .eq("strata_plan_number", sub.corporation_id)
    .maybeSingle();
  const message = invoiceCopyEmail({
    corporationName: corp?.building_name ?? corp?.legal_name ?? sub.corporation_id,
    amount: (invoice.amount_paid / 100).toLocaleString("en-CA", { style: "currency", currency: "CAD" }),
    invoiceUrl: invoice.hosted_invoice_url,
    invoiceNumber: invoice.number ?? null,
  });
  for (const to of others) {
    await sendTransactionalEmail({ to, ...message }).catch((error) =>
      console.error("stripe-webhook: invoice copy failed:", error instanceof Error ? error.message : error)
    );
  }
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
      case "invoice.paid":
        await copyInvoiceToContacts(event.data.object as Stripe.Invoice);
        break;
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
