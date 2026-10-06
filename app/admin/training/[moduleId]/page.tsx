import { notFound } from "next/navigation";
import { ModuleBuilder } from "@/components/training/ModuleBuilder";
import { getCurrentProfile } from "@/lib/data/profile";
import { getDefaultVoice, getModuleDraft } from "@/lib/data/training";

/** Super Admin: the Module Builder, full screen. */
export default async function AdminModuleBuilderPage({ params }: { params: Promise<{ moduleId: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile?.isSuperAdmin) notFound();
  const { moduleId } = await params;
  const [draft, defaultVoice] = await Promise.all([getModuleDraft(moduleId), getDefaultVoice()]);
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
        aiDraftedFrom: draft.aiDraftedFrom,
        factCheck: draft.factCheck,
      }}
      initialContent={draft.content}
      defaultVoice={defaultVoice}
      canPublish
      backHref="/admin/training"
    />
  );
}
