import { notFound } from "next/navigation";
import { ModuleBuilder } from "@/components/training/ModuleBuilder";
import { getCurrentProfile } from "@/lib/data/profile";
import { getModuleDraft } from "@/lib/data/training";

/** Super Admin: the Module Builder, full screen. */
export default async function AdminModuleBuilderPage({ params }: { params: Promise<{ moduleId: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile?.isSuperAdmin) notFound();
  const { moduleId } = await params;
  const draft = await getModuleDraft(moduleId);
  if (!draft) notFound();
  return (
    <ModuleBuilder
      module={{
        id: draft.id,
        title: draft.title,
        trackTitle: draft.track.title,
        publishedVersion: draft.publishedVersion,
        publishedAt: draft.publishedAt,
        draftUpdatedAt: draft.draftUpdatedAt,
        readyForReviewAt: draft.readyForReviewAt,
      }}
      initialContent={draft.content}
      canPublish
      backHref="/admin/training"
    />
  );
}
