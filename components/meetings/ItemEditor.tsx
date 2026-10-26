"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  acceptedExtensions,
  DOCUMENTS_BUCKET,
  documentCategoryLabels,
  folderLabel,
  MAX_FILES_PER_UPLOAD,
  pickableDocumentCategories,
} from "@/lib/documents";
import {
  decisionTypeLabels,
  decisionTypes,
  isAdjournment,
  isNextMeeting,
  NEEDS_MOTION,
  newMotion,
  resolutionTypeLabels,
  resolutionTypes,
  type AgendaItem,
  type Attachment,
  type DecisionType,
  type ResolutionType,
} from "@/lib/meetings/agenda";
import { createDocumentUploads, listAttachableDocuments, type AttachableDocument } from "@/app/strata/[corpId]/documents/actions";
import { findAlreadyInDocuments, type AlreadyInDocuments } from "@/lib/documents-upload";
import { addLinkAttachment, draftMotion, registerAgendaAttachments } from "@/app/strata/[corpId]/meetings/actions";
import { IS_DEMO } from "@/lib/demo";
import { isDemoLimit, showDemoLimit } from "@/lib/demo-client";

/**
 * Edit one agenda item: title, category, resolution type, background,
 * financial implications, risks, motion and decision type, private notes,
 * attachments. Used by the agenda builder and inside Meeting Mode.
 *
 * Private notes are for whoever runs the meeting only — never on the
 * agenda, in the minutes, or sent to Stratasphere — and are deleted when
 * the minutes are finalized.
 */
