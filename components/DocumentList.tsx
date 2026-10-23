"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  documentCategoryLabels,
  pickableDocumentCategories,
  type DocumentCategory,
  type IndexingStatus,
} from "@/lib/documents";
import type { FiledCopy, RepositoryDocument } from "@/lib/data/documents";
import { getDocumentDownloadUrl, mergeDuplicateDocument, moveDocument, reindexDocument } from "@/app/strata/[corpId]/documents/actions";

/** An agenda item a document is attached to, ready to show. */
export interface DocumentUseLink {
  href: string;
  label: string;
  item: string;
}

const statusLabels: Record<IndexingStatus, string> = {
  pending: "Waiting to index",
  processing: "Indexing",
  indexed: "Indexed",
  failed: "Indexing failed",
  not_indexable: "Stored for reference",
  needs_text: "No text layer",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
}

function formatSize(bytes: number | null) {
  if (!bytes) return null;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * One folder's documents: status, download, move, (re)index, and the
 * agenda items each is attached to. In Unfiled, a document identical to
 * one already filed says so, and an admin can keep the filed one.
 */
export function DocumentList({
  corpId,
  documents,
  uses = {},
  sameAs = {},
  canRemoveCopies = false,
}: {
  corpId: string;
  documents: RepositoryDocument[];
  uses?: Record<string, DocumentUseLink[]>;
  sameAs?: Record<string, FiledCopy>;
  canRemoveCopies?: boolean;
}) {
  const router = useRouter();
  const [moving, setMoving] = useState<RepositoryDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // While anything is indexing, refresh now and then so the status settles
  // without a manual reload.
  const inFlight = documents.some((d) => d.indexingStatus === "pending" || d.indexingStatus === "processing");
  useEffect(() => {
    if (!inFlight) return;
    const t = setInterval(() => router.refresh(), 8000);
    return () => clearInterval(t);
  }, [inFlight, router]);

  function download(doc: RepositoryDocument) {
    setError(null);
    startTransition(async () => {
      const result = await getDocumentDownloadUrl(corpId, doc.id);
      if (!result.ok) return setError(result.error);
      if (doc.sourceType === "link") window.open(result.url, "_blank", "noopener,noreferrer");
      else window.location.assign(result.url);
    });
  }

  function keepFiled(doc: RepositoryDocument, copy: FiledCopy) {
    const where = documentCategoryLabels[copy.category];
    if (!window.confirm(`Keep "${copy.title}" in ${where} and remove this copy? Agenda items that attach this copy will attach that one instead. The files are identical, so nothing is lost.`)) return;
    setError(null);
    startTransition(async () => {
      const result = await mergeDuplicateDocument(corpId, doc.id, copy.id);
      if (!result.ok) setError(result.error);
      router.refresh();
    });
  }

  function reindex(doc: RepositoryDocument) {
    setError(null);
    startTransition(async () => {
      const result = await reindexDocument(corpId, doc.id);
      if (!result.ok) setError(result.error);
      router.refresh();
    });
  }

  return (
    <>
      {error && (
        <p className="roster-invites__error" role="alert">
          {error}
        </p>
      )}
      <div className="module-list" data-testid="document-list">
        {documents.map((doc) => {
          const size = formatSize(doc.sizeBytes);
          // Indexing starts by itself on upload. Re-index is for when it
          // finished or failed, or a document has sat waiting too long.
          const stuck = doc.indexingStatus === "pending" && Date.now() - new Date(doc.uploadedAt).getTime() > 10 * 60 * 1000;
          const canIndex =
            stuck || doc.indexingStatus === "failed" || doc.indexingStatus === "needs_text" || doc.indexingStatus === "indexed";
          return (
            <div className="module-row" key={doc.id} data-testid={`document-${doc.id}`}>
              <div style={{ minWidth: 0 }}>
                <div className="module-row__title doc-row__title" title={doc.title}>
                  {doc.title}
                  {doc.sourceType === "link" && <span className="pill doc-row__kind">Link</span>}
                </div>
                <div className="module-row__meta">
                  {doc.uploadedBy ? `${doc.uploadedBy} · ` : ""}
                  {formatDate(doc.uploadedAt)}
                  {size ? ` · ${size}` : ""}{" "}
                  <span className={`doc-status doc-status--${doc.indexingStatus}`} title={doc.indexingError ?? undefined}>
                    {statusLabels[doc.indexingStatus]}
                  </span>
                </div>
                {doc.indexingStatus === "needs_text" && (
                  <div className="module-row__meta">
                    This looks like a scanned PDF with no text in it. Upload a
                    searchable (OCR&rsquo;d) copy so Stratasphere&trade; can read it.
                  </div>
                )}
                {doc.indexingStatus === "failed" && doc.indexingError && (
                  <div className="module-row__meta">{doc.indexingError}</div>
                )}
                {uses[doc.id]?.length ? <AttachedTo uses={uses[doc.id]} /> : null}
                {sameAs[doc.id] && (
                  <div className="module-row__meta doc-row__same" data-testid={`same-as-${doc.id}`}>
                    Identical to <strong>{sameAs[doc.id].title}</strong> in {documentCategoryLabels[sameAs[doc.id].category]}.
                    {canRemoveCopies ? (
                      <>
                        {" "}
                        <button
                          type="button"
                          className="text-action"
                          onClick={() => keepFiled(doc, sameAs[doc.id])}
                          disabled={pending}
                          data-testid={`keep-filed-${doc.id}`}
                        >
                          Keep that one, remove this copy
                        </button>
                      </>
                    ) : (
                      " An admin can remove this copy."
                    )}
                  </div>
                )}
              </div>
              <div className="text-actions">
                {canIndex && (
                  <button
                    type="button"
                    className="text-action"
                    onClick={() => reindex(doc)}
                    disabled={pending}
                    data-testid={`reindex-document-${doc.id}`}
                  >
                    Re-index
                  </button>
                )}
                <button
                  type="button"
                  className="text-action"
                  onClick={() => download(doc)}
                  disabled={pending || (!doc.hasFile && doc.sourceType !== "link")}
                  data-testid={`open-document-${doc.id}`}
                >
                  {doc.sourceType === "link" ? "Open link" : "Download"}
                </button>
                {/* Minutes stay in Meetings & Records (0060). */}
                {doc.sourceType !== "minutes" && doc.sourceType !== "historic_minutes" && (
                  <button
                    type="button"
                    className="text-action"
                    onClick={() => setMoving(doc)}
                    disabled={pending}
                    data-testid={`move-document-${doc.id}`}
                  >
                    Move
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {moving && (
        <MoveDialog
          corpId={corpId}
          doc={moving}
          onClose={() => setMoving(null)}
          onMoved={() => {
            setMoving(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

/** "Attached to" with the first few agenda items, and how many more. */
function AttachedTo({ uses }: { uses: DocumentUseLink[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? uses : uses.slice(0, 2);
  return (
    <div className="module-row__meta doc-row__uses">
      Attached to{" "}
      {shown.map((u, i) => (
        <span key={`${u.href}-${i}`}>
          {i > 0 && "; "}
          <Link href={u.href}>{u.label}</Link> ({u.item})
        </span>
      ))}
      {!all && uses.length > shown.length && (
        <>
          {" "}
          <button type="button" className="text-action" onClick={() => setAll(true)}>
            and {uses.length - shown.length} more
          </button>
        </>
      )}
    </div>
  );
}

function MoveDialog({
  corpId,
  doc,
  onClose,
  onMoved,
}: {
  corpId: string;
  doc: RepositoryDocument;
  onClose: () => void;
  onMoved: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function move(category: DocumentCategory) {
    setError(null);
    startTransition(async () => {
      const result = await moveDocument(corpId, doc.id, category);
      if (result.ok) onMoved();
      else setError(result.error);
    });
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="move-document-title"
        onClick={(e) => e.stopPropagation()}
        data-testid="move-document-dialog"
      >
        <h2 id="move-document-title">Move document</h2>
        <p className="card__meta doc-row__title" title={doc.title}>
          {doc.title}
        </p>
        <div className="doc-move__options">
          {pickableDocumentCategories.map((c) => {
            const current = doc.category === c;
            return (
              <button
                key={c}
                type="button"
                className="doc-move__option"
                aria-pressed={current}
                disabled={current || pending}
                onClick={() => move(c)}
                data-testid={`move-to-${c}`}
              >
                {documentCategoryLabels[c]}
                {current && <span className="card__meta"> (current)</span>}
              </button>
            );
          })}
        </div>
        {error && (
          <p className="roster-invites__error" role="alert">
            {error}
          </p>
        )}
        <div className="role-editor__actions">
          <button ref={cancelRef} type="button" className="button button-secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
