"use client";

import { useActionState, useEffect, useRef } from "react";
import { createAnnouncement, type AnnouncementResult } from "@/app/admin/announcements/actions";
import { announcementCategories } from "@/lib/announcement-categories";

/** Post an announcement to the home page and every strata's Overview (Super Admins). */
export function AnnouncementForm() {
  const [state, action, pending] = useActionState<AnnouncementResult | null, FormData>(createAnnouncement, null);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) form.current?.reset();
  }, [state]);

  return (
    <form ref={form} action={action} className="card announcement-form" data-testid="announcement-form">
      <h3>New announcement</h3>
      <label className="field">
        <span>Category</span>
        <select name="category" defaultValue="feature" data-testid="announcement-category">
          {Object.entries(announcementCategories).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Title</span>
        <input name="title" maxLength={120} required placeholder="Strata Property Act amendments now in force" />
      </label>
      <label className="field">
        <span>Text</span>
        <textarea name="body" maxLength={600} rows={3} required placeholder="One or two sentences. Up to 600 characters." />
      </label>
      <div className="field-grid">
        <label className="field">
          <span>Link (optional)</span>
          <input name="link_url" placeholder="https://… or /training" />
        </label>
        <label className="field">
          <span>Link text</span>
          <input name="link_label" maxLength={40} placeholder="Read more" />
        </label>
      </div>
      <div className="field-grid">
        <label className="field">
          <span>Who sees it</span>
          <select name="audience" defaultValue="everyone">
            <option value="everyone">Everyone</option>
            <option value="admins">Strata admins only</option>
          </select>
        </label>
        <label className="field">
          <span>Show until (optional)</span>
          <input name="expires_on" type="date" />
        </label>
      </div>
      {state && !state.ok && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}
      {state?.ok && (
        <p className="card__meta" role="status">
          Posted. It&rsquo;s on everyone&rsquo;s home page and every strata&rsquo;s Overview now.
        </p>
      )}
      <button type="submit" className="button button-primary" disabled={pending} style={{ alignSelf: "flex-start" }}>
        {pending ? "Posting…" : "Post announcement"}
      </button>
    </form>
  );
}
