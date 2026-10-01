"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  acceptedExtensions,
  DOCUMENTS_BUCKET,
  documentCategoryLabels,
  MAX_FILES_PER_UPLOAD,
  pickableDocumentCategories,
  type DocumentCategory,
} from "@/lib/documents";
import { createDocumentUploads, registerDocuments } from "@/app/strata/[corpId]/documents/actions";

/**
 * "Upload document": pick one or more files and the folder they go in
 * (doc01 §4 — uploader-chosen for every folder except Agenda
 * Attachments, which only the agenda flow fills).
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
          defaultCategory={defaultCategory && defaultCategory !== "agenda_attachments" ? defaultCategory : ""}
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

    const tickets = await createDocumentUploads(
      corpId,
      files.map((f) => ({ name: f.name, size: f.size }))
    );
    if (!tickets.ok) {
      setBusy(false);
      return setError(tickets.error);
    }

    const storage = createClient().storage.from(DOCUMENTS_BUCKET);
    const uploaded = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const ticket = tickets.tickets[i];
      setStatus(`Uploading ${i + 1} of ${files.length}: ${file.name}`);
      const { error: uploadError } = await storage.uploadToSignedUrl(ticket.path, ticket.token, file, {
        contentType: file.type || "application/octet-stream",
      });
      if (uploadError) {
        setBusy(false);
        setStatus(null);
        return setError(`${file.name} didn't upload. Please try again.`);
      }
      uploaded.push({ path: ticket.path, name: file.name, size: file.size, type: file.type });
    }

    setStatus("Saving…");
    const result = await registerDocuments(corpId, category, uploaded);
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
            onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, MAX_FILES_PER_UPLOAD))}
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
          <button type="submit" className="button button-primary" disabled={busy} data-testid="upload-document-submit">
            {busy ? "Uploading…" : files.length > 1 ? `Upload ${files.length} files` : "Upload"}
          </button>
        </div>
      </form>
    </div>
  );
}
