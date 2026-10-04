import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isStrataAdmin } from "@/lib/auth/strata-admin";
import { getStripe, stripeModeFor, type StripeMode } from "@/lib/stripe/client";
import { annualTermEnd, calculateBilling } from "@/lib/stripe/prices";
import { StatementsPeriodSelect } from "@/components/StatementsPeriodSelect";
import { BillingDialog } from "@/components/BillingDialog";
import { AutoRefresh } from "@/components/AutoRefresh";
import { STRATASPHERE_PITCH, STRATASPHERE_TITLE } from "@/components/StratasphereValue";
import type { BillingAddress } from "@/lib/billing-address";
import { BillingSteps, type BillingStep } from "@/components/BillingSteps";
import { COMPANY_LEGAL_NAME, STATEMENT_DESCRIPTOR } from "@/lib/company";
import {
  changePlan,
  cancelSubscription,
  keepCurrentPlan,
  openBillingPortal,
  updateBillingEmail,
} from "./actions";

/**
 * Billing — admin-only (doc01 §7 item 7: subscribing is admin-gated, no
 * exception, same pattern as meeting creation). Non-admins never see any
 * billing information: they are sent back to Council & Roles.
 *
 * Layout: payment method and subscription side by side, then Account
 * Statements (invoices from Stripe for a chosen period), then every strata
 * this user administers with its monthly cost and the total. Not part of the
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
type StatementRow = {
  id: string;
  date: string;
  description: string;
  amount: number;
  status: string;
  receiptUrl: string | null;
};

/** Unix-second bounds for a statements period: all, ytd, 12, or YYYY-MM. */
function periodBounds(period: string): { gte?: number; lt?: number } | null {
  const now = new Date();
  const ts = (d: Date) => Math.floor(d.getTime() / 1000);
  if (period === "all") return {};
  if (period === "ytd") return { gte: ts(new Date(now.getFullYear(), 0, 1)) };
  if (period === "12") return { gte: ts(new Date(now.getFullYear(), now.getMonth() - 11, 1)) };
  const m = period.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  return { gte: ts(new Date(year, month, 1)), lt: ts(new Date(year, month + 1, 1)) };
}

async function loadStatements(mode: StripeMode, customerId: string, period: string): Promise<StatementRow[] | "error"> {
  const bounds = periodBounds(period);
  if (!bounds) return [];
  try {
    const invoices = await getStripe(mode).invoices.list({
      customer: customerId,
      limit: 100,
      created: { ...(bounds.gte ? { gte: bounds.gte } : {}), ...(bounds.lt ? { lt: bounds.lt } : {}) },
    });
    return invoices.data
      .filter((inv) => inv.status !== "draft")
      .map((inv) => ({
        id: inv.id ?? inv.number ?? String(inv.created),
        date: new Date(inv.created * 1000).toLocaleDateString("en-CA"),
        description: inv.lines.data[0]?.description ?? "Stratasphere™ subscription",
        amount: (inv.status === "paid" ? inv.amount_paid : inv.amount_due) / 100,
        status: inv.status ?? "open",
        receiptUrl: inv.invoice_pdf ?? inv.hosted_invoice_url ?? null,
      }));
  } catch (error) {
    console.error("billing/page: failed to load invoices:", error);
    return "error";
  }
}

