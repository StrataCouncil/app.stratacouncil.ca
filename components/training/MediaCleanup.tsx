"use client";

import { useState } from "react";
import { deleteUnusedMedia, findUnusedMedia } from "@/app/admin/training/actions";

const size = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/**
 * Training media no module uses any more (old narration, replaced photos,
 * rebuilt modules): find it, then delete it. Files from the last 30 days are
 * left alone, and anything still in a draft or published version is kept.
 */
export function MediaCleanup() {
  const [found, setFound] = useState<{ count: number; bytes: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function check() {
    setBusy(true);
    setMessage(null);
    const r = await findUnusedMedia();
    setBusy(false);
    if (!r.ok) return setMessage(r.error);
    setFound({ count: r.count, bytes: r.bytes });
  }

  async function remove() {
    setBusy(true);
    const r = await deleteUnusedMedia();
    setBusy(false);
    setFound(null);
    setMessage(r.ok ? `Deleted ${r.deleted} unused ${r.deleted === 1 ? "file" : "files"}.` : r.error);
  }

  return (
    <section className="card media-cleanup" data-testid="media-cleanup">
      <h2>Unused media</h2>
      <p className="card__meta">
        Narration, pictures and video that no module uses any more, for example after a rebuild. Anything in a draft or a
        published version is kept, and so is anything from the last 30 days.
      </p>
      {found && (
        <p>
          {found.count === 0 ? (
            "Nothing unused. Storage is tidy."
          ) : (
            <>
              <strong>
                {found.count} unused {found.count === 1 ? "file" : "files"}
              </strong>{" "}
              ({size(found.bytes)}).
            </>
          )}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <div className="text-actions">
        {found && found.count > 0 ? (
          <>
            <button type="button" className="button button-primary button-small" onClick={remove} disabled={busy}>
              {busy ? "Deleting…" : `Delete ${found.count} unused ${found.count === 1 ? "file" : "files"}`}
            </button>
            <button type="button" className="text-action" onClick={() => setFound(null)} disabled={busy}>
              Cancel
            </button>
          </>
        ) : (
          <button type="button" className="button button-secondary button-small" onClick={check} disabled={busy}>
            {busy ? "Checking…" : "Find unused media"}
          </button>
        )}
      </div>
    </section>
  );
}
