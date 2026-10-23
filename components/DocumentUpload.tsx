"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  acceptedExtensions,
  documentCategoryLabels,
  folderLabel,
  MAX_FILES_PER_UPLOAD,
  pickableDocumentCategories,
  type DocumentCategory,
} from "@/lib/documents";
import { findAlreadyInDocuments, uploadToStrataDocuments, type AlreadyInDocuments } from "@/lib/documents-upload";

/**
 * "Upload document": pick one or more files and the folder they go in
 * (doc01 §4). A file that's already in Documents (same contents, any
 * name) is pointed out first, and left out unless the uploader wants a
 * second copy.
 */
export function DocumentUpload({
  corpId,
  defaultCategory,
  label = "Upload document",
}: {
  corpId: string;
  defaultCategory?: DocumentCategory;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="button button-primary"
        onClick={() => setOpen(true)}
        data-testid="upload-document"
      >
        {label}
      </button>
      {open && (
        <UploadDialog
          corpId={corpId}
          defaultCategory={defaultCategory ?? ""}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function UploadDialog({
  corpId,
  defaultCategory,
  onClose,
}: {
  corpId: string;
  defaultCategory: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [category, setCategory] = useState(defaultCategory);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [already, setAlready] = useState<AlreadyInDocuments[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fileRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!files.length) return setError("Choose at least one file.");
    if (!category) return setError("Choose a folder.");
    setBusy(true);
    setError(null);
    setStatus("Checking Documents…");
    const found = await findAlreadyInDocuments(corpId, files);
    setStatus(null);
    setBusy(false);
    if (found.length) return setAlready(found);
    await send(files);
  }

  async function send(toUpload: File[]) {
    setAlready(null);
    if (!toUpload.length) return onClose();
    setBusy(true);
    setError(null);
    const result = await uploadToStrataDocuments(corpId, category, toUpload, setStatus);
    setBusy(false);
    setStatus(null);
    if (!result.ok) return setError(result.error);
    router.refresh();
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="upload-document-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={upload}
        data-testid="upload-document-dialog"
      >
        <h2 id="upload-document-title">Upload documents</h2>
        <p className="card__meta">
          PDF, Word (.docx) and text files are indexed for Stratasphere&trade;.
          Images, spreadsheets and older .doc files are stored for reference only.
        </p>

        <label className="field">
          <span>Files</span>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept={acceptedExtensions.map((x) => `.${x}`).join(",")}
            onChange={(e) => {
              setFiles(Array.from(e.target.files ?? []).slice(0, MAX_FILES_PER_UPLOAD));
              setAlready(null);
            }}
            disabled={busy}
            data-testid="upload-document-files"
          />
          <span className="field__hint">Up to {MAX_FILES_PER_UPLOAD} files, 50 MB each.</span>
        </label>

        <label className="field">
          <span>Folder</span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            disabled={busy}
            required
            data-testid="upload-document-folder"
          >
            <option value="">Choose a folder</option>
            {pickableDocumentCategories.map((c) => (
              <option key={c} value={c}>
                {documentCategoryLabels[c]}
              </option>
            ))}
          </select>
        </label>

        {already && (
          <div className="item-editor__already" role="alert" data-testid="upload-document-already">
            <p>{already.length === 1 ? "This file is" : "These files are"} already in Documents:</p>
            <ul>
              {already.map((a) => (
                <li key={a.existing.id + a.file.name}>
                  {a.file.name}: <strong>{a.existing.title}</strong> ({folderLabel(a.existing.category)})
                </li>
              ))}
            </ul>
            <div className="item-editor__attach-actions">
              <button
                type="button"
                className="button button-primary button-small"
                onClick={() => send(files.filter((f) => !already.some((a) => a.file === f)))}
                disabled={busy}
                data-testid="upload-document-skip-copies"
              >
                {already.length === files.length ? "Don't upload" : "Upload the others only"}
              </button>
              <button type="button" className="button button-secondary button-small" onClick={() => send(files)} disabled={busy}>
                Upload anyway
              </button>
            </div>
          </div>
        )}

        {status && (
          <p className="card__meta" role="status">
            {status}
          </p>
        )}
        {error && (
          <p className="roster-invites__error" role="alert">
            {error}
          </p>
        )}

        <div className="role-editor__actions">
          <button type="button" className="button button-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="button button-primary" disabled={busy || Boolean(already)} data-testid="upload-document-submit">
            {busy ? "Uploading…" : files.length > 1 ? `Upload ${files.length} files` : "Upload"}
          </button>
        </div>
      </form>
    </div>
  );
}
