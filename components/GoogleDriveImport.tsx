"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { documentCategoryLabels, MAX_FILES_PER_UPLOAD, pickableDocumentCategories, type DocumentCategory } from "@/lib/documents";
import { documentNamesInFolder } from "@/app/strata/[corpId]/documents/actions";
import { uploadToStrataDocuments } from "@/lib/documents-upload";
import { fetchFromGoogleDrive, googleDriveConfigured, pickFromGoogleDrive, planImport, type ImportPlan } from "@/lib/google-drive";
import { IS_DEMO } from "@/lib/demo";

/**
 * "Import from Google Drive": pick files in Google's picker, choose the
 * folder, and they're copied in once, exactly like an upload (lib/google-drive.ts).
 * Hidden until the Google keys are set, and on the demo.
 */
export function GoogleDriveImport({ corpId, defaultCategory }: { corpId: string; defaultCategory?: DocumentCategory }) {
  const [picked, setPicked] = useState<{ token: string; files: ImportPlan[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  if (!googleDriveConfigured || IS_DEMO) return null;

  async function open() {
    setError(null);
    setOpening(true);
    try {
      const { token, files } = await pickFromGoogleDrive(MAX_FILES_PER_UPLOAD);
      if (files.length) setPicked({ token, files: files.map(planImport) });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google Drive didn't open.");
    } finally {
      setOpening(false);
    }
  }

  return (
    <>
      <button type="button" className="button button-secondary" onClick={open} disabled={opening} data-testid="import-google-drive">
        {opening ? "Opening Google Drive…" : "Import from Google Drive"}
      </button>
      {error && (
        <p className="roster-invites__error" role="alert">
          {error}
        </p>
      )}
      {picked && (
        <ImportDialog
          corpId={corpId}
          token={picked.token}
          files={picked.files}
          defaultCategory={defaultCategory && defaultCategory !== "agenda_attachments" ? defaultCategory : ""}
          onClose={() => setPicked(null)}
        />
      )}
    </>
  );
}

function ImportDialog({
  corpId,
  token,
  files,
  defaultCategory,
  onClose,
}: {
  corpId: string;
  token: string;
  files: ImportPlan[];
  defaultCategory: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [category, setCategory] = useState(defaultCategory);
  const [existing, setExisting] = useState<Set<string>>(new Set());
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(files.filter((f) => !f.problem).map((f) => f.id)));
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Files already in the chosen folder are flagged and left unticked.
  useEffect(() => {
    if (!category) return setExisting(new Set());
    let live = true;
    documentNamesInFolder(corpId, category).then((names) => {
      if (!live) return;
      const set = new Set(names);
      setExisting(set);
      setChosen((prev) => new Set([...prev].filter((id) => !set.has(files.find((f) => f.id === id)!.fileName.toLowerCase()))));
    });
    return () => {
      live = false;
    };
  }, [category, corpId, files]);

  const toggle = (id: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function importFiles(e: React.FormEvent) {
    e.preventDefault();
    const list = files.filter((f) => chosen.has(f.id) && !f.problem);
    if (!list.length) return setError("Choose at least one file.");
    if (!category) return setError("Choose a folder.");
    setBusy(true);
    setError(null);
    try {
      const ready: File[] = [];
      for (let i = 0; i < list.length; i++) {
        setStatus(`Fetching ${i + 1} of ${list.length} from Google Drive: ${list[i].fileName}`);
        ready.push(await fetchFromGoogleDrive(token, list[i]));
      }
      const result = await uploadToStrataDocuments(corpId, category, ready, setStatus);
      if (!result.ok) throw new Error(result.error);
      router.refresh();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The import didn't finish.");
      setStatus(null);
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <form
        className="modal modal--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-drive-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={importFiles}
        data-testid="import-google-drive-dialog"
      >
        <h2 id="import-drive-title">Import from Google Drive</h2>
        <p className="card__meta">
          A copy of each file is added here, once; your Drive isn&rsquo;t changed or connected. Google Docs come in as
          Word, Sheets and Slides as PDF, so Stratasphere&trade; can read them.
        </p>

        <label className="field">
          <span>Folder</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)} disabled={busy} required data-testid="import-google-drive-folder">
            <option value="">Choose a folder</option>
            {pickableDocumentCategories.map((c) => (
              <option key={c} value={c}>
                {documentCategoryLabels[c]}
              </option>
            ))}
          </select>
        </label>

        <ul className="drive-import-list">
          {files.map((f) => {
            const dup = existing.has(f.fileName.toLowerCase());
            return (
              <li key={f.id}>
                <label>
                  <input type="checkbox" checked={chosen.has(f.id)} onChange={() => toggle(f.id)} disabled={busy || Boolean(f.problem)} />
                  <span>
                    {f.fileName}
                    {f.problem && <span className="drive-import-list__note">{f.problem}</span>}
                    {!f.problem && dup && <span className="drive-import-list__note">Already in this folder</span>}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>

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
          <button type="submit" className="button button-primary" disabled={busy || chosen.size === 0} data-testid="import-google-drive-submit">
            {busy ? "Importing…" : `Import ${chosen.size} file${chosen.size === 1 ? "" : "s"}`}
          </button>
        </div>
      </form>
    </div>
  );
}
