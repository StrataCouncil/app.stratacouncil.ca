import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe/client";
import { calculateBilling } from "@/lib/stripe/prices";
import { startCheckout, changePlan, cancelSubscription, openBillingPortal } from "./actions";

/**
 * Billing — admin-only (doc01 §7 item 7: subscribing is admin-gated, no
 * exception, same pattern as meeting creation). Not part of the
 * Stratasphere™ sub-nav (`StrataSphereNav`) since it isn't a content tab
 * every connected member should land on — it's reached from the "Admin"
 * entry point on Council & Roles instead. The parent layout
 * (`../layout.tsx`) already supplies the corp identity header and the
 * wrap/page shell, so this only renders its own content.
 *
 * Wired to real data (doc04 §7a-style server-only mutation path — see
 * ./actions.ts) rather than lib/placeholder-data.ts's mock subscription.
 * corpId is read from the URL and used directly, rather than always
 * rendering `currentCorporation`, since a real signed-in admin could be
 * viewing any strata they administer.
 */
export default async function BillingPage({
  params,
}: {
  params: Promise<{ corpId: string }>;
}) {
  const { corpId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const [{ data: corp }, { data: sub }, { data: roleRow }] = await Promise.all([
    admin
      .from("strata_corporations")
      .select("strata_plan_number, unit_count")
      .eq("strata_plan_number", corpId)
      .single(),
    admin.from("subscriptions").select("*").eq("corporation_id", corpId).maybeSingle(),
    supabase
      .from("corporation_role_assignments")
      .select("role")
      .eq("corporation_id", corpId)
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle(),
  ]);

  if (!corp) redirect(`/strata/${corpId}`);
  const isAdmin = Boolean(roleRow);

  const subscribed = sub?.status === "active";
  const deactivated = sub?.status === "deactivated" && Boolean(sub.activated_at);
  const interval = (sub?.billing_interval as "monthly" | "annual" | undefined) ?? "monthly";
  const unitCount = corp.unit_count;
  const { subtotal, gst, total } = calculateBilling(unitCount, interval);

  // A real card/PAD label needs a live Stripe read — acceptable here
  // since this is a low-traffic, admin-only page, not a hot path.
  let paymentMethodLabel: string | null = null;
  if (sub?.stripe_customer_id) {
    try {
      const pms = await getStripe().paymentMethods.list({
        customer: sub.stripe_customer_id,
        limit: 1,
      });
      const pm = pms.data[0];
      if (pm?.card) {
        paymentMethodLabel = `${pm.card.brand.replace(/^\w/, (c) => c.toUpperCase())} ending ${pm.card.last4}`;
      } else if (pm?.acss_debit) {
        paymentMethodLabel = `Pre-authorized debit ending ${pm.acss_debit.last4}`;
      }
    } catch (error) {
      console.error("billing/page: failed to load payment method:", error);
    }
  }

  const fmt = (n: number) =>
    n.toLocaleString("en-CA", { style: "currency", currency: "CAD" });
  const fmtDate = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleDateString("en-CA", {
          year: "numeric",
          month: "long",
          day: "numeric",
        })
      : null;

  return (
    <>
      <Link
        href={`/strata/${corpId}`}
        className="button button-secondary button-small"
        style={{ marginBottom: "1.5rem" }}
      >
        &larr; Back to Council &amp; Roles
      </Link>

      <div className="page-header" style={{ marginBottom: "1.75rem" }}>
        <span className="pill">Admin</span>
        <h2 style={{ margin: "0.6rem 0 0" }}>Billing &amp; subscription</h2>
      </div>

      {!isAdmin && (
        <div className="card" style={{ marginBottom: "1.5rem" }} data-testid="billing-not-admin-notice">
          <p>Only a corporation admin can manage billing. You can see the current plan below.</p>
        </div>
      )}

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
            {interval === "annual" ? "$82.50/mo base + $2.08/unit/mo" : "$99/mo base + $2.49/unit/mo"}
            , billed monthly {interval === "annual" ? "(annual commitment)" : ""}, {unitCount} units.
          </p>

          {(subscribed || deactivated) && (
            <div className="billing-lines">
              <div className="billing-line billing-line--subtotal">
                <span>Subtotal</span>
                <span>{fmt(subtotal)}/mo</span>
              </div>
              <div className="billing-line">
                <span>GST (5%)</span>
                <span>{fmt(gst)}</span>
              </div>
              <div className="billing-line billing-line--total">
                <span>Total / month</span>
                <span>{fmt(total)}</span>
              </div>
            </div>
          )}

          {subscribed ? (
            <p className="card__meta">
              {sub?.cancel_at
                ? `Cancels on ${fmtDate(sub.cancel_at)} — access and billing continue until then.`
                : sub?.current_period_end
                  ? `Next billing date: ${fmtDate(sub.current_period_end)}.`
                  : null}{" "}
              {sub?.activated_at ? `Active since ${fmtDate(sub.activated_at)}.` : null}
            </p>
          ) : deactivated ? (
            <p className="card__meta">
              Deactivated{sub?.cancel_at ? ` since ${fmtDate(sub.cancel_at)}` : ""}. Documents and
              guides stay free and fully available — Meeting Mode and the Stratasphere&trade;
              assistant need an active subscription.
            </p>
          ) : (
            <p className="card__meta">
              No payment required to create or run your strata &mdash; the document repository,
              guides and roster stay free forever. A subscription unlocks Meeting Mode and the
              Stratasphere&trade; assistant.
            </p>
          )}

          {isAdmin && (
            <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
              {subscribed ? (
                <>
                  <form action={changePlan.bind(null, corpId, interval === "annual" ? "monthly" : "annual")}>
                    <button className="button button-secondary" data-testid="change-plan-cta">
                      Switch to {interval === "annual" ? "monthly" : "annual"}
                    </button>
                  </form>
                  {!sub?.cancel_at && (
                    <form action={cancelSubscription.bind(null, corpId)}>
                      <button className="button button-secondary" data-testid="cancel-subscription-cta">
                        Cancel subscription
                      </button>
                    </form>
                  )}
                </>
              ) : (
                <>
                  <form action={startCheckout.bind(null, corpId, "monthly")}>
                    <button className="button button-primary" data-testid="billing-subscribe-cta">
                      Subscribe &mdash; monthly
                    </button>
                  </form>
                  <form action={startCheckout.bind(null, corpId, "annual")}>
                    <button className="button button-secondary" data-testid="billing-subscribe-annual-cta">
                      Subscribe &mdash; annual
                    </button>
                  </form>
                </>
              )}
            </div>
          )}
        </div>

        <div className="card" data-testid="billing-interval-card">
          <h3>Monthly vs. annual</h3>
          <p>
            Both bill monthly &mdash; annual just locks in a lower rate for a 12-month
            commitment, the way most software subscriptions work. No up-front lump sum,
            no early-termination fee: cancel any time and it runs out the term you&rsquo;re
            already in, then stops renewing.
          </p>

          <div className="billing-interval-options">
            <div className="billing-interval-option" data-selected={interval === "monthly"}>
              <strong>Monthly</strong>
              <span className="card__meta">
                {fmt(calculateBilling(unitCount, "monthly").total)}/mo, cancel any monthly
                anniversary
              </span>
            </div>
            <div className="billing-interval-option" data-selected={interval === "annual"}>
              <strong>Annual</strong>
              <span className="card__meta">
                {fmt(calculateBilling(unitCount, "annual").total)}/mo, 12-month commitment
              </span>
            </div>
          </div>
        </div>

        <div className="card" data-testid="billing-payment-method-card">
          <h3>Payment method</h3>
          {paymentMethodLabel ? (
            <>
              <p>On file: {paymentMethodLabel}.</p>
              {isAdmin && (
                <form action={openBillingPortal.bind(null, corpId)}>
                  <button
                    className="button button-secondary button-small"
                    style={{ alignSelf: "flex-start" }}
                    data-testid="update-payment-method-cta"
                  >
                    Update payment method
                  </button>
                </form>
              )}
            </>
          ) : (
            <>
              <p>No payment method on file yet.</p>
              {isAdmin && sub?.stripe_customer_id && (
                <form action={openBillingPortal.bind(null, corpId)}>
                  <button
                    className="button button-secondary button-small"
                    style={{ alignSelf: "flex-start" }}
                    data-testid="add-payment-method-cta"
                  >
                    Add card or PAD
                  </button>
                </form>
              )}
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
        {isAdmin && sub?.stripe_customer_id ? (
          <form action={openBillingPortal.bind(null, corpId)}>
            <button
              className="button button-secondary"
              style={{ alignSelf: "flex-start" }}
              data-testid="stripe-invoices-link"
            >
              View invoices in Stripe &rarr;
            </button>
          </form>
        ) : (
          <p className="card__meta">Available once a subscription has been created.</p>
        )}
      </div>
    </>
  );
}
