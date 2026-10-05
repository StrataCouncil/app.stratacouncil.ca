import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ModulePlayer } from "@/components/training/ModulePlayer";
import { getPublishedModule, getTrainingTracks, moduleStatuses } from "@/lib/data/training";

export default async function ModulePage({ params }: { params: Promise<{ track: string; moduleId: string }> }) {
  const { track: slug, moduleId } = await params;
  const mod = await getPublishedModule(moduleId);
  if (!mod || mod.track.slug !== slug) notFound();
  const track = (await getTrainingTracks()).find((t) => t.id === mod.track.id);
  if (!track) notFound();
  const statuses = moduleStatuses(track);
  // Modules open in order; a locked one sends the learner back to the path.
  if (statuses.get(moduleId) === "locked") redirect(`/training/${slug}`);
  const nextModule = track.modules.find((m) => m.orderIndex > mod.module.orderIndex && m.publishedVersion > 0 && !m.completed) ?? null;

  return (
    <AppShell active="training">
      <ModulePlayer
        moduleId={mod.module.id}
        moduleTitle={mod.module.title}
        version={mod.version}
        content={mod.content}
        completedSectionIds={mod.progressVersion === mod.version || mod.module.completed ? mod.completedSectionIds : []}
        track={{ title: mod.track.title, slug: mod.track.slug }}
        nextModule={nextModule ? { id: nextModule.id, title: nextModule.title } : null}
      />
    </AppShell>
  );
}
