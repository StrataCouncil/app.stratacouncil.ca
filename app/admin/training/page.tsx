import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { AdminTrainingList } from "@/components/training/AdminTrainingList";
import { getCurrentProfile } from "@/lib/data/profile";
import { getAdminTraining, getAllModuleAuthors } from "@/lib/data/training";

/** Super Admin: Council Training content, by track. */
export default async function AdminTrainingPage() {
  const profile = await getCurrentProfile();
  if (!profile?.isSuperAdmin) notFound();
  const [tracks, authors] = await Promise.all([getAdminTraining(), getAllModuleAuthors()]);
  const review = tracks.flatMap((t) => t.modules.filter((m) => m.readyForReview));

  return (
    <AppShell active="admin">
      <div className="wrap page">
        <Link href="/admin" className="kb-article__back">
          &larr; Super Admin console
        </Link>
        <div className="page-header">
          <h1>Council Training</h1>
          <p>
            Build modules from sections and screens, preview them as a learner, and publish. Learners only ever see published
            versions; your drafts autosave.
          </p>
        </div>
        {review.length > 0 && (
          <p className="sync-note" role="status" style={{ marginBottom: "1.25rem" }}>
            Ready for review: {review.map((m) => m.title).join(", ")}.
          </p>
        )}
        <AdminTrainingList tracks={tracks} authors={authors} />
      </div>
    </AppShell>
  );
}
