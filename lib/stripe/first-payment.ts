import type Stripe from "stripe";

/**
 * Where a new subscription's first payment stands, while it's "incomplete"
 * (2026-10-06). Three different situations look alike from the
 * subscription alone:
 *   processing: a pre-authorized debit on its way (a few business days)
 *   verify:     the bank account isn't verified yet, so the debit can't
 *               start; Stripe has a page to confirm its micro-deposits
 *   failed:     the payment was declined or couldn't be made
 */
export type FirstPayment =
  | { state: "processing" }
  | { state: "verify"; verifyUrl: string | null }
  | { state: "failed"; reason: string | null }
  | { state: "unknown" };

export async function firstPaymentState(stripe: Stripe, subscriptionId: string): Promise<FirstPayment> {
  try {
    const sub = await stripe.subscriptions.retrieve(subscriptionId, { expand: ["latest_invoice.payment_intent"] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const intent = (sub.latest_invoice as any)?.payment_intent as Stripe.PaymentIntent | null | undefined;
    if (!intent || typeof intent === "string") return { state: "unknown" };
    if (intent.status === "processing" || intent.status === "succeeded") return { state: "processing" };
    if (intent.status === "requires_action") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const next = intent.next_action as any;
      if (next?.verify_with_microdeposits) {
        return { state: "verify", verifyUrl: next.verify_with_microdeposits.hosted_verification_url ?? null };
      }
      // Anything else (a debit agreement that wasn't saved for
      // subscriptions) never resolves on its own: start again.
      return { state: "failed", reason: "The payment method needs to be authorized again." };
    }
    if (intent.status === "requires_payment_method" || intent.status === "canceled") {
      return { state: "failed", reason: intent.last_payment_error?.message ?? null };
    }
    return { state: "unknown" };
  } catch (error) {
    console.error("[firstPaymentState]", error instanceof Error ? error.message : error);
    return { state: "unknown" };
  }
}
