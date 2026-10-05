import { type NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe, webhookSecrets, type StripeMode } from "@/lib/stripe/client";
import { sameMode, syncSubscription } from "@/lib/stripe/sync";
import { recordPaymentMethodUpdate } from "@/lib/stripe/payment-results";
import { createAdminClient } from "@/lib/supabase/admin";
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

async function deactivate(sub: Stripe.Subscription, mode: StripeMode) {
  const corporationId = sub.metadata?.corporation_id;
  if (!corporationId) return;
  if (!(await sameMode(corporationId, mode))) return;
  const admin = createAdminClient();
  await admin
    .from("subscriptions")
    .update({ status: "deactivated", stripe_status: sub.status, cancel_at: null, pending_interval: null, pending_interval_at: null, stripe_schedule_id: null })
    .eq("corporation_id", corporationId)
    // Only the subscription on record: an unpaid one opened in the subscribe
    // dialog and then replaced or cancelled never touches the strata.
    .eq("stripe_subscription_id", sub.id);
}

/**
 * subscriptions.billing_email can list several contacts (0018). Stripe
 * emails its receipt to the Customer's email (the first); everyone else
 * gets a copy with the hosted invoice link. Best effort.
 */
async function copyInvoiceToContacts(invoice: Stripe.Invoice, mode: StripeMode) {
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
  if (!(await sameMode(sub.corporation_id, mode))) return;
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
  const secrets = webhookSecrets();
  if (secrets.length === 0) {
    console.error("stripe-webhook: STRIPE_WEBHOOK_SECRET is not set.");
    return NextResponse.json({ error: "Server misconfiguration." }, { status: 500 });
  }
  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature header." }, { status: 400 });
  }

  // Live and sandbox (Stripe test mode) both post here, each signed with
  // its own secret; whichever verifies says which mode the event is from.
  let event: Stripe.Event | null = null;
  let mode: StripeMode = "live";
  for (const candidate of secrets) {
    try {
      event = getStripe(candidate.mode).webhooks.constructEvent(rawBody, signature, candidate.secret);
      mode = candidate.mode;
      break;
    } catch {
      // Try the next secret.
    }
  }
  if (!event) {
    console.error("stripe-webhook: signature verification failed for every configured secret.");
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
        await syncSubscription(event.data.object as Stripe.Subscription, mode);
        break;
      case "customer.subscription.deleted":
        await deactivate(event.data.object as Stripe.Subscription, mode);
        break;
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const corpId = session.metadata?.corporation_id;
        // The in-app payment-method update form: record it the same way the
        // app does when the form finishes, in case the browser didn't.
        // (Subscriptions aren't created through Checkout; they arrive as
        // customer.subscription.* events above.)
        if (corpId && session.metadata?.purpose === "update_payment_method" && (await sameMode(corpId, mode))) {
          await recordPaymentMethodUpdate(corpId, session.id);
        }
        break;
      }
      case "invoice.paid":
        await copyInvoiceToContacts(event.data.object as Stripe.Invoice, mode);
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
