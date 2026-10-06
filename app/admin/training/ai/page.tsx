import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { AutoRefresh } from "@/components/AutoRefresh";
import { ImportForm } from "@/components/training/ImportForm";
import { getCurrentProfile } from "@/lib/data/profile";
import { getBuildTarget, importStatusLabels, isWorking, listLibrarySources, listTracksForImport, listTrainingImports } from "@/lib/data/training-imports";

/** Super Admin: build Council Training modules from documents with AI. */
export default async function TrainingAiPage({ searchParams }: { searchParams: Promise<{ module?: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile?.isSuperAdmin) notFound();
  const { module: moduleId } = await searchParams;
  const [imports, library, tracks, target] = await Promise.all([
    listTrainingImports(),
    listLibrarySources(),
    listTracksForImport(),
    moduleId && /^[0-9a-f-]{36}$/i.test(moduleId) ? getBuildTarget(moduleId) : Promise.resolve(null),
  ]);

  return (
    <AppShell active="admin">
      <div className="wrap page">
        <Link href={target ? `/admin/training/${target.id}` : "/admin/training"} className="kb-article__back">
          &larr; {target ? target.title : "Council Training"}
        </Link>
        <div className="page-header">
          <h1>AI module builder</h1>
          <p>
            Give it reference documents and it writes modules as drafts for you to edit and publish. Best used from a module
            in the curriculum (its Module settings has &ldquo;Build with AI&rdquo;), so the module keeps its place and objectives.
            Nothing reaches learners until you publish it.
          </p>
        </div>
        {imports.some((i) => isWorking(i.status)) && <AutoRefresh seconds={8} />}
        <ImportForm library={library} tracks={tracks} target={target} key={target?.id ?? "free"} />

        {imports.length > 0 && (
          <section className="import-list">
            <h2>Earlier builds</h2>
            <ul>
              {imports.map((i) => {
                const done = i.plan?.modules.filter((m) => m.status === "done").length ?? 0;
                return (
                  <li key={i.id}>
                    <Link href={`/admin/training/ai/${i.id}`}>{i.title}</Link>
                    <span className="card__meta">
                      {importStatusLabels[i.status]}
                      {i.plan ? ` · ${i.plan.modules.length} proposed, ${done} written` : ""} &middot;{" "}
                      {new Date(i.createdAt).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
    </AppShell>
  );
}
