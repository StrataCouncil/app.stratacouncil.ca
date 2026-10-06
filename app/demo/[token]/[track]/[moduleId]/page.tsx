import { notFound } from "next/navigation";
import { DemoShell } from "@/components/DemoShell";
import { ModulePlayer } from "@/components/training/ModulePlayer";
import { getDemoLink, getDemoModule } from "@/lib/data/training-demo";

/** A module through a demo link (0040): the learner's player, nothing saved, comments welcome. */
export default async function DemoModulePage({ params }: { params: Promise<{ token: string; track: string; moduleId: string }> }) {
  const { token, track: slug, moduleId } = await params;
  const link = await getDemoLink(token);
  if (!link) notFound();
  const found = await getDemoModule(link, moduleId);
  if (!found || found.track.slug !== slug) notFound();
  return (
    <DemoShell label={link.label}>
      <ModulePlayer
        moduleId={found.module.id}
        moduleTitle={found.module.title}
        version={found.module.publishedVersion}
        content={found.content}
        completedSectionIds={[]}
        track={{ title: found.track.title, slug: found.track.slug }}
        nextModule={found.next ? { id: found.next.id, title: found.next.title } : null}
        hrefBase={`/demo/${token}`}
        demo={{ token }}
      />
    </DemoShell>
  );
}

export const metadata = { robots: { index: false, follow: false } };
