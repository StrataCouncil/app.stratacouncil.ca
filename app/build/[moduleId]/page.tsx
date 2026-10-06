import { notFound } from "next/navigation";
import { ModuleBuilder } from "@/components/training/ModuleBuilder";
import { getCurrentProfile } from "@/lib/data/profile";
import { getModuleDraft } from "@/lib/data/training";

/** An author's builder. RLS only returns the draft if they're assigned. */
export default async function AuthorModuleBuilderPage({ params }: { params: Promise<{ moduleId: string }> }) {
  const { moduleId } = await params;
  const [profile, draft] = await Promise.all([getCurrentProfile(), getModuleDraft(moduleId)]);
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
      canPublish={Boolean(profile?.isSuperAdmin)}
      backHref="/build"
    />
  );
}