export function ItemEditor({
  corpId,
  meetingId,
  item,
  note,
  categories,
  general = true,
  onSave,
  onClose,
}: {
  corpId: string;
  meetingId: string;
  item: AgendaItem;
  note: string;
  categories: string[];
  /** AGM or SGM. Council and committee decisions are always by a majority of members present, so there's no threshold to choose. */
  general?: boolean;
  onSave: (item: AgendaItem, note: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<AgendaItem>(item);
  const [noteDraft, setNoteDraft] = useState(note);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Attaching: upload files to a folder, add a link to a folder, or pick
  // something already in Documents.
  const [adding, setAdding] = useState<"upload" | "link" | "library" | null>(null);
  const [folder, setFolder] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [already, setAlready] = useState<AlreadyInDocuments[] | null>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const [library, setLibrary] = useState<AttachableDocument[] | null>(null);
  const [search, setSearch] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);
  const simple = isAdjournment(draft) || isNextMeeting(draft);

  async function draft_() {
    if (!draft.motion) return;
    setBusy("Drafting motion…");
    setError(null);
    const res = await draftMotion(corpId, meetingId, {
      text: draft.text,
      background: draft.background,
      financial: draft.financial,
      risks: draft.risks,
      decisionType: draft.motion.dt,
    });
    setBusy(null);
    if (isDemoLimit(res)) return showDemoLimit("motion drafts");
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setDraft((d) => (d.motion ? { ...d, motion: { ...d.motion, text: res.motionText } } : d));
  }

  // Closing (Escape, a click outside, Cancel) asks first if there are unsaved
  // changes; never while an upload is in flight.
  const dirty = JSON.stringify(draft) !== JSON.stringify(item) || noteDraft !== note;
  function requestClose() {
    if (busy) return;
    if (dirty && !window.confirm("Discard your changes to this item? They haven't been saved.")) return;
    onClose();
  }
  const escape = useRef(() => {});
  escape.current = requestClose;
  useEffect(() => {
    titleRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && escape.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const set = <K extends keyof AgendaItem>(key: K, value: AgendaItem[K]) => setDraft((d) => ({ ...d, [key]: value }));

  function setType(type: ResolutionType) {
    setDraft((d) => ({
      ...d,
      type,
      motion: NEEDS_MOTION.includes(type) ? (d.motion ?? newMotion()) : isAdjournment(d) ? d.motion : null,
    }));
  }

  function startAdding(mode: "upload" | "link" | "library") {
    if (IS_DEMO && mode !== "library") return showDemoLimit("upload");
    setError(null);
    setAlready(null);
    setAdding((current) => (current === mode ? null : mode));
    if (mode === "library" && !library) {
      void listAttachableDocuments(corpId).then((res) => {
        if (res.ok) setLibrary(res.documents);
        else setError(res.error);
      });
    }
  }

  function attach(atts: Attachment[]) {
    setDraft((d) => {
      const have = new Set(d.atts.map((a) => a.documentId).filter(Boolean));
      return { ...d, atts: [...d.atts, ...atts.filter((a) => !a.documentId || !have.has(a.documentId))] };
    });
  }

  function attachExisting(doc: { id: string; title: string; kind: "document" | "link"; url: string | null }) {
    attach([
      doc.kind === "link" && doc.url
        ? { id: `a_${doc.id}`, kind: "link", documentId: doc.id, url: doc.url, title: doc.title }
        : { id: `a_${doc.id}`, kind: "document", documentId: doc.id, title: doc.title },
    ]);
  }

  // Upload: first check whether any file is already in Documents (same
  // contents, any name), and offer that copy instead of a second one.
  async function checkThenUpload() {
    if (!files.length) return setError("Choose at least one file.");
    if (!folder) return setError("Choose the folder these files go in.");
    setError(null);
    setBusy("Checking Documents…");
    const found = await findAlreadyInDocuments(corpId, files);
    setBusy(null);
    if (found.length) return setAlready(found);
    await uploadFiles(files);
  }

  async function useCopiesInDocuments() {
    if (!already) return;
    const dupes = new Set(already.map((a) => a.file));
    already.forEach((a) =>
      attachExisting({ id: a.existing.id, title: a.existing.title, kind: "document", url: null })
    );
    setAlready(null);
    await uploadFiles(files.filter((f) => !dupes.has(f)));
  }

  async function uploadFiles(toUpload: File[]) {
    setAlready(null);
    if (!toUpload.length) return finishAdding();
    setError(null);
    setBusy(`Uploading ${toUpload.length} file${toUpload.length === 1 ? "" : "s"}…`);
    try {
      const tickets = await createDocumentUploads(corpId, toUpload.map((f) => ({ name: f.name, size: f.size })));
      if (!tickets.ok) throw new Error(tickets.error);
      const storage = createClient().storage.from(DOCUMENTS_BUCKET);
      const uploaded = [];
      for (let i = 0; i < toUpload.length; i++) {
        const { error: upErr } = await storage.uploadToSignedUrl(tickets.tickets[i].path, tickets.tickets[i].token, toUpload[i], {
          contentType: toUpload[i].type || "application/octet-stream",
        });
        if (upErr) throw new Error(`${toUpload[i].name} didn't upload.`);
        uploaded.push({ path: tickets.tickets[i].path, name: toUpload[i].name, size: toUpload[i].size, type: toUpload[i].type });
      }
      const result = await registerAgendaAttachments(corpId, meetingId, draft.id, uploaded, folder);
      if (!result.ok) throw new Error(result.error);
      attach(result.attachments);
      finishAdding();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The upload didn't finish.");
    } finally {
      setBusy(null);
    }
  }

  async function addLink() {
    if (!linkUrl.trim()) return;
    if (!folder) return setError("Choose the folder this link goes in.");
    setError(null);
    setBusy("Adding link…");
    const result = await addLinkAttachment(corpId, meetingId, draft.id, linkUrl, linkLabel, folder);
    setBusy(null);
    if (!result.ok) return setError(result.error);
    attach([result.attachment]);
    finishAdding();
  }

  function finishAdding() {
    setAdding(null);
    setFiles([]);
    setLinkUrl("");
    setLinkLabel("");
    // Documents changed: load the list afresh next time.
    setLibrary(null);
  }

  function removeAttachment(att: Attachment) {
    // Takes it off this item only; the document stays in Documents.
    setDraft((d) => ({ ...d, atts: d.atts.filter((a) => a.id !== att.id) }));
  }

  const attachedIds = new Set(draft.atts.map((a) => a.documentId).filter(Boolean));
  const query = search.trim().toLowerCase();
  const matches = (library ?? [])
    .filter((d) => !attachedIds.has(d.id))
    .filter((d) => !query || `${d.title} ${folderLabel(d.category)}`.toLowerCase().includes(query))
    .slice(0, 40);

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.text.trim()) return setError("Give the item a title.");
    onSave({ ...draft, text: draft.text.trim(), cat: draft.cat.trim() || item.cat }, noteDraft);
  }

  return (
    <div className="modal-backdrop" onClick={requestClose}>
      <form
        className="modal modal--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="item-editor-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={save}
        data-testid="item-editor"
      >
        <h2 id="item-editor-title">Edit agenda item</h2>
        <div className="field-grid">
          <label className="field field--wide">
            <span>Title</span>
            <input ref={titleRef} value={draft.text} onChange={(e) => set("text", e.target.value)} maxLength={300} required data-testid="item-title" />
          </label>
          <label className="field">
            <span>Category</span>
            <input value={draft.cat} onChange={(e) => set("cat", e.target.value)} list="agenda-categories" maxLength={120} readOnly={IS_DEMO} />
            <datalist id="agenda-categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
          <label className="field">
            <span>Resolution type</span>
            <select value={draft.type} onChange={(e) => setType(e.target.value as ResolutionType)} data-testid="item-type">
              {resolutionTypes.map((t) => (
                <option key={t} value={t}>
                  {resolutionTypeLabels[t]}
                </option>
              ))}
            </select>
          </label>
          {!simple && (
            <>
              <label className="field field--wide">
                <span>Background / rationale</span>
                <textarea rows={3} value={draft.background} onChange={(e) => set("background", e.target.value)} />
              </label>
              <label className="field">
                <span>Financial implications</span>
                <textarea rows={2} value={draft.financial} onChange={(e) => set("financial", e.target.value)} />
              </label>
              <label className="field">
                <span>Risks / compliance</span>
                <textarea rows={2} value={draft.risks} onChange={(e) => set("risks", e.target.value)} />
              </label>
            </>
          )}
          {draft.motion && (
            <>
              <label className="field field--wide">
                <span>Motion</span>
                <textarea
                  rows={2}
                  value={draft.motion.text}
                  placeholder="THAT the strata corporation…"
                  onChange={(e) => set("motion", { ...draft.motion!, text: e.target.value })}
                  data-testid="item-motion"
                />
                <span className="field__hint item-editor__motion-tools">
                  Standard wording fills in for template items. For anything else, draft it with AI and edit as needed.
                  <button
                    type="button"
                    className="button button-secondary button-small"
                    onClick={draft_}
                    disabled={busy !== null}
                    data-testid="item-draft-motion"
                  >
                    {busy === "Drafting motion…" ? "Drafting…" : "Draft with AI"}
                  </button>
                </span>
              </label>
              {!general ? (
                <p className="field field__hint" data-testid="item-decision-council">
                  Council decides by a majority of the council members present (Standard Bylaws 18(1)).
                </p>
              ) : (
              <label className="field">
                <span>Decision type</span>
                <select
                  value={draft.motion.dt}
                  onChange={(e) => set("motion", { ...draft.motion!, dt: e.target.value as DecisionType })}
                  data-testid="item-decision-type"
                >
                  {decisionTypes.map((d) => (
                    <option key={d} value={d}>
                      {decisionTypeLabels[d]}
                    </option>
                  ))}
                </select>
              </label>
              )}
            </>
          )}
          <label className="field field--wide">
            <span>Private notes</span>
            <textarea
              rows={2}
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              placeholder="Only you (and whoever can edit this agenda) see this."
              data-testid="item-note"
            />
            <span className="field__hint">
              Not on the agenda or in the minutes, never sent to Stratasphere, and deleted for good when the minutes are finalized.
            </span>
          </label>
        </div>

        <fieldset className="item-editor__attachments">
          <legend>Attachments</legend>
          {draft.atts.length > 0 && (
            <ul className="attachment-list">
              {draft.atts.map((a) => (
                <li key={a.id}>
                  <span className="pill">{a.kind === "link" ? "Link" : "File"}</span> {a.title}
                  <button type="button" className="link-button" onClick={() => removeAttachment(a)} aria-label={`Remove ${a.title}`}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="item-editor__attach-actions">
            <button type="button" className="button button-secondary button-small" aria-pressed={adding === "upload"} onClick={() => startAdding("upload")} disabled={Boolean(busy)} data-testid="item-attach-upload">
              Upload files
            </button>
            <button type="button" className="button button-secondary button-small" aria-pressed={adding === "link"} onClick={() => startAdding("link")} disabled={Boolean(busy)} data-testid="item-attach-link">
              Add a link
            </button>
            <button type="button" className="button button-secondary button-small" aria-pressed={adding === "library"} onClick={() => startAdding("library")} disabled={Boolean(busy)} data-testid="item-attach-library">
              From Documents
            </button>
          </div>

          {(adding === "upload" || adding === "link") && (
            <div className="item-editor__attach-panel">
              {adding === "upload" ? (
                <label className="field">
                  <span>Files</span>
                  <input
                    type="file"
                    multiple
                    accept={acceptedExtensions.map((x) => `.${x}`).join(",")}
                    onChange={(e) => {
                      setFiles(Array.from(e.target.files ?? []).slice(0, MAX_FILES_PER_UPLOAD));
                      setAlready(null);
                    }}
                    disabled={Boolean(busy)}
                    data-testid="item-attach-files"
                  />
                </label>
              ) : (
                <div className="item-editor__link">
                  <input
                    type="url"
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    placeholder="https://…"
                    aria-label="Link address"
                    data-testid="item-link-url"
                  />
                  <input value={linkLabel} onChange={(e) => setLinkLabel(e.target.value)} placeholder="Label (optional)" aria-label="Link label" maxLength={300} />
                </div>
              )}
              <label className="field">
                <span>Folder in Documents</span>
                <select value={folder} onChange={(e) => setFolder(e.target.value)} disabled={Boolean(busy)} data-testid="item-attach-folder">
                  <option value="">Choose a folder</option>
                  {pickableDocumentCategories.map((c) => (
                    <option key={c} value={c}>
                      {documentCategoryLabels[c]}
                    </option>
                  ))}
                </select>
              </label>

              {already ? (
                <div className="item-editor__already" role="alert" data-testid="item-attach-already">
                  <p>
                    {already.length === 1 ? "This file is" : "These files are"} already in Documents:
                  </p>
                  <ul>
                    {already.map((a) => (
                      <li key={a.existing.id + a.file.name}>
                        {a.file.name}: <strong>{a.existing.title}</strong> ({folderLabel(a.existing.category)})
                      </li>
                    ))}
                  </ul>
                  <div className="item-editor__attach-actions">
                    <button type="button" className="button button-primary button-small" onClick={useCopiesInDocuments} disabled={Boolean(busy)} data-testid="item-attach-use-existing">
                      Attach the {already.length === 1 ? "copy" : "copies"} in Documents
                    </button>
                    <button type="button" className="button button-secondary button-small" onClick={() => uploadFiles(files)} disabled={Boolean(busy)}>
                      Upload another copy
                    </button>
                  </div>
                </div>
              ) : (
                <div className="item-editor__attach-actions">
                  {adding === "upload" ? (
                    <button type="button" className="button button-primary button-small" onClick={checkThenUpload} disabled={Boolean(busy) || !files.length} data-testid="item-attach-upload-submit">
                      {files.length > 1 ? `Upload ${files.length} files` : "Upload"}
                    </button>
                  ) : (
                    <button type="button" className="button button-primary button-small" onClick={addLink} disabled={Boolean(busy) || !linkUrl.trim()} data-testid="item-add-link">
                      Add link
                    </button>
                  )}
                  <button type="button" className="link-button" onClick={finishAdding} disabled={Boolean(busy)}>
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}

          {adding === "library" && (
            <div className="item-editor__attach-panel" data-testid="item-attach-library-panel">
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by title or folder"
                aria-label="Search Documents"
                data-testid="item-attach-search"
              />
              {!library ? (
                <p className="card__meta">Loading Documents…</p>
              ) : matches.length === 0 ? (
                <p className="card__meta">{query ? "Nothing in Documents matches that." : "Nothing else in Documents to attach."}</p>
              ) : (
                <ul className="item-editor__library">
                  {matches.map((d) => (
                    <li key={d.id}>
                      <span className="item-editor__library-title" title={d.title}>
                        {d.title}
                        {d.kind === "link" && <span className="pill doc-row__kind">Link</span>}
                      </span>
                      <span className="card__meta">{folderLabel(d.category)}</span>
                      <button type="button" className="link-button" onClick={() => attachExisting(d)} data-testid={`item-attach-doc-${d.id}`}>
                        Attach
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <p className="field__hint">
            Uploads and links are filed in the folder you choose and indexed so Stratasphere can use them.
            Remove takes a document off this item only; it stays in Documents.
          </p>
        </fieldset>

        {busy && (
          <p className="card__meta" role="status">
            {busy}
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="role-editor__actions">
          <button type="button" className="button button-secondary" onClick={requestClose} disabled={Boolean(busy)}>
            Cancel
          </button>
          <button type="submit" className="button button-primary" disabled={Boolean(busy)} data-testid="item-save">
            Save item
          </button>
        </div>
      </form>
    </div>
  );
}
