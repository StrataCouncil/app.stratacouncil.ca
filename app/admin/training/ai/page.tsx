import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { AutoRefresh } from "@/components/AutoRefresh";
import { ImportForm } from "@/components/training/ImportForm";
import { getCurrentProfile } from "@/lib/data/profile";
import { importStatusLabels, isWorking, listLibrarySources, listTracksForImport, listTrainingImports } from "@/lib/data/training-imports";

/** Super Admin: build Council Training modules from documents with AI. */
export default async function TrainingAiPage() {
  const profile = await getCurrentProfile();
  if (!profile?.isSuperAdmin) notFound();
  const [imports, library, tracks] = await Promise.all([listTrainingImports(), listLibrarySources(), listTracksForImport()]);

  return (
    <AppShell active="admin">
      <div className="wrap page">
        <Link href="/admin/training" className="kb-article__back">
          &larr; Council Training
        </Link>
        <div className="page-header">
          <h1>AI module builder</h1>
          <p>
            Give it documents; it proposes modules, you review the breakdown, and it writes the ones you choose as drafts for
            you to edit and publish. Nothing reaches learners until you publish it.
          </p>
        </div>
        {imports.some((i) => isWorking(i.status)) && <AutoRefresh seconds={8} />}
        <ImportForm library={library} tracks={tracks} />

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
