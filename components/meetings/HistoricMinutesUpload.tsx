"use client";

import { useState } from "react";
import { useOptionalStrata } from "@/components/StrataContext";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { DOCUMENTS_BUCKET } from "@/lib/documents";
import { createDocumentUploads } from "@/app/strata/[corpId]/documents/actions";
import { analyzeHistoricMinutes, saveHistoricMinutes, type ExtractedDecision, type HistoricAnalysis } from "@/app/strata/[corpId]/minutes/actions";
import type { UploadedFile } from "@/app/strata/[corpId]/documents/actions";

/**
 * Upload historic minutes: each file is checked against this strata's plan
 * number, its decisions are read out, and the uploader reviews them before
 * anything is saved. Only carried motions go into the decision ledger.
 *
 * Several files at once (note 7, 2026-10-05): they upload and are read one
 * after another in the background, and are reviewed one at a time, each
 * saved or skipped. Each is indexed on its own, as with a single file.
 */
type QueueItem = {
  id: number;
  name: string;
  state: "waiting" | "reading" | "ready" | "failed" | "saved" | "skipped";
  file?: UploadedFile;
  analysis?: HistoricAnalysis;
  message?: string;
};

const MAX_MINUTES_FILES = 10;

export function HistoricMinutesUpload({ corpId, aiAvailable }: { corpId: string; aiAvailable: boolean }) {
  const router = useRouter();
  const subscriptionPending = useOptionalStrata()?.pending ?? false;
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [keep, setKeep] = useState<Record<number, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const setItem = (id: number, patch: Partial<QueueItem>) =>
    setQueue((q) => q.map((it) => (it.id === id ? { ...it, ...patch } : it)));

  const reading = queue.some((it) => it.state === "waiting" || it.state === "reading");
  const current = queue.find((it) => it.state === "ready");
  const analysis = current?.analysis ?? null;

  async function readOne(item: QueueItem, f: File) {
    setItem(item.id, { state: "reading" });
    try {
      const tickets = await createDocumentUploads(corpId, [{ name: f.name, size: f.size }]);
      if (!tickets.ok) throw new Error(tickets.error);
      const t = tickets.tickets[0];
      const { error: upErr } = await createClient().storage.from(DOCUMENTS_BUCKET).uploadToSignedUrl(t.path, t.token, f, {
        contentType: f.type || "application/octet-stream",
      });
      if (upErr) throw new Error("The upload didn't finish.");
      const uploaded = { path: t.path, name: f.name, size: f.size, type: f.type };
      const result = await analyzeHistoricMinutes(corpId, uploaded);
      if (!result.ok) throw new Error(result.error);
      setItem(item.id, { state: "ready", file: uploaded, analysis: result });
    } catch (err) {
      setItem(item.id, { state: "failed", message: err instanceof Error ? err.message : "Something went wrong." });
    }
  }

  async function choose(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (files.length === 0) return;
    setError(files.length > MAX_MINUTES_FILES ? `Up to ${MAX_MINUTES_FILES} files at a time; the first ${MAX_MINUTES_FILES} are being read.` : null);
    const start = Date.now();
    const items: QueueItem[] = files.slice(0, MAX_MINUTES_FILES).map((f, i) => ({ id: start + i, name: f.name, state: "waiting" }));
    setQueue(items);
    // One after another: each file is read by the AI on its own.
    for (let i = 0; i < items.length; i++) await readOne(items[i], files[i]);
  }

  // A newly reviewed file starts with its carried motions ticked.
  const [keepFor, setKeepFor] = useState<number | null>(null);
  if (current && keepFor !== current.id) {
    setKeepFor(current.id);
    setKeep(Object.fromEntries((current.analysis?.decisions ?? []).map((d, i) => [i, d.outcome === "CARRIED"])));
  }

  async function save() {
    if (!current?.file || !analysis) return;
    setSaving(true);
    setError(null);
    const chosen = analysis.decisions.filter((_, i) => keep[i]);
    const result = await saveHistoricMinutes(corpId, current.file, { meetingDate: analysis.meetingDate, meetingType: analysis.meetingType }, chosen);
    setSaving(false);
    if (!result.ok) return setError(result.error);
    setItem(current.id, { state: "saved", message: `${result.recorded} decision${result.recorded === 1 ? "" : "s"} added to the ledger.` });
    router.refresh();
  }

  function skip() {
    if (current) setItem(current.id, { state: "skipped", message: "Skipped, not saved." });
  }

  const setAnalysis = (next: HistoricAnalysis) => current && setItem(current.id, { analysis: next });
  const update = (i: number, patch: Partial<ExtractedDecision>) =>
    analysis && setAnalysis({ ...analysis, decisions: analysis.decisions.map((d, j) => (j === i ? { ...d, ...patch } : d)) });
  const busy = reading || saving;

  return (
    <section className="card" style={{ marginBottom: "1.5rem" }} data-testid="historic-minutes">
      <h3>Upload historic minutes</h3>
      <p>
        Minutes from before your strata used StrataCouncil.ca. They&rsquo;re checked against your strata plan number, stored
        with your records and indexed, and the motions they carried are added to the decision ledger that Stratasphere&trade;
        draws on. Names are removed before the AI reads them.
      </p>
      {!analysis && !reading && (
        <label className={`button button-secondary${!aiAvailable ? " button--disabled" : ""}`} style={{ alignSelf: "flex-start" }}>
          Choose minutes files
          <input
            type="file"
            accept=".pdf,.docx,.txt"
            multiple
            className="visually-hidden"
            disabled={!aiAvailable}
            onChange={(e) => {
              void choose(e.target.files);
              e.target.value = "";
            }}
            data-testid="historic-minutes-file"
          />
        </label>
      )}
      {!aiAvailable && (
        <p className="card__meta">
          {subscriptionPending
            ? "Reading decisions out of minutes unlocks once your Stratasphere™ subscription goes through (it's pending). You can still upload the file under Documents."
            : "Reading decisions out of minutes needs a Stratasphere™ subscription. You can still upload the file under Documents."}
        </p>
      )}
      {queue.length > 0 && (
        <ul className="historic-queue" data-testid="historic-queue">
          {queue.map((it) => (
            <li key={it.id} data-state={it.state} data-current={it.id === current?.id}>
              <span className="historic-queue__name">{it.name}</span>
              <span className="historic-queue__state">
                {it.state === "waiting"
                  ? "Waiting"
                  : it.state === "reading"
                    ? "Checking the plan number and reading the decisions…"
                    : it.state === "ready"
                      ? it.id === current?.id
                        ? "Reviewing below"
                        : "Ready to review"
                      : it.message}
              </span>
            </li>
          ))}
        </ul>
      )}
      {queue.length > 0 && !reading && !current && (
        <p className="card__meta" role="status">
          All {queue.length} done.{" "}
          <button type="button" className="link-button" onClick={() => setQueue([])}>
            Upload more
          </button>
        </p>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}

      {analysis && (
        <div className="historic-review">
          <p>
            {queue.length > 1 && (
              <span className="pill" style={{ marginRight: "0.5rem" }}>
                File {queue.findIndex((it) => it.id === current?.id) + 1} of {queue.length}
              </span>
            )}
            <strong>{current?.name}: {analysis.planNumber} confirmed.</strong> {analysis.decisions.length} decision{analysis.decisions.length === 1 ? "" : "s"} found.
            Check them, then save. Only carried motions go into the ledger.
          </p>
          <div className="field-grid">
            <label className="field">
              <span>Meeting date</span>
              <input type="date" value={analysis.meetingDate} onChange={(e) => setAnalysis({ ...analysis, meetingDate: e.target.value })} />
            </label>
            <label className="field">
              <span>Meeting type</span>
              <select value={analysis.meetingType} onChange={(e) => setAnalysis({ ...analysis, meetingType: e.target.value })}>
                <option value="">Not stated</option>
                <option value="council">Council meeting</option>
                <option value="agm">AGM</option>
                <option value="sgm">SGM</option>
                <option value="committee">Committee meeting</option>
              </select>
            </label>
          </div>
          <ul className="historic-review__list">
            {analysis.decisions.map((d, i) => (
              <li key={i} data-outcome={d.outcome}>
                <label className="historic-review__keep">
                  <input type="checkbox" checked={Boolean(keep[i])} disabled={d.outcome !== "CARRIED"} onChange={(e) => setKeep({ ...keep, [i]: e.target.checked })} />
                  <span className="pill">{d.outcome}</span>
                </label>
                <div>
                  <input className="historic-review__title" value={d.title} onChange={(e) => update(i, { title: e.target.value })} aria-label="Decision title" />
                  <p className="card__meta">{d.summary}</p>
                  {(d.mover || d.votesFor) && (
                    <p className="card__meta">
                      {d.mover ? `Moved ${d.mover}${d.seconder ? `, seconded ${d.seconder}` : ""}. ` : ""}
                      {d.votesFor ? `${d.votesFor} for / ${d.votesAgainst || 0} against / ${d.votesAbstain || 0} abstain` : ""}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <div className="role-editor__actions">
            <button type="button" className="button button-secondary" onClick={skip} disabled={saving} data-testid="historic-minutes-skip">
              {queue.length > 1 ? "Skip this file" : "Cancel"}
            </button>
            <button type="button" className="button button-primary" onClick={save} disabled={saving} data-testid="historic-minutes-save">
              {saving ? "Saving…" : "Save minutes and decisions"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
