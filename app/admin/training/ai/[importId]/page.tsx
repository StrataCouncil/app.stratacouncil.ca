import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { AutoRefresh } from "@/components/AutoRefresh";
import { PlanReview } from "@/components/training/PlanReview";
import { getCurrentProfile } from "@/lib/data/profile";
import { getTrainingImport, importStatusLabels, isWorking, listTracksForImport } from "@/lib/data/training-imports";

/** One AI build: progress while it reads and writes, and the breakdown to review. */
export default async function TrainingImportPage({ params }: { params: Promise<{ importId: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile?.isSuperAdmin) notFound();
  const { importId } = await params;
  const [imp, tracks] = await Promise.all([getTrainingImport(importId), listTracksForImport()]);
  if (!imp) notFound();
  const working = isWorking(imp.status);
  const trackTitles = Object.fromEntries(tracks.map((t) => [t.code, t.title]));

  return (
    <AppShell active="admin">
      <div className="wrap page">
        <Link href="/admin/training/ai" className="kb-article__back">
          &larr; AI module builder
        </Link>
        <div className="page-header">
          <h1>{imp.title}</h1>
          <p className="card__meta">
            From{" "}
            {imp.referenceCount > 0 && `${imp.referenceCount} Legislation Library passage${imp.referenceCount === 1 ? "" : "s"}${imp.sources.length ? ", " : ""}`}
            {imp.sources.map((s, i) => (
              <span key={i}>
                {i > 0 && ", "}
                {s.kind === "upload" ? s.fileName : s.title}
              </span>
            ))}
          </p>
        </div>
        {working && <AutoRefresh seconds={6} />}

        <p className="import-status" data-status={imp.status} role="status">
          <strong>{importStatusLabels[imp.status]}.</strong>{" "}
          {imp.status === "reading" || imp.status === "queued"
            ? "Reading the documents and removing personal information."
            : imp.status === "planning"
              ? imp.moduleId
                ? "The AI is reading everything and planning this module's sections. This usually takes a minute or two."
                : "The AI is reading everything and breaking it into modules. This usually takes a minute or two."
              : imp.status === "planned"
                ? imp.moduleId
                  ? "Check the plan below: the sections and key points, and the objectives. Then write it."
                  : "Check the breakdown below: rename, change tracks, edit objectives and sections, or untick modules you don't want. Then write them."
                : imp.status === "building"
                  ? "Each section is written in turn, so a module takes a few minutes. You can leave this page; it carries on."
                  : imp.status === "built"
                    ? "Open each module in the builder to check it, add pictures and narration, and publish."
                    : imp.error}
        </p>

        <PlanReview importId={imp.id} initialPlan={imp.plan} status={imp.status} trackTitles={trackTitles} pinned={Boolean(imp.moduleId)} key={imp.updatedAt} />
      </div>
    </AppShell>
  );
}
