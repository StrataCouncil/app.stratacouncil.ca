import Link from "next/link";
import {
  calculateBilling,
  currentCorporation,
  subscription,
} from "@/lib/placeholder-data";

/**
 * Billing — admin-only (doc01 §7 item 7: subscribing is admin-gated, no
 * exception, same pattern as meeting creation). Not part of the
 * Stratasphere™ sub-nav (`StrataSphereNav`) since it isn't a content tab
 * every connected member should land on — it's reached from the "Admin"
 * entry point on Council & Roles instead. Real role-gating (redirect a
 * non-admin away) needs actual auth wired in; this renders the intended
 * UI either way, same as the rest of this placeholder app. The parent
 * layout (`../layout.tsx`) already supplies the corp identity header and
 * the wrap/page shell, so this only renders its own content.
 */
export default function BillingPage() {
  const subscribed = currentCorporation.subscriptionStatus === "active";
  const deactivated = currentCorporation.subscriptionStatus === "deactivated";
  const { monthlySubtotal, subtotal, gst, total } = calculateBilling(
    currentCorporation.unitCount,
    subscription.billingInterval
  );

  const fmt = (n: number) =>
    n.toLocaleString("en-CA", { style: "currency", currency: "CAD" });

  return (
    <>
      <Link
        href={`/strata/${currentCorporation.id}`}
        className="button button-secondary button-small"
        style={{ marginBottom: "1.5rem" }}
      >
        &larr; Back to Council &amp; Roles
      </Link>

      <div className="page-header" style={{ marginBottom: "1.75rem" }}>
        <span className="pill">Admin</span>
        <h2 style={{ margin: "0.6rem 0 0" }}>Billing &amp; subscription</h2>
      </div>

      <div className="billing-grid">
        <div className="card" data-testid="billing-plan-card">
          <span
            className={`pill ${subscribed ? "" : "pill--locked"}`}
            style={{ alignSelf: "flex-start" }}
          >
            {subscribed ? "Active" : deactivated ? "Deactivated" : "Not subscribed"}
          </span>
          <h3>Stratasphere&trade; plan</h3>
          <p>
            $99/mo base + $2.49/unit/mo &mdash; billed{" "}
            {subscription.billingInterval === "annual" ? "annually" : "monthly"}
            , {currentCorporation.unitCount} units.
          </p>

          <div className="billing-lines">
            <div className="billing-line">
              <span>Base</span>
              <span>{fmt(subscription.basePriceMonthly)}/mo</span>
            </div>
            <div className="billing-line">
              <span>
                {currentCorporation.unitCount} units &times;{" "}
                {fmt(subscription.perUnitMonthly)}/mo
              </span>
              <span>
                {fmt(subscription.perUnitMonthly * currentCorporation.unitCount)}/mo
              </span>
            </div>
            <div className="billing-line billing-line--subtotal">
              <span>
                {subscription.billingInterval === "annual"
                  ? "Subtotal (10 mo, 2 free)"
                  : "Subtotal"}
              </span>
              <span>{fmt(subtotal)}</span>
            </div>
            <div className="billing-line">
              <span>GST (5%)</span>
              <span>{fmt(gst)}</span>
            </div>
            <div className="billing-line billing-line--total">
              <span>
                Total {subscription.billingInterval === "annual" ? "/ year" : "/ month"}
              </span>
              <span>{fmt(total)}</span>
            </div>
          </div>

          {subscribed ? (
            <p className="card__meta">
              Next billing date: {subscription.nextBillingDate}. Active since{" "}
              {subscription.activatedAt}.
            </p>
          ) : (
            <p className="card__meta">
              No payment required to create or run your strata &mdash; this
              unlocks the document repository, Meeting Mode and the
              Stratasphere&trade; assistant.
            </p>
          )}

          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            {subscribed ? (
              <>
                <button className="button button-secondary" data-testid="change-plan-cta">
                  Change billing interval
                </button>
                <button className="button button-secondary" data-testid="cancel-subscription-cta">
                  Cancel subscription
                </button>
              </>
            ) : (
              <button className="button button-primary" data-testid="billing-subscribe-cta">
                Subscribe to Stratasphere&trade;
              </button>
            )}
          </div>
        </div>

        <div className="card" data-testid="billing-interval-card">
          <h3>Monthly vs. annual</h3>
          <p>Annual is billed once, up front &mdash; two months free.</p>

          <div className="billing-interval-options">
            <div
              className="billing-interval-option"
              data-selected={subscription.billingInterval === "monthly"}
            >
              <strong>Monthly</strong>
              <span className="card__meta">
                {fmt(calculateBilling(currentCorporation.unitCount, "monthly").total)}
                /mo, billed monthly
              </span>
            </div>
            <div
              className="billing-interval-option"
              data-selected={subscription.billingInterval === "annual"}
            >
              <strong>Annual</strong>
              <span className="card__meta">
                {fmt(calculateBilling(currentCorporation.unitCount, "annual").total)}
                /yr, billed once &mdash; save {fmt(monthlySubtotal * 2)}
              </span>
            </div>
          </div>
        </div>

        <div className="card" data-testid="billing-payment-method-card">
          <h3>Payment method</h3>
          {subscription.paymentMethod ? (
            <>
              <p>
                {subscription.paymentMethod.type === "card" ? "Card" : "Pre-authorized debit (PAD)"}{" "}
                on file: {subscription.paymentMethod.label}.
              </p>
              <button
                className="button button-secondary button-small"
                style={{ alignSelf: "flex-start" }}
                data-testid="update-payment-method-cta"
              >
                Update payment method
              </button>
            </>
          ) : (
            <>
              <p>No payment method on file yet.</p>
              <button
                className="button button-secondary button-small"
                style={{ alignSelf: "flex-start" }}
                data-testid="add-payment-method-cta"
              >
                Add card or PAD
              </button>
            </>
          )}
        </div>
      </div>

      <h2 style={{ margin: "2.5rem 0 1rem" }}>Invoices</h2>
      <div className="card" data-testid="invoices-stripe-card">
        <p>
          Invoices, receipts and payment history are managed by Stripe, not
          duplicated here &mdash; that&rsquo;s the single source of truth for
          what you&rsquo;ve been billed and when.
        </p>
        <a
          href="https://billing.stripe.com/p/login/placeholder"
          target="_blank"
          rel="noopener noreferrer"
          className="button button-secondary"
          style={{ alignSelf: "flex-start" }}
          data-testid="stripe-invoices-link"
        >
          View invoices in Stripe &rarr;
        </a>
      </div>
    </>
  );
}
