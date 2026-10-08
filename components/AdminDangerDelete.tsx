"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteAccount, deleteStrata, previewAccountDelete, previewStrataDelete, type DeletePlanRow } from "@/app/admin/delete-actions";

/**
 * The Super Admin console's deletes (app/admin/delete-actions.ts): first
 * what would go, then a typed confirmation. Used on a strata's console
 * page, and on the Stratas tab for an account.
 */

function Plan({ plan, files }: { plan: DeletePlanRow[]; files: number }) {
  const rows = plan.reduce((n, r) => n + r.rows, 0);
  return (
    <div className="danger-plan" data-testid="delete-plan">
      <p>
        <strong>
          {rows.toLocaleString("en-CA")} {rows === 1 ? "record" : "records"} in {plan.length} {plan.length === 1 ? "table" : "tables"}, and {files.toLocaleString("en-CA")}{" "}
          {files === 1 ? "stored file" : "stored files"}.
        </strong>{" "}
        This can&rsquo;t be undone. Nothing in Stripe changes.
      </p>
      <ul>
        {plan.map((r) => (
          <li key={r.table}>
            {r.table}: {r.rows.toLocaleString("en-CA")}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DeleteStrataCard({ corpId, name }: { corpId: string; name: string }) {
  const router = useRouter();
  const [plan, setPlan] = useState<{ plan: DeletePlanRow[]; files: number } | null>(null);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const preview = () =>
    start(async () => {
      setError(null);
      const r = await previewStrataDelete(corpId);
      if (!r.ok) return setError(r.error);
      setPlan({ plan: r.plan, files: r.files });
    });
  const remove = () =>
    start(async () => {
      setError(null);
      const r = await deleteStrata(corpId, typed);
      if (!r.ok) return setError(r.error);
      router.push(`/admin/stratas?deleted=${encodeURIComponent(corpId)}`);
    });

  return (
    <section className="card danger-card" data-testid="delete-strata">
      <h2>Delete this strata</h2>
      <p className="card__meta">
        Removes {name} from the platform: its roster, members, documents and files, meetings and minutes, decisions,
        conversations and subscription record. People&rsquo;s accounts stay. Cancel any Stripe subscription first.
      </p>
      {!plan ? (
        <button type="button" className="button button-secondary" onClick={preview} disabled={pending} data-testid="delete-strata-preview">
          {pending ? "Checking…" : "Show what would be deleted"}
        </button>
      ) : (
        <>
          <Plan {...plan} />
          <div className="field">
            <label htmlFor="delete-strata-confirm">Type {corpId} to confirm</label>
            <input id="delete-strata-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" data-testid="delete-strata-confirm" />
          </div>
          <div className="role-editor__actions" style={{ justifyContent: "flex-start" }}>
            <button
              type="button"
              className="button button-danger"
              onClick={remove}
              disabled={pending || typed.trim().toUpperCase() !== corpId.toUpperCase()}
              data-testid="delete-strata-go"
            >
              {pending ? "Deleting…" : `Delete ${corpId}`}
            </button>
            <button type="button" className="button button-secondary" onClick={() => (setPlan(null), setTyped(""))} disabled={pending}>
              Cancel
            </button>
          </div>
        </>
      )}
      {error && (
        <p className="form-alert form-alert--error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

export function DeleteAccountCard() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [found, setFound] = useState<{ name: string; email: string; plan: DeletePlanRow[]; files: number } | null>(null);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const preview = () =>
    start(async () => {
      setError(null);
      setDone(null);
      const r = await previewAccountDelete(email);
      if (!r.ok) return setError(r.error);
      setFound({ name: r.name, email: r.email, plan: r.plan, files: r.files });
    });
  const remove = () =>
    start(async () => {
      if (!found) return;
      setError(null);
      const r = await deleteAccount(found.email, typed);
      if (!r.ok) return setError(r.error);
      setDone(`${found.name} (${found.email}) is deleted.`);
      setFound(null);
      setEmail("");
      setTyped("");
      router.refresh();
    });

  return (
    <section className="card danger-card" data-testid="delete-account">
      <h2>Delete an account</h2>
      <p className="card__meta">
        For test or abandoned accounts. Removes the person&rsquo;s sign-in, profile, photo, Council Training progress and
        anything else that&rsquo;s only theirs. An account still in a strata, or with records in one, can&rsquo;t be deleted:
        remove them from it, or delete the strata, first.
      </p>
      {!found ? (
        <form
          className="danger-card__row"
          onSubmit={(e) => {
            e.preventDefault();
            preview();
          }}
        >
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email address"
            aria-label="Email address of the account"
            required
            data-testid="delete-account-email"
          />
          <button type="submit" className="button button-secondary" disabled={pending || !email.trim()} data-testid="delete-account-preview">
            {pending ? "Checking…" : "Show what would be deleted"}
          </button>
        </form>
      ) : (
        <>
          <p>
            <strong>{found.name}</strong> &middot; {found.email}
          </p>
          <Plan plan={found.plan} files={found.files} />
          <div className="field">
            <label htmlFor="delete-account-confirm">Type {found.email} to confirm</label>
            <input id="delete-account-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" data-testid="delete-account-confirm" />
          </div>
          <div className="role-editor__actions" style={{ justifyContent: "flex-start" }}>
            <button
              type="button"
              className="button button-danger"
              onClick={remove}
              disabled={pending || typed.trim().toLowerCase() !== found.email.toLowerCase()}
              data-testid="delete-account-go"
            >
              {pending ? "Deleting…" : "Delete this account"}
            </button>
            <button type="button" className="button button-secondary" onClick={() => (setFound(null), setTyped(""))} disabled={pending}>
              Cancel
            </button>
          </div>
        </>
      )}
      {done && (
        <p className="sync-note" role="status">
          <span>{done}</span>
        </p>
      )}
      {error && (
        <p className="form-alert form-alert--error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
