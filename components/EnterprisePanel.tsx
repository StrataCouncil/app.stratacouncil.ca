"use client";

import { useState, useTransition } from "react";
import { clearEnterprisePrice, closeEnterpriseRequests, setEnterprisePrice } from "@/app/admin/actions";
import { customBilling, planFits } from "@/lib/stripe/prices";

const fmt = (n: number) => n.toLocaleString("en-CA", { style: "currency", currency: "CAD" });
const day = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" });

export interface EnterpriseRequestView {
  id: string;
  reason: "large" | "several";
  message: string;
  who: string;
  createdAt: string;
}

/**
 * Super Admin: Enterprise for one strata (0091). The "Talk to us" requests
 * it sent, and the price agreed with it, which becomes the only plan on its
 * billing page.
 */
export function EnterprisePanel({
  corpId,
  lots,
  price,
  requests,
}: {
  corpId: string;
  lots: number;
  price: { amount: number; interval: "monthly" | "annual"; note: string; setAt: string } | null;
  requests: EnterpriseRequestView[];
}) {
  const [interval, setInterval] = useState<"monthly" | "annual">(price?.interval ?? "annual");
  const [amount, setAmount] = useState(price ? String(price.amount) : "");
  const [note, setNote] = useState(price?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) =>
    startTransition(async () => {
      setError(null);
      setSaved(false);
      const r = await fn();
      if (!r.ok) setError(r.error);
      else setSaved(true);
    });

  const preview = Number(amount) > 0 ? customBilling(Number(amount)) : null;

  return (
    <section className="card stripe-mode" data-testid="enterprise-panel">
      <div className="stripe-mode__head">
        <div>
          <h3>Enterprise</h3>
          <p className="card__meta">
            {price
              ? `${fmt(price.amount)} a month before GST, ${price.interval === "annual" ? "12-month commitment" : "month to month"}, set ${day(price.setAt)}. The strata's billing page offers only this plan.`
              : !planFits(lots, "annual")
                ? `${lots} lots: both plans are over the $3,000 Stripe takes in one payment, so this strata can't subscribe until you set its price.`
                : "Standard plans. Set a price here to replace them for this strata."}
          </p>
        </div>
        <span className={`pill${price ? "" : " pill--locked"}`}>{price ? "Enterprise" : "Standard"}</span>
      </div>

      {requests.length > 0 && (
        <div className="enterprise-requests" data-testid="enterprise-requests">
          <strong>Open requests</strong>
          <ul>
            {requests.map((r) => (
              <li key={r.id}>
                {day(r.createdAt)}, {r.who}: {r.reason === "large" ? "over the self-serve size" : "managing several stratas"}
                {r.message ? <span className="card__meta"> &ldquo;{r.message}&rdquo;</span> : null}
              </li>
            ))}
          </ul>
          <button type="button" className="link-button" disabled={pending} onClick={() => run(() => closeEnterpriseRequests(corpId))}>
            Mark as dealt with
          </button>
        </div>
      )}

      <form
        className="enterprise-form"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => setEnterprisePrice(corpId, interval, Number(amount), note));
        }}
      >
        <label className="field">
          <span>Monthly price before GST</span>
          <input type="number" min="1" max="100000" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required data-testid="enterprise-amount" />
        </label>
        <label className="field">
          <span>Term</span>
          <select value={interval} onChange={(e) => setInterval(e.target.value as "monthly" | "annual")} data-testid="enterprise-interval">
            <option value="annual">12-month commitment</option>
            <option value="monthly">Month to month</option>
          </select>
        </label>
        <label className="field enterprise-form__note">
          <span>Note (only Super Admins see it)</span>
          <input maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. agreed by phone with the manager" />
        </label>
        <div className="enterprise-form__actions">
          {preview && (
            <span className="card__meta">
              {fmt(preview.total)} a month with GST.
            </span>
          )}
          <button type="submit" className="button button-secondary button-small" disabled={pending} data-testid="enterprise-save">
            {price ? "Change price" : "Set price"}
          </button>
          {price && (
            <button type="button" className="button button-secondary button-small" disabled={pending} onClick={() => run(() => clearEnterprisePrice(corpId))}>
              Back to standard plans
            </button>
          )}
        </div>
        {price && <p className="card__meta">A subscription already running keeps the price it started with.</p>}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {saved && !error && (
          <p className="card__meta" role="status">
            Saved.
          </p>
        )}
      </form>
    </section>
  );
}
