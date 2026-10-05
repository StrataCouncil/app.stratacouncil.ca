"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnnouncementForm } from "@/components/AnnouncementForm";
import { deleteAnnouncement, endAnnouncement, restoreAnnouncement, type AnnouncementResult } from "@/app/admin/announcements/actions";
import { announcementCategories } from "@/lib/announcement-categories";
import type { Announcement } from "@/lib/data/announcements";

const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });

/** One posted announcement on the Super Admin page: edit, take down or show again, delete. */
export function AnnouncementAdminItem({ announcement: a, ended }: { announcement: Announcement; ended: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<AnnouncementResult>) {
    setError(null);
    startTransition(async () => {
      try {
        const res = await action();
        if (!res.ok) setError(res.error);
        else router.refresh();
      } catch {
        setError("Couldn't reach the server. Refresh the page and try again.");
      }
    });
  }

  if (editing) {
    return (
      <li>
        <AnnouncementForm announcement={a} onDone={() => setEditing(false)} />
      </li>
    );
  }

  const places = a.showOnHome && a.showOnOverview ? "Home and Overview" : a.showOnHome ? "Home only" : "Overview only";
  return (
    <li className="card" data-ended={ended} data-testid={`announcement-${a.id}`}>
      <div className="announcement-admin-list__head">
        <h3>{a.title}</h3>
        <span className={`pill${ended ? " pill--locked" : ""}`}>{ended ? "Ended" : "Showing"}</span>
      </div>
      <p>{a.body}</p>
      <p className="card__meta">
        {announcementCategories[a.category]} &middot; {places} &middot; {a.audience === "admins" ? "Strata admins only" : "Everyone"} &middot; Posted{" "}
        {fmt(a.publishedAt)}
        {a.expiresAt ? ` · ${ended ? "Ended" : "Until"} ${fmt(a.expiresAt)}` : ""}
        {a.linkUrl ? ` · Links to ${a.linkUrl}` : ""}
      </p>
      {error && (
        <p className="form-alert form-alert--error" role="alert">
          {error}
        </p>
      )}
      <div className="role-editor__actions" style={{ justifyContent: "flex-start" }}>
        <button type="button" className="button button-secondary button-small" onClick={() => setEditing(true)} disabled={pending}>
          Edit
        </button>
        {ended ? (
          <button type="button" className="button button-secondary button-small" onClick={() => run(() => restoreAnnouncement(a.id))} disabled={pending}>
            Show again
          </button>
        ) : (
          <button type="button" className="button button-secondary button-small" onClick={() => run(() => endAnnouncement(a.id))} disabled={pending}>
            Take down
          </button>
        )}
        <button
          type="button"
          className="button button-danger button-small"
          disabled={pending}
          onClick={() => {
            if (window.confirm(`Delete "${a.title}"? This can't be undone. "Take down" hides it but keeps it.`)) run(() => deleteAnnouncement(a.id));
          }}
        >
          Delete
        </button>
      </div>
    </li>
  );
}
