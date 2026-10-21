"use client";

import { useState, useTransition } from "react";
import { requestDocumentExport } from "@/app/strata/[corpId]/documents/export-actions";

/** "Download everything", for the Admin: the link comes by email (0062). */
export function DocumentExportRequest({ corpId }: { corpId: string }) {
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="sync-note" data-testid="document-export-request">
      <div>
        <strong>Download everything</strong>
        <p>
          All of this strata&rsquo;s documents in one ZIP file, with an index. For safety, we email you a link that works
          once, within 24 hours.
        </p>
        {notice && (
          <p className="card__meta" role="status">
            {notice}
          </p>
        )}
        {error && (
          <p className="roster-invites__error" role="alert">
            {error}
          </p>
        )}
      </div>
      <button
        type="button"
        className="button button-secondary"
        disabled={pending}
        data-testid="document-export-button"
        onClick={() =>
          start(async () => {
            setError(null);
            setNotice(null);
            const res = await requestDocumentExport(corpId);
            if (res.ok) setNotice(`We've emailed a download link to ${res.email}.`);
            else setError(res.error);
          })
        }
      >
        {pending ? "Sending…" : "Email me a download link"}
      </button>
    </div>
  );
}
