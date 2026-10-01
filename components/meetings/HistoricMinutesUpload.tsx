"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { DOCUMENTS_BUCKET } from "@/lib/documents";
import { createDocumentUploads } from "@/app/strata/[corpId]/documents/actions";
import { analyzeHistoricMinutes, saveHistoricMinutes, type ExtractedDecision, type HistoricAnalysis } from "@/app/strata/[corpId]/minutes/actions";
import type { UploadedFile } from "@/app/strata/[corpId]/documents/actions";

/**
 * Upload historic minutes: the file is checked against this strata's plan
 * number, its decisions are read out, and the uploader reviews them before
 * anything is saved. Only carried motions go into the decision ledger.
 */
export function HistoricMinutesUpload({ corpId, aiAvailable }: { corpId: string; aiAvailable: boolean }) {
  const router = useRouter();
  const [file, setFile] = useState<UploadedFile | null>(null);
  const [analysis, setAnalysis] = useState<HistoricAnalysis | null>(null);
  const [keep, setKeep] = useState<Record<number, boolean>>({});
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function choose(f: File | undefined) {
    if (!f) return;
    setError(null);
    setAnalysis(null);
    setBusy(true);
    try {
      setStatus("Uploading…");
      const tickets = await createDocumentUploads(corpId, [{ name: f.name, size: f.size }]);
      if (!tickets.ok) throw new Error(tickets.error);
      const t = tickets.tickets[0];
      const { error: upErr } = await createClient().storage.from(DOCUMENTS_BUCKET).uploadToSignedUrl(t.path, t.token, f, {
        contentType: f.type || "application/octet-stream",
      });
      if (upErr) throw new Error("The upload didn't finish.");
      const uploaded = { path: t.path, name: f.name, size: f.size, type: f.type };
      setStatus("Checking the strata plan number and reading the decisions…");
      const result = await analyzeHistoricMinutes(corpId, uploaded);
      if (!result.ok) throw new Error(result.error);
      setFile(uploaded);
      setAnalysis(result);
      setKeep(Object.fromEntries(result.decisions.map((d, i) => [i, d.outcome === "CARRIED"])));
      setStatus(null);
    } catch (err) {
      setStatus(null);
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!file || !analysis) return;
    setBusy(true);
    setError(null);
    const chosen = analysis.decisions.filter((_, i) => keep[i]);
    const result = await saveHistoricMinutes(corpId, file, { meetingDate: analysis.meetingDate, meetingType: analysis.meetingType }, chosen);
    setBusy(false);
    if (!result.ok) return setError(result.error);
    setStatus(`Saved. ${result.recorded} decision${result.recorded === 1 ? "" : "s"} added to the decision ledger.`);
    setFile(null);
    setAnalysis(null);
    router.refresh();
  }

  const update = (i: number, patch: Partial<ExtractedDecision>) =>
    setAnalysis((a) => (a ? { ...a, decisions: a.decisions.map((d, j) => (j === i ? { ...d, ...patch } : d)) } : a));

  return (
    <section className="card" style={{ marginBottom: "1.5rem" }} data-testid="historic-minutes">
      <h3>Upload historic minutes</h3>
      <p>
        Minutes from before your strata used StrataCouncil.ca. They&rsquo;re checked against your strata plan number, stored
        with your records and indexed, and the motions they carried are added to the decision ledger that Stratasphere&trade;
        draws on. Names are removed before the AI reads them.
      </p>
      {!analysis && (
        <label className={`button button-secondary${busy || !aiAvailable ? " button--disabled" : ""}`} style={{ alignSelf: "flex-start" }}>
          Choose minutes file
          <input
            type="file"
            accept=".pdf,.docx,.txt"
            className="visually-hidden"
            disabled={busy || !aiAvailable}
            onChange={(e) => {
              void choose(e.target.files?.[0]);
              e.target.value = "";
            }}
            data-testid="historic-minutes-file"
          />
        </label>
      )}
      {!aiAvailable && <p className="card__meta">Reading decisions out of minutes needs a Stratasphere&trade; subscription. You can still upload the file under Documents.</p>}
      {status && <p className="card__meta" role="status">{status}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}

      {analysis && (
        <div className="historic-review">
          <p>
            <strong>{analysis.planNumber} confirmed.</strong> {analysis.decisions.length} decision{analysis.decisions.length === 1 ? "" : "s"} found.
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
            <button type="button" className="button button-secondary" onClick={() => { setAnalysis(null); setFile(null); }} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="button button-primary" onClick={save} disabled={busy} data-testid="historic-minutes-save">
              {busy ? "Saving…" : "Save minutes and decisions"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
