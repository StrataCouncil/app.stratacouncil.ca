"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createLibraryItem } from "@/app/admin/library/actions";
import { LIBRARY_KINDS } from "@/lib/library/library";
import { knowledgeResourceKindLabels, type KnowledgeResourceKind } from "@/lib/placeholder-data";

/** Starts a Library item and opens its editor. */
export function NewLibraryItem() {
  const router = useRouter();
  const [kind, setKind] = useState<KnowledgeResourceKind>("emergency_playbook");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    const r = await createLibraryItem(kind);
    if (!r.ok) {
      setBusy(false);
      return setError(r.error);
    }
    router.push(`/admin/library/${r.id}`);
  }

  return (
    <div className="be-row" data-testid="library-new">
      <label className="be-row">
        <span className="card__meta">New</span>
        <select value={kind} onChange={(e) => setKind(e.target.value as KnowledgeResourceKind)} aria-label="Kind of item">
          {LIBRARY_KINDS.map((k) => (
            <option key={k} value={k}>
              {knowledgeResourceKindLabels[k]}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="button button-primary button-small" disabled={busy} onClick={create} data-testid="library-create">
        {busy ? "Creating…" : "Create"}
      </button>
      {error && (
        <span className="form-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
