"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { buildImport, deleteImport, retryImport, savePlan } from "@/app/admin/training/ai/actions";
import { TRACK_CODES, type ImportPlan, type PlannedModule, type TrackCode } from "@/lib/training/ai";

/**
 * Review the AI's breakdown before anything is written: which modules to
 * build, their titles, tracks, objectives and section outlines. Building
 * writes each chosen module as an unpublished, AI-drafted module.
 */
export function PlanReview({
  importId,
  initialPlan,
  status,
  trackTitles,
  pinned = false,
}: {
  importId: string;
  initialPlan: ImportPlan | null;
  status: string;
  trackTitles: Record<string, string>;
  /** A curriculum module's build: one module, its track fixed. */
  pinned?: boolean;
}) {
  const router = useRouter();
  const [plan, setPlan] = useState<ImportPlan | null>(initialPlan);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const building = status === "building";
  const editable = !building;

  function update(key: string, patch: Partial<PlannedModule>) {
    setPlan((p) => (p ? { ...p, modules: p.modules.map((m) => (m.key === key ? { ...m, ...patch } : m)) } : p));
    setDirty(true);
  }

  async function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, done?: string) {
    setBusy(true);
    setMessage(null);
    const r = await fn();
    setBusy(false);
    if (!r.ok) return setMessage(r.error);
    setDirty(false);
    if (done) setMessage(done);
    router.refresh();
  }

  const toBuild = plan?.modules.filter((m) => m.include && m.status !== "done").length ?? 0;

  return (
    <div className="plan-review">
      {plan && (
        <>
          {plan.summary && <p className="plan-review__summary">{plan.summary}</p>}
          {plan.modules.map((m, i) => (
            <section key={m.key} className="card plan-module" data-include={m.include} data-status={m.status ?? "pending"}>
              <div className="plan-module__head">
                <label className="be-check">
                  <input
                    type="checkbox"
                    checked={m.include}
                    disabled={!editable || m.status === "done" || pinned}
                    onChange={(e) => update(m.key, { include: e.target.checked })}
                  />
                  <span>Module {i + 1}</span>
                </label>
                <span className="plan-module__status">
                  {m.status === "done" && m.moduleId ? (
                    <Link href={`/admin/training/${m.moduleId}`} className="button button-secondary button-small">
                      Open in the builder
                    </Link>
                  ) : m.status === "building" ? (
                    <span className="pill">Writing…</span>
                  ) : m.status === "failed" ? (
                    <span className="pill pill--locked">Failed{m.error ? `: ${m.error}` : ""}</span>
                  ) : null}
                </span>
              </div>
              <div className="be-row">
                <label className="field be-grow">
                  <span>Title</span>
                  <input value={m.title} maxLength={200} disabled={!editable || m.status === "done" || pinned} onChange={(e) => update(m.key, { title: e.target.value })} />
                </label>
                <label className="field">
                  <span>Track</span>
                  <select
                    value={m.trackCode}
                    disabled={!editable || m.status === "done" || pinned}
                    onChange={(e) => update(m.key, { trackCode: e.target.value as TrackCode })}
                  >
                    {TRACK_CODES.map((c) => (
                      <option key={c} value={c}>
                        {trackTitles[c] ?? c}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field plan-module__minutes">
                  <span>Minutes</span>
                  <input
                    type="number"
                    min={5}
                    max={90}
                    value={m.estimatedMinutes}
                    disabled={!editable || m.status === "done"}
                    onChange={(e) => update(m.key, { estimatedMinutes: Number(e.target.value) || 15 })}
                  />
                </label>
              </div>
              <label className="field">
                <span>Summary</span>
                <textarea rows={2} value={m.summary} disabled={!editable || m.status === "done"} onChange={(e) => update(m.key, { summary: e.target.value })} />
              </label>
              <label className="field">
                <span>Learning objectives (one per line)</span>
                <textarea
                  rows={Math.max(3, m.objectives.length)}
                  value={m.objectives.join("\n")}
                  disabled={!editable || m.status === "done"}
                  onChange={(e) => update(m.key, { objectives: e.target.value.split("\n") })}
                />
              </label>
              <details className="plan-module__outline" open={m.status !== "done"}>
                <summary>
                  {m.sections.length} {m.sections.length === 1 ? "section" : "sections"}
                </summary>
                {m.sections.map((s, si) => (
                  <div key={si} className="plan-section">
                    <input
                      value={s.title}
                      maxLength={200}
                      aria-label={`Section ${si + 1} title`}
                      disabled={!editable || m.status === "done"}
                      onChange={(e) =>
                        update(m.key, { sections: m.sections.map((x, xi) => (xi === si ? { ...x, title: e.target.value } : x)) })
                      }
                    />
                    <textarea
                      rows={Math.max(2, s.keyPoints.length)}
                      aria-label={`Section ${si + 1} key points, one per line`}
                      value={s.keyPoints.join("\n")}
                      disabled={!editable || m.status === "done"}
                      onChange={(e) =>
                        update(m.key, {
                          sections: m.sections.map((x, xi) => (xi === si ? { ...x, keyPoints: e.target.value.split("\n") } : x)),
                        })
                      }
                    />
                    <label className="plan-section__approach">
                      <span>How it teaches</span>
                      <input
                        value={s.approach}
                        maxLength={500}
                        placeholder="e.g. Worked example, then practice: walk through one notice, then the learner checks another"
                        disabled={!editable || m.status === "done"}
                        onChange={(e) =>
                          update(m.key, { sections: m.sections.map((x, xi) => (xi === si ? { ...x, approach: e.target.value } : x)) })
                        }
                      />
                    </label>
                    {editable && m.status !== "done" && m.sections.length > 1 && (
                      <button
                        type="button"
                        className="text-action"
                        onClick={() => update(m.key, { sections: m.sections.filter((_, xi) => xi !== si) })}
                      >
                        Remove section
                      </button>
                    )}
                  </div>
                ))}
                {editable && m.status !== "done" && m.sections.length < 10 && (
                  <button
                    type="button"
                    className="text-action"
                    onClick={() => update(m.key, { sections: [...m.sections, { title: "New section", keyPoints: [], approach: "" }] })}
                  >
                    + Add section
                  </button>
                )}
              </details>
            </section>
          ))}
        </>
      )}

      {message && (
        <p className="form-alert" role="status">
          {message}
        </p>
      )}

      <div className="plan-review__actions">
        {plan && editable && (
          <>
            <button
              type="button"
              className="button button-primary"
              disabled={busy || toBuild === 0}
              onClick={() => run(() => buildImport(importId, plan))}
              data-testid="import-build"
            >
              {toBuild === 0 ? "Choose modules to build" : `Write ${toBuild} ${toBuild === 1 ? "module" : "modules"}`}
            </button>
            <button type="button" className="button button-secondary" disabled={busy || !dirty} onClick={() => run(() => savePlan(importId, plan), "Saved.")}>
              {dirty ? "Save changes" : "Saved"}
            </button>
          </>
        )}
        {(status === "failed" || status === "needs_text" || status === "not_readable") && (
          <button type="button" className="button button-secondary" disabled={busy} onClick={() => run(() => retryImport(importId))}>
            Try again
          </button>
        )}
        {!building && (
          <span className="plan-review__delete">
            {confirmDelete ? (
              <>
                <span className="card__meta">Delete this import? Modules it already wrote stay.</span>{" "}
                <button
                  type="button"
                  className="button button-danger button-small"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    const r = await deleteImport(importId);
                    if (r.ok) router.push("/admin/training/ai");
                    else {
                      setBusy(false);
                      setMessage(r.error);
                    }
                  }}
                >
                  Delete
                </button>{" "}
                <button type="button" className="text-action" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <button type="button" className="text-action" onClick={() => setConfirmDelete(true)}>
                Delete import
              </button>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
