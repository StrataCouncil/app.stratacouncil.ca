"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/Modal";
import { jurisdictions } from "@/lib/strata";
import { MONTHS, detailChanges, detailsProblem, type DetailChange, type StrataDetails } from "@/lib/strata-details";
import { updateStrataDetails } from "@/app/strata/[corpId]/details-actions";

/**
 * "Edit details" on the Overview's Strata details card. Shown only to the
 * strata's Admin and to Super Admins (the page decides). Two steps: the
 * form, then "Are you sure you want to change this?" listing each change
 * from and to, before anything is saved.
 */
export function StrataDetailsEditor({ corpId, details, superAdmin }: { corpId: string; details: StrataDetails; superAdmin: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<StrataDetails>(details);
  const [confirming, setConfirming] = useState<DetailChange[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const close = () => {
    setOpen(false);
    setConfirming(null);
    setError(null);
  };
  const begin = () => {
    setForm(details);
    setConfirming(null);
    setError(null);
    setOpen(true);
  };
  const review = (e: React.FormEvent) => {
    e.preventDefault();
    const problem = detailsProblem(form, superAdmin);
    if (problem) return setError(problem);
    const { changes } = detailChanges(details, form, superAdmin);
    if (!changes.length) return setError("Nothing has changed.");
    setError(null);
    setConfirming(changes);
  };
  const save = () =>
    start(async () => {
      const r = await updateStrataDetails(corpId, details, form);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      close();
      router.refresh();
    });

  const set = <K extends keyof StrataDetails>(key: K, value: StrataDetails[K]) => setForm((f) => ({ ...f, [key]: value }));

  return (
    <>
      <button type="button" className="link-button" onClick={begin} data-testid="strata-details-edit">
        Edit details
      </button>
      {open && (
        <Modal
          title={confirming ? "Are you sure you want to change this?" : "Edit strata details"}
          onClose={close}
          closeOnBackdrop={false}
          testId="strata-details-dialog"
        >
          {confirming ? (
            <>
              <ul className="details-changes" data-testid="strata-details-changes">
                {confirming.map((c) => (
                  <li key={c.field}>
                    <strong>{c.label}</strong>
                    <span>
                      {c.from} <span aria-hidden="true">&rarr;</span>
                      <span className="visually-hidden"> becomes </span> {c.to}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="card__meta">
                Everyone on the strata sees the new details, and Stratasphere uses them.
                {confirming.some((c) => c.field === "unitCount") &&
                  " A subscription that's already running keeps the number of lots it started with: change its quantity in Stripe."}{" "}
                The change is recorded with your name and the time.
              </p>
              {error && (
                <p className="form-alert" role="alert">
                  {error}
                </p>
              )}
              <div className="role-editor__actions">
                <button type="button" className="button button-secondary" onClick={() => setConfirming(null)} disabled={pending}>
                  Go back
                </button>
                <button type="button" className="button button-primary" onClick={save} disabled={pending} data-testid="strata-details-confirm">
                  {pending ? "Saving…" : "Yes, change it"}
                </button>
              </div>
            </>
          ) : (
            <form onSubmit={review}>
              <p className="card__meta" style={{ marginBottom: "1rem" }}>
                {superAdmin
                  ? `Plan number ${corpId}. The plan number can't be changed here.`
                  : "The plan number, legal name, jurisdiction, and number of lots are set by StrataCouncil.ca. Ask us if one needs correcting."}
              </p>
              <label className="field">
                <span>Building name (optional)</span>
                <input
                  value={form.buildingName ?? ""}
                  maxLength={120}
                  onChange={(e) => set("buildingName", e.target.value)}
                  placeholder="e.g. The Larches"
                  data-testid="details-building"
                />
              </label>
              <label className="field">
                <span>Address</span>
                <input value={form.address} maxLength={300} onChange={(e) => set("address", e.target.value)} required data-testid="details-address" />
              </label>
              <label className="field">
                <span>Fiscal year starts</span>
                <select
                  value={form.fiscalYearStartMonth ?? ""}
                  onChange={(e) => set("fiscalYearStartMonth", e.target.value ? Number(e.target.value) : null)}
                  data-testid="details-fiscal"
                >
                  <option value="">Not set</option>
                  {MONTHS.map((m, i) => (
                    <option key={m} value={i + 1}>
                      {m} 1
                    </option>
                  ))}
                </select>
                <span className="field__hint">From the financial statements or the budget. Stratasphere uses it for anything about &ldquo;this fiscal year&rdquo;.</span>
              </label>
              {superAdmin && (
                <fieldset className="details-super" data-testid="details-super">
                  <legend>Super Admin only</legend>
                  <label className="field">
                    <span>Legal name</span>
                    <input value={form.legalName} maxLength={200} onChange={(e) => set("legalName", e.target.value)} required data-testid="details-legal" />
                  </label>
                  <label className="field">
                    <span>Jurisdiction</span>
                    <select value={form.jurisdiction} onChange={(e) => set("jurisdiction", e.target.value)} data-testid="details-jurisdiction">
                      {jurisdictions.map((j) => (
                        <option key={j.code} value={j.code}>
                          {j.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Number of strata lots</span>
                    <input
                      type="number"
                      min={1}
                      max={10000}
                      value={Number.isFinite(form.unitCount) ? form.unitCount : ""}
                      onChange={(e) => set("unitCount", e.target.value === "" ? NaN : Number(e.target.value))}
                      required
                      data-testid="details-lots"
                    />
                  </label>
                </fieldset>
              )}
              {error && (
                <p className="form-alert" role="alert">
                  {error}
                </p>
              )}
              <div className="role-editor__actions">
                <button type="button" className="button button-secondary" onClick={close}>
                  Cancel
                </button>
                <button type="submit" className="button button-primary" data-testid="strata-details-review">
                  Review changes
                </button>
              </div>
            </form>
          )}
        </Modal>
      )}
    </>
  );
}
