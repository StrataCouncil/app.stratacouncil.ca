"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createDiscussion, updateDiscussion, type DiscussionInput } from "@/app/strata/[corpId]/discussions/actions";
import { uploadDiscussionFiles } from "@/components/discussions/upload";

/**
 * Start a council discussion, or (its author, before anyone votes) change
 * one. The same fields as an agenda item: background and rationale,
 * financial implications, risks and compliance, and the motion, with
 * attachments.
 */
export function DiscussionForm({
  corpId,
  discussionId,
  initial,
  onDone,
}: {
  corpId: string;
  discussionId?: string;
  initial?: DiscussionInput;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [fields, setFields] = useState<DiscussionInput>(initial ?? { title: "", background: "", financial: "", risks: "", motion: "" });
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof DiscussionInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setFields({ ...fields, [k]: e.target.value });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      const saved = discussionId ? await updateDiscussion(corpId, discussionId, fields) : await createDiscussion(corpId, fields);
      if (!saved.ok) return setError(saved.error);
      const id = discussionId ?? ("id" in saved ? String(saved.id) : "");
      if (files.length) {
        setStatus("Uploading attachments…");
        const failed = await uploadDiscussionFiles(corpId, id, null, files);
        if (failed) {
          setStatus(null);
          setError(`${discussionId ? "Saved" : "The discussion is open"}, but an attachment didn't make it: ${failed}`);
          if (!discussionId) router.push(`/strata/${corpId}/discussions/${id}`);
          return;
        }
      }
      setStatus(null);
      if (onDone) {
        onDone();
        router.refresh();
      } else router.push(`/strata/${corpId}/discussions/${id}`);
    });
  };

  return (
    <form onSubmit={submit} data-testid="discussion-form">
      <div className="field-grid">
        <label className="field field--wide">
          <span>Title</span>
          <input value={fields.title} onChange={set("title")} maxLength={200} required placeholder="Roof replacement quotes" data-testid="discussion-title" />
        </label>
        <label className="field field--wide">
          <span>Background and rationale</span>
          <textarea rows={5} value={fields.background} onChange={set("background")} maxLength={10000} data-testid="discussion-background" />
        </label>
        <label className="field field--wide">
          <span>Financial implications</span>
          <textarea rows={3} value={fields.financial} onChange={set("financial")} maxLength={10000} data-testid="discussion-financial" />
        </label>
        <label className="field field--wide">
          <span>Risks and compliance</span>
          <textarea rows={3} value={fields.risks} onChange={set("risks")} maxLength={10000} data-testid="discussion-risks" />
        </label>
        <label className="field field--wide">
          <span>Motion</span>
          <textarea rows={3} value={fields.motion} onChange={set("motion")} maxLength={4000} required placeholder="THAT council obtain three quotes for roof replacement." data-testid="discussion-motion" />
          <span className="field__hint">Once anyone has voted, the motion and its attachments can&rsquo;t be changed.</span>
        </label>
        <label className="field field--wide">
          <span>{discussionId ? "Add attachments" : "Attachments"}</span>
          <input type="file" multiple onChange={(e) => setFiles(Array.from(e.target.files ?? []))} data-testid="discussion-files" />
          <span className="field__hint">PDF, Word, Excel, images and other documents, up to 50 MB each. Only council can open them.</span>
        </label>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {status && <p className="card__meta">{status}</p>}
      <div className="role-editor__actions">
        {onDone && (
          <button type="button" className="button button-secondary" onClick={onDone} disabled={pending}>
            Cancel
          </button>
        )}
        <button type="submit" className="button button-primary" disabled={pending} data-testid="discussion-submit">
          {pending ? "Saving…" : discussionId ? "Save changes" : "Open the discussion"}
        </button>
      </div>
      {!discussionId && <p className="card__meta" style={{ marginTop: "0.75rem" }}>Council is emailed when it opens.</p>}
    </form>
  );
}
