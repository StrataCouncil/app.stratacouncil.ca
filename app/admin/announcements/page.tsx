import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { AnnouncementForm } from "@/components/AnnouncementForm";
import { listAllAnnouncements } from "@/lib/data/announcements";
import { AnnouncementAdminItem } from "@/components/AnnouncementAdminItem";

/** Announcements on the Home page and/or every strata's Overview (0028, 0031, 0032). Super Admins only. */
export default async function AnnouncementsPage() {
  const list = await listAllAnnouncements();
  if (!list) notFound();
  const { announcements, error } = list;
  const now = Date.now();

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
        {error ? (
          <p className="form-alert form-alert--error" role="alert">
            Couldn&rsquo;t load the announcements: {error}
          </p>
        ) : announcements.length === 0 ? (
          <p className="roster-notice">Nothing posted yet.</p>
        ) : (
          <ul className="announcement-admin-list" data-testid="announcement-list">
            {announcements.map((a) => (
              <AnnouncementAdminItem key={a.id} announcement={a} ended={Boolean(a.expiresAt && new Date(a.expiresAt).getTime() <= now)} />
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
