import type Stripe from "stripe";
import { getStripe, stripeModeFor } from "@/lib/stripe/client";
import { syncSubscription } from "@/lib/stripe/sync";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * What happens after Stripe's embedded payment form finishes, shared by
 * the form's own completion callback and the return pages Stripe uses
 * when a bank needs a redirect. Server only. Every check ties the Stripe
 * session to this strata before anything is recorded.
 */

async function storedIds(corporationId: string) {
  const { data } = await createAdminClient()
    .from("subscriptions")
    .select("stripe_customer_id, stripe_subscription_id")
    .eq("corporation_id", corporationId)
    .maybeSingle();
  return data;
}

const idOf = (v: string | { id: string } | null | undefined) => (v ? (typeof v === "string" ? v : v.id) : null);

/**
 * A subscription whose first payment was just confirmed in the dialog:
 * clear its "awaiting payment" mark, make the method it was paid with the
 * customer's default too (Billing shows it; renewals use it), and record
 * it. False if it isn't this strata's, or nothing has been paid yet.
 */
export async function recordSubscriptionPayment(corporationId: string, subscriptionId: string): Promise<boolean> {
  if (!subscriptionId.startsWith("sub_")) return false;
  const mode = await stripeModeFor(corporationId);
  const stripe = getStripe(mode);
  try {
    const [sub, ids] = await Promise.all([
      stripe.subscriptions.retrieve(subscriptionId, { expand: ["latest_invoice.payment_intent"] }),
      storedIds(corporationId),
    ]);
    if (sub.metadata?.corporation_id !== corporationId) return false;
    if (!ids?.stripe_customer_id || idOf(sub.customer) !== ids.stripe_customer_id) return false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const intent = (sub.latest_invoice as any)?.payment_intent as Stripe.PaymentIntent | null | undefined;
    if (sub.status === "incomplete" && (!intent || ["requires_payment_method", "requires_confirmation"].includes(intent.status))) {
      return false;
    }
    const updated = await stripe.subscriptions.update(subscriptionId, { metadata: { awaiting_payment: "" } });
    const pm =
      idOf(updated.default_payment_method as string | Stripe.PaymentMethod | null) ??
      idOf(intent?.payment_method as string | Stripe.PaymentMethod | null | undefined);
    if (pm) await stripe.customers.update(ids.stripe_customer_id, { invoice_settings: { default_payment_method: pm } });
    return await syncSubscription(updated, mode);
  } catch (error) {
    console.error(`[recordSubscriptionPayment] ${corporationId}:`, error instanceof Error ? error.message : error);
    return false;
  }
}

/** Make a saved method the one that pays: the customer's default and the subscription's. */
async function useForSubscription(stripe: Stripe, customerId: string, subscriptionId: string | null, pm: string) {
  await stripe.customers.update(customerId, { invoice_settings: { default_payment_method: pm } });
  if (subscriptionId) await stripe.subscriptions.update(subscriptionId, { default_payment_method: pm });
}

/** A completed update form: use the new method now, or say it still needs verifying. */
export async function recordPaymentMethodUpdate(corporationId: string, sessionId: string): Promise<"updated" | "verify" | "failed"> {
  if (!sessionId.startsWith("cs_")) return "failed";
  const mode = await stripeModeFor(corporationId);
  const stripe = getStripe(mode);
  try {
    const [session, ids] = await Promise.all([
      stripe.checkout.sessions.retrieve(sessionId, { expand: ["setup_intent"] }),
      storedIds(corporationId),
    ]);
    if (session.mode !== "setup" || session.metadata?.corporation_id !== corporationId) return "failed";
    if (!ids?.stripe_customer_id || idOf(session.customer) !== ids.stripe_customer_id) return "failed";
    const intent = session.setup_intent && typeof session.setup_intent !== "string" ? session.setup_intent : null;
    if (!intent) return "failed";
    if (intent.status === "requires_action" && intent.next_action?.verify_with_microdeposits) return "verify";
    const pm = idOf(intent.payment_method as string | Stripe.PaymentMethod | null);
    if (intent.status !== "succeeded" || !pm) return "failed";
    await useForSubscription(stripe, ids.stripe_customer_id, ids.stripe_subscription_id, pm);
    return "updated";
  } catch (error) {
    console.error(`[recordPaymentMethodUpdate] ${corporationId}:`, error instanceof Error ? error.message : error);
    return "failed";
  }
}

/**
 * On Billing: the newest payment-method update, if it's still waiting on
 * micro-deposits (its verification link), or if it was verified since and
 * isn't in use yet (it's put to use now, so nobody has to come back and
 * finish anything).
 */
export async function settlePaymentMethodUpdate(
  stripe: Stripe,
  customerId: string,
  subscriptionId: string | null,
  currentDefault: string | null
): Promise<{ verifyUrl: string | null } | null> {
  try {
    const intents = await stripe.setupIntents.list({ customer: customerId, limit: 10 });
    const latest = intents.data.find((i) => i.metadata?.purpose === "update_payment_method" && i.status !== "canceled");
    if (!latest) return null;
    if (latest.status === "requires_action" && latest.next_action?.verify_with_microdeposits) {
      return { verifyUrl: latest.next_action.verify_with_microdeposits.hosted_verification_url ?? null };
    }
    const pm = idOf(latest.payment_method as string | Stripe.PaymentMethod | null);
    if (latest.status === "succeeded" && pm && pm !== currentDefault) {
      await useForSubscription(stripe, customerId, subscriptionId, pm);
    }
    return null;
  } catch (error) {
    console.error("[settlePaymentMethodUpdate]", error instanceof Error ? error.message : error);
    return null;
  }
}
