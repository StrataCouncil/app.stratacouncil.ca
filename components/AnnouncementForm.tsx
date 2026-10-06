"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createAnnouncement, updateAnnouncement, type AnnouncementResult } from "@/app/admin/announcements/actions";
import { announcementCategories } from "@/lib/announcement-categories";
import type { Announcement } from "@/lib/data/announcements";

/** The date part of an end time, in British Columbia, for the date field. */
function bcDate(iso: string | null): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Vancouver", year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(iso)
  );
}

/**
 * Post an announcement, or edit one (Super Admins). Submitted by hand
 * rather than as a form action: React clears a form after its action
 * runs, which wiped the text even when posting failed. Here the fields
 * stay put until it's actually posted, and any failure says why.
 */
export function AnnouncementForm({ announcement, onDone }: { announcement?: Announcement; onDone?: () => void }) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [result, setResult] = useState<AnnouncementResult | null>(null);
  const [pending, startTransition] = useTransition();
  const editing = Boolean(announcement);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setResult(null);
    startTransition(async () => {
      let res: AnnouncementResult;
      try {
        res = announcement ? await updateAnnouncement(announcement.id, null, data) : await createAnnouncement(null, data);
      } catch {
        // Usually a page opened before the site was updated.
        res = { ok: false, error: "Couldn't reach the server. Refresh the page and try again." };
      }
      setResult(res);
      if (res.ok) {
        if (!editing) form.current?.reset();
        router.refresh();
        onDone?.();
      }
    });
  }

  const a = announcement;
  return (
    <form ref={form} onSubmit={submit} className="card announcement-form" data-testid={editing ? "announcement-edit-form" : "announcement-form"}>
      <h3>{editing ? "Edit announcement" : "New announcement"}</h3>
      <label className="field">
        <span>Category</span>
        <select name="category" defaultValue={a?.category ?? "feature"} data-testid="announcement-category">
          {Object.entries(announcementCategories).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Title</span>
        <input name="title" maxLength={120} required defaultValue={a?.title} placeholder="Strata Property Act amendments now in force" />
      </label>
      <label className="field">
        <span>Text</span>
        <textarea name="body" maxLength={600} rows={3} required defaultValue={a?.body} placeholder="One or two sentences. Up to 600 characters." />
      </label>
      <div className="field-grid">
        <label className="field">
          <span>Link (optional)</span>
          <input name="link_url" defaultValue={a?.linkUrl ?? ""} placeholder="https://… or /training" />
        </label>
        <label className="field">
          <span>Link text</span>
          <input name="link_label" maxLength={40} defaultValue={a?.linkLabel ?? ""} placeholder="Read more" />
        </label>
      </div>
      <fieldset className="field announcement-form__places">
        <span>Where it shows</span>
        <label className="checkbox-row">
          <input type="checkbox" name="show_on_home" defaultChecked={a ? a.showOnHome : true} data-testid="announcement-home" />
          Council Training page
        </label>
        <label className="checkbox-row">
          <input type="checkbox" name="show_on_overview" defaultChecked={a ? a.showOnOverview : true} data-testid="announcement-overview" />
          Stratasphere&trade; Overview (every strata)
        </label>
      </fieldset>
      <div className="field-grid">
        <label className="field">
          <span>Who sees it</span>
          <select name="audience" defaultValue={a?.audience ?? "everyone"}>
            <option value="everyone">Everyone</option>
            <option value="admins">Strata admins only</option>
          </select>
        </label>
        <label className="field">
          <span>Show until (optional)</span>
          <input name="expires_on" type="date" defaultValue={bcDate(a?.expiresAt ?? null)} />
        </label>
      </div>
      {result && !result.ok && (
        <p className="form-alert form-alert--error" role="alert" data-testid="announcement-error">
          {result.error}
        </p>
      )}
      {result?.ok && !editing && (
        <p className="form-alert form-alert--ok" role="status" data-testid="announcement-posted">
          Posted. It&rsquo;s in the list below and showing now.
        </p>
      )}
      <div className="role-editor__actions" style={{ justifyContent: "flex-start" }}>
        <button type="submit" className="button button-primary" disabled={pending}>
          {pending ? (editing ? "Saving…" : "Posting…") : editing ? "Save changes" : "Post announcement"}
        </button>
        {editing && (
          <button type="button" className="button button-secondary" onClick={onDone} disabled={pending}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