export default async function BillingPage({
  params,
  searchParams,
}: {
  params: Promise<{ corpId: string }>;
  searchParams: Promise<{ period?: string; plan?: string; step?: string; note?: string; subscribed?: string }>;
}) {
  const { corpId } = await params;
  const { period: rawPeriod, plan: rawPlan, step: rawStep, note, subscribed: justSubscribed } = await searchParams;
  const chosenPlan = rawPlan === "monthly" ? "monthly" : "annual";
  // A step in the address opens the subscribe dialog (2026-10-05).
  const dialogOpen = (["plan", "payment", "contact", "review"] as const).includes(rawStep as BillingStep);
  const step: BillingStep = dialogOpen ? (rawStep as BillingStep) : "plan";
  const period = rawPeriod && periodBounds(rawPeriod) ? rawPeriod : null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: adminRows } = await supabase
    .from("corporation_role_assignments")
    .select("corporation_id")
    .eq("user_id", user.id)
    .eq("role", "admin");
  const adminCorpIds = (adminRows ?? []).map((r) => r.corporation_id as string);
  // No billing information at all for anyone who isn't this strata's admin.
  // A Super Admin is admin of every strata (0021).
  if (!adminCorpIds.includes(corpId)) {
    if (!(await isStrataAdmin(supabase, corpId))) redirect(`/strata/${corpId}`);
    adminCorpIds.push(corpId);
  }

  const admin = createAdminClient();
  const [{ data: corps }, { data: subs }] = await Promise.all([
    admin
      .from("strata_corporations")
      .select("strata_plan_number, building_name, legal_name, address, unit_count")
      .in("strata_plan_number", adminCorpIds),
    admin.from("subscriptions").select("*").in("corporation_id", adminCorpIds),
  ]);

  const corp = (corps ?? []).find((c) => c.strata_plan_number === corpId);
  if (!corp) redirect(`/strata/${corpId}`);
  const sub = (subs ?? []).find((s) => s.corporation_id === corpId) ?? null;

  // Sandbox stratas bill through Stripe test mode (0029).
  const stripeMode = await stripeModeFor(corpId);
  const subscribed = sub?.status === "active";
  // A first payment Stripe is still processing (usually a pre-authorized
  // debit, a few business days): neither subscribed nor not (0030).
  const pending = !subscribed && Boolean(sub?.stripe_subscription_id) && sub?.stripe_status === "incomplete";
  const deactivated = sub?.status === "deactivated" && Boolean(sub.activated_at);
  const interval = (sub?.billing_interval as "monthly" | "annual" | undefined) ?? "monthly";
  const unitCount = corp.unit_count;
  const { subtotal, gst, total } = calculateBilling(unitCount, interval);
  const billingEmail = sub?.billing_email ?? "";

  // A real card/PAD label needs a live Stripe read — acceptable here
  // since this is a low-traffic, admin-only page, not a hot path.
  let paymentMethod: { label: string; detail: string } | null = null;
  if (sub?.stripe_customer_id) {
    try {
      // The customer's default method (set in billing step 2), else the first on file.
      const stripe = getStripe(stripeMode);
      const customer = await stripe.customers.retrieve(sub.stripe_customer_id, {
        expand: ["invoice_settings.default_payment_method"],
      });
      const fallback = await stripe.paymentMethods.list({ customer: sub.stripe_customer_id, limit: 1 });
      const def =
        !customer.deleted && typeof customer.invoice_settings?.default_payment_method === "object"
          ? customer.invoice_settings.default_payment_method
          : null;
      const pm = def ?? fallback.data[0];
      if (pm?.card) {
        paymentMethod = {
          label: `${pm.card.brand.replace(/^\w/, (c) => c.toUpperCase())} ending ${pm.card.last4}`,
          detail: "Credit card on file. Charges are processed automatically each month.",
        };
      } else if (pm?.acss_debit) {
        paymentMethod = {
          label: `Pre-authorized debit ending ${pm.acss_debit.last4}`,
          detail: "Canadian bank account on file. Pre-authorized debit is processed each month.",
        };
      }
    } catch (error) {
      console.error("billing/page: failed to load payment method:", error);
    }
  }

  const statements =
    period && sub?.stripe_customer_id ? await loadStatements(stripeMode, sub.stripe_customer_id, period) : null;

  // Switches and cancellations take effect on the next anniversary: the
  // end of the running 12-month term on annual, the next billing date on
  // monthly.
  const termEnd = interval === "annual" && sub ? annualTermEnd(sub)?.toISOString() ?? null : null;
  const nextAnniversary = interval === "annual" ? termEnd : sub?.current_period_end ?? null;
  const pendingInterval = (sub?.pending_interval as "monthly" | "annual" | null | undefined) ?? null;
  const otherInterval = interval === "annual" ? "monthly" : "annual";

  const fmt = (n: number) => n.toLocaleString("en-CA", { style: "currency", currency: "CAD" });
  const fmtDate = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" })
      : null;

  const subsByCorp = new Map((subs ?? []).map((s) => [s.corporation_id as string, s]));
  const corpRows = [...(corps ?? [])]
    .sort((a, b) => a.strata_plan_number.localeCompare(b.strata_plan_number))
    .map((c) => {
      const s = subsByCorp.get(c.strata_plan_number);
      const active = s?.status === "active";
      const cPending = !active && Boolean(s?.stripe_subscription_id) && s?.stripe_status === "incomplete";
      const cInterval = (s?.billing_interval as "monthly" | "annual" | undefined) ?? "monthly";
      return {
        id: c.strata_plan_number as string,
        name: (c.building_name ?? c.legal_name) as string,
        address: c.address as string,
        lots: c.unit_count as number,
        status: active ? "Active" : cPending ? "Pending" : s?.status === "deactivated" && s.activated_at ? "Deactivated" : "Not subscribed",
        activated: active && s?.activated_at ? (s.activated_at as string).slice(0, 10) : null,
        monthly: active ? calculateBilling(c.unit_count, cInterval).subtotal : null,
      };
    });
  const totalMonthly = corpRows.reduce((sum, r) => sum + (r.monthly ?? 0), 0);

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
        <h2 style={{ margin: 0 }}>Billing for {corp.building_name ?? corp.legal_name}</h2>
        <p className="card__meta" style={{ marginTop: "0.35rem" }}>
          {corpId} &middot; Each strata has its own payment method, billing contacts and subscription &middot; Admin only
        </p>
      </div>

      {note === "contacts-saved" && (
        <p className="sync-note" role="status" style={{ marginBottom: "1.25rem" }} data-testid="billing-contacts-saved">
          Billing contacts saved for {corp.building_name ?? corp.legal_name}.
        </p>
      )}

      {(pending || (justSubscribed && !subscribed)) && <AutoRefresh seconds={5} />}

      {justSubscribed && subscribed && (
        <div className="billing-outcome billing-outcome--ok" role="status" data-testid="billing-subscribed">
          <strong>You&rsquo;re subscribed.</strong>
          <p>
            Stratasphere&trade; is on for {corp.building_name ?? corp.legal_name}. A receipt is on its way to{" "}
            {billingEmail.split(",")[0]}.
          </p>
        </div>
      )}

      {!subscribed && (pending || justSubscribed) && (
        <div className="billing-outcome billing-outcome--pending" role="status" data-testid="billing-pending">
          <strong>Payment processing</strong>
          <p>
            {paymentMethod?.label.startsWith("Pre-authorized")
              ? "Pre-authorized debits take a few business days to clear. "
              : "Stripe is confirming the payment. "}
            Stratasphere&trade; switches on by itself as soon as it&rsquo;s confirmed, and a receipt goes to{" "}
            {billingEmail.split(",")[0] || "your billing contact"}. There&rsquo;s nothing more to do.
          </p>
        </div>
      )}

      {!subscribed && !pending && !justSubscribed && (
        <div className="card billing-subscribe" data-testid="billing-subscribe">
          <h3>{STRATASPHERE_TITLE}</h3>
          <p>{STRATASPHERE_PITCH}</p>
          <p className="card__meta">
            From {fmt(calculateBilling(unitCount, "annual").total)} a month incl. GST for {unitCount} lots.{" "}
            {deactivated ? "Your strata's records are all still here." : "Every strata's first meeting is free."}
          </p>
          <Link href={`/strata/${corpId}/billing?step=plan`} className="button button-primary" data-testid="open-subscribe">
            Subscribe
          </Link>
        </div>
      )}

      {dialogOpen && !subscribed && !pending && (
        <BillingDialog closeHref={`/strata/${corpId}/billing`}>
          <BillingSteps
            corpId={corpId}
            unitCount={unitCount}
            interval={chosenPlan}
            step={step}
            paymentMethod={paymentMethod}
            billingEmail={billingEmail}
            billingAddress={(sub?.billing_address as BillingAddress | null) ?? null}
            addressSame={sub?.billing_address_same ?? true}
            civicAddress={corp.address ?? ""}
            verifying={note === "verifying"}
          />
        </BillingDialog>
      )}

      {subscribed && (
      <div className="billing-grid">
        <div className="card" data-testid="billing-payment-method-card">
          <div className="billing-card__head">
            <h3>Payment method</h3>
            <span className={`billing-tag ${paymentMethod ? "billing-tag--ok" : "billing-tag--warn"}`}>
              {paymentMethod ? "Active" : "Not set up"}
            </span>
          </div>
          <p className="card__meta">
            Charges appear on your statement as {STATEMENT_DESCRIPTOR.toUpperCase()}: StrataCouncil.ca is a product of{" "}
            {COMPANY_LEGAL_NAME}.
          </p>
          {paymentMethod ? (
            <>
              <div>
                <strong>{paymentMethod.label}</strong>
                <p className="card__meta">{paymentMethod.detail}</p>
              </div>
              <form action={openBillingPortal.bind(null, corpId)}>
                <button className="button button-secondary button-small" data-testid="update-payment-method-cta">
                  Update payment method
                </button>
              </form>
            </>
          ) : sub?.stripe_customer_id ? (
            <>
              <p>No payment method on file yet.</p>
              <form action={openBillingPortal.bind(null, corpId)}>
                <button className="button button-secondary button-small" data-testid="add-payment-method-cta">
                  Add card or pre-authorized debit
                </button>
              </form>
            </>
          ) : (
            <p className="card__meta">
              You&rsquo;ll add a pre-authorized debit (recommended, Canadian bank account) or a
              credit card when you subscribe. Stripe handles the details; nothing is stored here.
            </p>
          )}

          {(subscribed || deactivated) && (
            <form
              action={updateBillingEmail.bind(null, corpId)}
              style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
            >
              <div className="field">
                <label htmlFor="billing-contact-email">Billing contact emails</label>
                <input
                  id="billing-contact-email"
                  name="billingEmail"
                  type="text"
                  inputMode="email"
                  required
                  defaultValue={billingEmail}
                  placeholder="Receipts and billing notices are sent here"
                  data-testid="billing-contact-email-input"
                />
                <span className="field__hint">
                  Separate several addresses with commas. Usually the Treasurer and your strata management company.
                </span>
              </div>
              <button
                className="button button-secondary button-small"
                style={{ alignSelf: "flex-start" }}
                data-testid="update-billing-email-cta"
              >
                Save billing contacts
              </button>
            </form>
          )}
        </div>

        <div className="card" data-testid="billing-plan-card">
          <div className="billing-card__head">
            <h3>Stratasphere&trade; subscription</h3>
            <span
              className={`billing-tag ${subscribed ? "billing-tag--ok" : deactivated ? "billing-tag--off" : "billing-tag--warn"}`}
            >
              {subscribed ? "Active" : deactivated ? "Deactivated" : "Not subscribed"}
            </span>
          </div>
          <p>
            {interval === "annual" ? "$82.50/mo base + $2.08/lot/mo" : "$99/mo base + $2.49/lot/mo"}
            {interval === "annual" ? ", 12-month commitment" : ", cancel any month"}, {unitCount} lots.
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
              {termEnd && !sub?.cancel_at ? ` Current 12-month term ends ${fmtDate(termEnd)}.` : null}
            </p>
          ) : deactivated ? (
            <p className="card__meta">
              Deactivated{sub?.cancel_at ? ` since ${fmtDate(sub.cancel_at)}` : ""}. Documents and
              guides stay free and fully available — Meeting Mode and the Stratasphere&trade;
              assistant need an active subscription.
            </p>
          ) : (
            <p className="card__meta">
              The document repository, guides and roster are free. A subscription unlocks Meeting
              Mode and the Stratasphere&trade; assistant.
            </p>
          )}

          {subscribed && pendingInterval && (
            <div className="billing-pending" data-testid="pending-plan-switch">
              <p>
                <strong>Switching to {pendingInterval} on {fmtDate(sub?.pending_interval_at ?? null)}.</strong>{" "}
                {interval === "annual"
                  ? "Until then, the annual rate and 12-month commitment continue."
                  : "Until then, the monthly rate continues. The 12-month term starts on that date."}
              </p>
              <form action={keepCurrentPlan.bind(null, corpId)}>
                <button className="button button-secondary button-small" data-testid="keep-plan-cta">
                  Keep {interval}
                </button>
              </form>
            </div>
          )}

          {subscribed && !sub?.cancel_at && (
            <>
              <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                {!pendingInterval && (
                  <form action={changePlan.bind(null, corpId, otherInterval)}>
                    <button className="button button-secondary" data-testid="change-plan-cta">
                      Switch to {otherInterval}
                    </button>
                  </form>
                )}
                <form action={cancelSubscription.bind(null, corpId)}>
                  <button className="button button-secondary" data-testid="cancel-subscription-cta">
                    Cancel subscription
                  </button>
                </form>
              </div>
              {nextAnniversary && (
                <p className="card__meta" style={{ marginTop: "0.6rem" }}>
                  {interval === "annual"
                    ? `A switch or cancellation takes effect on ${fmtDate(nextAnniversary)}, the end of your 12-month term. Until then, billing and access continue on the annual plan.`
                    : `A switch to annual takes effect on ${fmtDate(nextAnniversary)}, your next billing date, and starts a 12-month term. A cancellation ends the subscription on that date.`}
                  {pendingInterval ? " Cancelling also drops the scheduled switch." : ""}
                </p>
              )}
            </>
          )}

        </div>
      </div>

      )}

      <div className="card billing-section" data-testid="billing-statements-card">
        <div className="billing-card__head">
          <h3>Account statements</h3>
          {sub?.stripe_customer_id && <StatementsPeriodSelect value={period} />}
        </div>
        {!sub?.stripe_customer_id ? (
          <p className="card__meta">No billing account yet. Statements appear here once you subscribe.</p>
        ) : !period ? (
          <p className="card__meta">Select a period to view statements.</p>
        ) : statements === "error" ? (
          <p className="card__meta">Could not load statements. Please try again.</p>
        ) : !statements || statements.length === 0 ? (
          <p className="card__meta">No statements found for the selected period.</p>
        ) : (
          <div className="roster-table-wrap">
            <table className="roster-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Status</th>
                  <th style={{ textAlign: "right" }}>Amount</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {statements.map((s) => (
                  <tr key={s.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{s.date}</td>
                    <td>{s.description}</td>
                    <td style={{ textTransform: "capitalize" }}>{s.status}</td>
                    <td style={{ textAlign: "right", fontWeight: 600 }}>{fmt(s.amount)}</td>
                    <td>
                      {s.receiptUrl && (
                        <a href={s.receiptUrl} target="_blank" rel="noreferrer" className="button button-secondary button-small">
                          Receipt
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card billing-section" data-testid="billing-corporations-card">
        <h3>Admin Stratas</h3>
        <p className="card__meta" style={{ margin: "0 0 0.75rem" }}>
          Open a strata to manage its own billing. The one you&rsquo;re viewing is highlighted.
        </p>
        <div className="roster-table-wrap">
          <table className="roster-table">
            <thead>
              <tr>
                <th>Strata corporation</th>
                <th>Address</th>
                <th data-center="true">Lots</th>
                <th>Status</th>
                <th>Activated</th>
                <th style={{ textAlign: "right" }}>Monthly cost</th>
              </tr>
            </thead>
            <tbody>
              {corpRows.map((r) => (
                <tr key={r.id} data-current={r.id === corpId ? "true" : undefined} className={r.id === corpId ? "billing-row--current" : undefined}>
                  <td>
                    <Link href={`/strata/${r.id}/billing`} style={{ fontWeight: 600 }}>
                      {r.id}
                    </Link>
                    <div className="roster-table__meta">{r.name}</div>
                  </td>
                  <td>{r.address || "—"}</td>
                  <td data-center="true">{r.lots}</td>
                  <td>
                    <span
                      className={`billing-tag ${r.status === "Active" ? "billing-tag--ok" : r.status === "Deactivated" ? "billing-tag--off" : r.status === "Pending" ? "billing-tag--pending" : "billing-tag--warn"}`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>{r.activated ?? "—"}</td>
                  <td style={{ textAlign: "right", fontWeight: 600 }}>
                    {r.monthly !== null ? `${fmt(r.monthly)}/mo` : "—"}
                  </td>
                </tr>
              ))}
              <tr className="billing-total-row">
                <td colSpan={5} style={{ textAlign: "right" }}>
                  Total monthly subscription (before GST)
                </td>
                <td style={{ textAlign: "right" }}>{fmt(totalMonthly)}/mo</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
