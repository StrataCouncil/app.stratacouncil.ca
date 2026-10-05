import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ModulePlayer } from "@/components/training/ModulePlayer";
import { getPublishedModule, getTrainingTracks } from "@/lib/data/training";

export default async function ModulePage({ params }: { params: Promise<{ track: string; moduleId: string }> }) {
  const { track: slug, moduleId } = await params;
  const mod = await getPublishedModule(moduleId);
  if (!mod || mod.track.slug !== slug) notFound();
  const track = (await getTrainingTracks()).find((t) => t.id === mod.track.id);
  const nextModule = track?.modules.find((m) => m.orderIndex > mod.module.orderIndex && m.publishedVersion > 0 && !m.completed) ?? null;

  return (
    <AppShell active="training">
      <ModulePlayer
        moduleId={mod.module.id}
        moduleTitle={mod.module.title}
        version={mod.version}
        content={mod.content}
        completedLessonIds={mod.progressVersion === mod.version || mod.module.completed ? mod.completedLessonIds : []}
        track={{ title: mod.track.title, slug: mod.track.slug }}
        nextModule={nextModule ? { id: nextModule.id, title: nextModule.title } : null}
      />
    </AppShell>
  );
}
