"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  acceptedExtensions,
  DOCUMENTS_BUCKET,
  MAX_FILES_PER_UPLOAD,
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
import { createDocumentUploads } from "@/app/strata/[corpId]/documents/actions";
import { addLinkAttachment, registerAgendaAttachments } from "@/app/strata/[corpId]/meetings/actions";

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
  onSave,
  onClose,
}: {
  corpId: string;
  meetingId: string;
  item: AgendaItem;
  note: string;
  categories: string[];
  onSave: (item: AgendaItem, note: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<AgendaItem>(item);
  const [noteDraft, setNoteDraft] = useState(note);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);
  const simple = isAdjournment(draft) || isNextMeeting(draft);

  useEffect(() => {
    titleRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const set = <K extends keyof AgendaItem>(key: K, value: AgendaItem[K]) => setDraft((d) => ({ ...d, [key]: value }));

  function setType(type: ResolutionType) {
    setDraft((d) => ({
      ...d,
      type,
      motion: NEEDS_MOTION.includes(type) ? (d.motion ?? newMotion()) : isAdjournment(d) ? d.motion : null,
    }));
  }

  async function uploadFiles(files: File[]) {
    if (!files.length) return;
    setError(null);
    setBusy(`Uploading ${files.length} file${files.length === 1 ? "" : "s"}…`);
    try {
      const tickets = await createDocumentUploads(corpId, files.map((f) => ({ name: f.name, size: f.size })));
      if (!tickets.ok) throw new Error(tickets.error);
      const storage = createClient().storage.from(DOCUMENTS_BUCKET);
      const uploaded = [];
      for (let i = 0; i < files.length; i++) {
        const { error: upErr } = await storage.uploadToSignedUrl(tickets.tickets[i].path, tickets.tickets[i].token, files[i], {
          contentType: files[i].type || "application/octet-stream",
        });
        if (upErr) throw new Error(`${files[i].name} didn't upload.`);
        uploaded.push({ path: tickets.tickets[i].path, name: files[i].name, size: files[i].size, type: files[i].type });
      }
      const result = await registerAgendaAttachments(corpId, meetingId, draft.id, uploaded);
      if (!result.ok) throw new Error(result.error);
      setDraft((d) => ({ ...d, atts: [...d.atts, ...result.attachments] }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "The upload didn't finish.");
    } finally {
      setBusy(null);
    }
  }

  async function addLink() {
    if (!linkUrl.trim()) return;
    setError(null);
    setBusy("Adding link…");
    const result = await addLinkAttachment(corpId, meetingId, draft.id, linkUrl, linkLabel);
    setBusy(null);
    if (!result.ok) return setError(result.error);
    setDraft((d) => ({ ...d, atts: [...d.atts, result.attachment] }));
    setLinkUrl("");
    setLinkLabel("");
  }

  function removeAttachment(att: Attachment) {
    // Detaches from the item only; the file stays in Agenda Attachments.
    setDraft((d) => ({ ...d, atts: d.atts.filter((a) => a.id !== att.id) }));
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.text.trim()) return setError("Give the item a title.");
    onSave({ ...draft, text: draft.text.trim(), cat: draft.cat.trim() || item.cat }, noteDraft);
  }

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
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
            <input value={draft.cat} onChange={(e) => set("cat", e.target.value)} list="agenda-categories" maxLength={120} />
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
              </label>
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
          <label className="button button-secondary button-small item-editor__file">
            Add files
            <input
              type="file"
              multiple
              accept={acceptedExtensions.map((x) => `.${x}`).join(",")}
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []).slice(0, MAX_FILES_PER_UPLOAD);
                e.target.value = "";
                void uploadFiles(files);
              }}
              disabled={Boolean(busy)}
              className="visually-hidden"
              data-testid="item-attach-files"
            />
          </label>
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
            <button type="button" className="button button-secondary button-small" onClick={addLink} disabled={Boolean(busy) || !linkUrl.trim()} data-testid="item-add-link">
              Add link
            </button>
          </div>
          <p className="field__hint">
            Files and links are filed in Documents under Agenda Attachments and indexed so Stratasphere can use them.
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
          <button type="button" className="button button-secondary" onClick={onClose} disabled={Boolean(busy)}>
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
