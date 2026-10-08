import { DemoLimitButton } from "@/components/DemoLimitButton";
import { StrataSphereNav } from "@/components/StrataSphereNav";
import { COMPANY_LEGAL_NAME, STATEMENT_DESCRIPTOR } from "@/lib/company";
import { MANAGEMENT } from "@/lib/demo-kit/people";
import { calculateBilling } from "@/lib/stripe/prices";

/**
 * The demo site's Billing page (lib/demo.ts): the live page's layout for a
 * strata on the annual plan, paid by pre-authorized debit, with made-up
 * details. Nothing here reaches Stripe; every button opens the sign-up
 * message instead.
 */
export function DemoBilling({
  corpId,
  name,
  address,
  unitCount,
  visitorEmail,
  now = new Date(),
}: {
  corpId: string;
  name: string;
  address: string;
  unitCount: number;
  visitorEmail: string;
  now?: Date;
}) {
  const { subtotal, gst, total } = calculateBilling(unitCount, "annual");
  const fmt = (n: number) => n.toLocaleString("en-CA", { style: "currency", currency: "CAD" });
  const fmtDate = (d: Date) => d.toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

  // Subscribed on the 1st, five months ago; billed on the 1st of each month since.
  const month = (offset: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  const activated = month(-5);
  const nextBilling = month(1);
  const termEnd = month(7);
  const statements = Array.from({ length: 6 }, (_, i) => month(-i)).map((d) => ({
    date: d.toISOString().slice(0, 10),
    description: `Stratasphere™ annual plan, ${unitCount} lots, ${d.toLocaleDateString("en-CA", { month: "long", year: "numeric", timeZone: "UTC" })}`,
    amount: total,
  }));
  const contacts = `${visitorEmail}, ${MANAGEMENT.assistant.email}`;

  return (
    <>
      <StrataSphereNav active="billing" />

      <div className="page-header" style={{ marginBottom: "1.75rem" }}>
        <h2 style={{ margin: 0 }}>Billing for {name}</h2>
        <p className="card__meta" style={{ marginTop: "0.35rem" }}>
          {corpId} &middot; Each strata has its own payment method, billing contacts and subscription &middot; The admin, and
          anyone the admin gives billing access to
        </p>
      </div>

      <p className="sync-note" role="note" style={{ marginBottom: "1.25rem" }} data-testid="demo-billing-note">
        <span>This is how Billing looks for a subscribed strata. The details are made up, and nothing here is charged.</span>
      </p>

      <div className="billing-grid">
        <div className="card" data-testid="billing-payment-method-card">
          <div className="billing-card__head">
            <h3>Payment method</h3>
            <span className="billing-tag billing-tag--ok">Active</span>
          </div>
          <p className="card__meta">
            Charges appear on your statement as {STATEMENT_DESCRIPTOR.toUpperCase()}: StrataCouncil.ca is a product of{" "}
            {COMPANY_LEGAL_NAME.endsWith(".") ? COMPANY_LEGAL_NAME : `${COMPANY_LEGAL_NAME}.`}
          </p>
          <div>
            <strong>Pre-authorized debit ending 4821</strong>
            <p className="card__meta">Canadian bank account on file. Pre-authorized debit is processed each month.</p>
          </div>
          <DemoLimitButton reason="billing" className="button button-secondary button-small billing-card__action">
            Update payment method
          </DemoLimitButton>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <div className="field">
              <label htmlFor="billing-contact-email">Billing contact emails</label>
              <input id="billing-contact-email" type="text" readOnly defaultValue={contacts} />
              <span className="field__hint">
                Separate several addresses with commas. Usually the Treasurer and your strata management company.
              </span>
            </div>
            <DemoLimitButton reason="billing" className="button button-secondary button-small">
              Save billing contacts
            </DemoLimitButton>
          </div>
        </div>

        <div className="card" data-testid="billing-plan-card">
          <div className="billing-card__head">
            <h3>Stratasphere&trade; subscription</h3>
            <span className="billing-tag billing-tag--ok">Active</span>
          </div>
          <p>$82.50/mo base + $2.08/lot/mo, 12-month commitment, {unitCount} lots.</p>
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
          <p className="card__meta">
            Next billing date: {fmtDate(nextBilling)}. Active since {fmtDate(activated)}. Current 12-month term ends{" "}
            {fmtDate(termEnd)}.
          </p>
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            <DemoLimitButton reason="billing" className="button button-secondary">
              Switch to monthly
            </DemoLimitButton>
            <DemoLimitButton reason="billing" className="button button-secondary">
              Cancel subscription
            </DemoLimitButton>
          </div>
          <p className="card__meta" style={{ marginTop: "0.6rem" }}>
            A switch or cancellation takes effect on {fmtDate(termEnd)}, the end of your 12-month term. Until then, billing and
            access continue on the annual plan.
          </p>
        </div>
      </div>

      <div className="card billing-section" data-testid="billing-statements-card">
        <div className="billing-card__head">
          <h3>Account statements</h3>
        </div>
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
                <tr key={s.date}>
                  <td style={{ whiteSpace: "nowrap" }}>{s.date}</td>
                  <td>{s.description}</td>
                  <td>Paid</td>
                  <td style={{ textAlign: "right", fontWeight: 600 }}>{fmt(s.amount)}</td>
                  <td>
                    <DemoLimitButton reason="billing" className="button button-secondary button-small">
                      Receipt
                    </DemoLimitButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card billing-section" data-testid="billing-corporations-card">
        <h3>Admin Stratas</h3>
        <p className="card__meta" style={{ margin: "0 0 0.75rem" }}>
          Open another strata to manage its own billing. The one you&rsquo;re viewing is highlighted.
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
              <tr data-current="true" className="billing-row--current">
                <td>
                  <strong>{corpId}</strong>
                  <div className="roster-table__meta">{name}</div>
                </td>
                <td>{address || "—"}</td>
                <td data-center="true">{unitCount}</td>
                <td>
                  <span className="billing-tag billing-tag--ok">Active</span>
                </td>
                <td style={{ whiteSpace: "nowrap" }}>{activated.toISOString().slice(0, 10)}</td>
                <td style={{ textAlign: "right", fontWeight: 600 }}>{fmt(subtotal)}/mo</td>
              </tr>
              <tr className="billing-total-row">
                <td colSpan={5} style={{ textAlign: "right" }}>
                  Total monthly subscription (before GST)
                </td>
                <td style={{ textAlign: "right" }}>{fmt(subtotal)}/mo</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
