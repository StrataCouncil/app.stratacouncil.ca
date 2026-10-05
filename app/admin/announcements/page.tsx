import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { AnnouncementForm } from "@/components/AnnouncementForm";
import { listAllAnnouncements } from "@/lib/data/announcements";
import { announcementCategories } from "@/lib/announcement-categories";
import { deleteAnnouncement, endAnnouncement } from "./actions";

/** Announcements on the home page and every strata's Overview (0028, 0031). Super Admins only. */
export default async function AnnouncementsPage() {
  const announcements = await listAllAnnouncements();
  if (!announcements) notFound();
  const now = Date.now();
  const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });

  return (
    <AppShell active="admin">
      <div className="wrap page">
        <p className="roster-table__meta" style={{ marginBottom: "0.5rem" }}>
          <Link href="/admin">Super Admin console</Link>
        </p>
        <div className="page-header">
          <h1>Announcements</h1>
          <p>
            News for every StrataCouncil.ca customer, subscribed or not: new features, changes, new or updated
            training, additions to the Library, legislation. Choose the Home page, every strata&rsquo;s Stratasphere&trade;
            Overview, or both. Home shows the newest three; Overview the newest five. Keep them short.
          </p>
        </div>

        <AnnouncementForm />

        <h2 style={{ margin: "2rem 0 1rem" }}>Posted</h2>
        {announcements.length === 0 ? (
          <p className="roster-notice">Nothing posted yet.</p>
        ) : (
          <ul className="announcement-admin-list" data-testid="announcement-list">
            {announcements.map((a) => {
              const ended = Boolean(a.expiresAt && new Date(a.expiresAt).getTime() <= now);
              return (
                <li key={a.id} className="card" data-ended={ended}>
                  <div className="announcement-admin-list__head">
                    <h3>{a.title}</h3>
                    <span className={`pill${ended ? " pill--locked" : ""}`}>{ended ? "Ended" : "Showing"}</span>
                  </div>
                  <p>{a.body}</p>
                  <p className="card__meta">
                    {announcementCategories[a.category]} &middot;{" "}
                    {a.showOnHome && a.showOnOverview ? "Home and Overview" : a.showOnHome ? "Home only" : "Overview only"} &middot;{" "}
                    {a.audience === "admins" ? "Strata admins only" : "Everyone"} &middot; Posted {fmt(a.publishedAt)}
                    {a.expiresAt ? ` · ${ended ? "Ended" : "Until"} ${fmt(a.expiresAt)}` : ""}
                    {a.linkUrl ? ` · Links to ${a.linkUrl}` : ""}
                  </p>
                  <div className="role-editor__actions" style={{ justifyContent: "flex-start" }}>
                    {!ended && (
                      <form action={endAnnouncement.bind(null, a.id)}>
                        <button className="button button-secondary button-small">Take down</button>
                      </form>
                    )}
                    <form action={deleteAnnouncement.bind(null, a.id)}>
                      <button className="button button-danger button-small">Delete</button>
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
