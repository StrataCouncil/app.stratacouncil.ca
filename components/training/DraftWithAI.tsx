"use client";

import { useRef, useState } from "react";
import { searchCitations } from "@/app/admin/training/actions";
import { draftOutline, suggestSources, writeSlide, type SourceHit } from "@/app/admin/training/drafting-actions";
import { ELEMENT_TYPES, type OutlineElement, type OutlineSlide } from "@/lib/training/drafting";
import { elementLabels, newId, type Slide } from "@/lib/training/slides";

const elementName = (e: OutlineElement) => (e === "none" ? "Nothing" : elementLabels[e]);

/**
 * Draft slides with AI, in three steps the author controls:
 * 1. choose the Legislation Library sections to work from;
 * 2. get an outline, and edit it;
 * 3. write the slides, one at a time, each added after the existing slides
 *    and saved as it's made. Nothing existing is changed.
 */
export function DraftWithAI({
  moduleId,
  token,
  hasObjectives,
  onSlide,
}: {
  moduleId: string;
  token: string;
  hasObjectives: boolean;
  onSlide: (s: Slide) => void;
}) {
  const [step, setStep] = useState<"start" | "sources" | "outline" | "writing" | "done">("start");
  const [hits, setHits] = useState<SourceHit[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [outline, setOutline] = useState<OutlineSlide[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [next, setNext] = useState(0);
  const [flags, setFlags] = useState<{ title: string; problems: string[] }[]>([]);
  const stop = useRef(false);
  const chunkIds = hits.filter((h) => chosen.has(h.chunkId)).map((h) => h.chunkId);

  async function findSources() {
    setBusy("Searching the Legislation Library…");
    setError(null);
    const r = await suggestSources(moduleId);
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setHits(r.hits);
    setChosen(new Set(r.hits.map((h) => h.chunkId)));
    setStep("sources");
  }

  async function searchMore() {
    setBusy("Searching…");
    const r = await searchCitations(moduleId, query);
    setBusy(null);
    if (!r.ok) return setError(r.error);
    const fresh = r.hits.filter((h) => !hits.some((x) => x.chunkId === h.chunkId));
    setHits((hs) => [...hs, ...fresh]);
    setChosen((c) => new Set([...c, ...fresh.slice(0, 3).map((h) => h.chunkId)]));
    setQuery("");
  }

  async function plan() {
    setBusy("Planning the slides… (this can take a minute)");
    setError(null);
    const r = await draftOutline(moduleId, token, chunkIds);
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setOutline(r.outline);
    setNext(0);
    setFlags([]);
    setStep("outline");
  }

  async function write(from: number) {
    setStep("writing");
    setError(null);
    stop.current = false;
    for (let i = from; i < outline.length; i++) {
      if (stop.current) {
        setNext(i);
        setStep("outline");
        return;
      }
      setNext(i);
      setBusy(`Writing slide ${i + 1} of ${outline.length}: ${outline[i].title}`);
      const r = await writeSlide(moduleId, token, { chunkIds, outline, index: i });
      if (!r.ok) {
        setBusy(null);
        setError(`Stopped at slide ${i + 1}: ${r.error}`);
        setStep("outline");
        return;
      }
      onSlide(r.slide);
      if (r.problems.length) setFlags((f) => [...f, { title: r.slide.title, problems: r.problems }]);
    }
    setBusy(null);
    setNext(outline.length);
    setStep("done");
  }

  const set = (i: number, p: Partial<OutlineSlide>) => setOutline((o) => o.map((x, n) => (n === i ? { ...x, ...p } : x)));
  const move = (i: number, d: -1 | 1) =>
    setOutline((o) => {
      const j = i + d;
      if (j < 0 || j >= o.length) return o;
      const c = [...o];
      [c[i], c[j]] = [c[j], c[i]];
      return c;
    });

  return (
    <section className="builder__block" data-testid="draft-with-ai">
      <div className="builder__block-head">
        <span className="builder__block-type">Draft slides with AI</span>
      </div>
      <p className="card__meta">
        The AI works only from Legislation Library sections you approve, and only adds new slides after the ones already here. It never
        changes a slide that exists. Check every slide before publishing.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {step === "start" && (
        <button type="button" className="button button-primary button-small" disabled={!hasObjectives || Boolean(busy)} onClick={findSources}>
          {busy ?? (hasObjectives ? "Choose sources" : "Add objectives first")}
        </button>
      )}

      {step === "sources" && (
        <div className="be-stack">
          <p className="card__meta">
            Step 1 of 3: the sections to work from. Untick anything off-topic, or search for more. {chosen.size} chosen.
          </p>
          <ul className="builder__hits">
            {hits.map((h) => (
              <li key={h.chunkId}>
                <label className="be-check">
                  <input
                    type="checkbox"
                    checked={chosen.has(h.chunkId)}
                    onChange={(e) =>
                      setChosen((c) => {
                        const n = new Set(c);
                        if (e.target.checked) n.add(h.chunkId);
                        else n.delete(h.chunkId);
                        return n;
                      })
                    }
                  />
                  <span>
                    <strong>{h.label}</strong>
                    <span className="card__meta"> {h.snippet}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <form
            className="be-row"
            onSubmit={(e) => {
              e.preventDefault();
              void searchMore();
            }}
          >
            <input className="be-grow" value={query} maxLength={300} placeholder='Add more: a section number ("45") or words' onChange={(e) => setQuery(e.target.value)} />
            <button className="button button-secondary button-small" disabled={!query.trim() || Boolean(busy)}>
              Search
            </button>
          </form>
          <div className="be-row">
            <button type="button" className="button button-primary button-small" disabled={!chosen.size || Boolean(busy)} onClick={plan}>
              {busy ?? "Draft an outline"}
            </button>
          </div>
        </div>
      )}

      {(step === "outline" || step === "writing") && (
        <div className="be-stack">
          <p className="card__meta">
            Step 2 of 3: the outline. Edit, reorder or remove slides; nothing is created until you press Write.
          </p>
          <ol className="builder__outline-edit">
            {outline.map((o, i) => (
              <li key={o.id} data-done={i < next}>
                <div className="be-row">
                  <input className="be-grow" value={o.topic} maxLength={200} aria-label={`Slide ${i + 1} topic`} placeholder="Topic" disabled={step === "writing" || i < next} onChange={(e) => set(i, { topic: e.target.value })} />
                  <select value={o.element} aria-label={`Slide ${i + 1} activity`} disabled={step === "writing" || i < next} onChange={(e) => set(i, { element: e.target.value as OutlineElement })}>
                    {ELEMENT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {elementName(t)}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="be-icon" disabled={step === "writing" || i <= next} onClick={() => move(i, -1)} aria-label={`Move slide ${i + 1} up`}>
                    &uarr;
                  </button>
                  <button type="button" className="be-icon" disabled={step === "writing" || i < next || i === outline.length - 1} onClick={() => move(i, 1)} aria-label={`Move slide ${i + 1} down`}>
                    &darr;
                  </button>
                  <button type="button" className="be-icon be-icon--danger" disabled={step === "writing" || i < next} onClick={() => setOutline((x) => x.filter((_, n) => n !== i))} aria-label={`Remove slide ${i + 1}`}>
                    &times;
                  </button>
                </div>
                <input value={o.title} maxLength={200} aria-label={`Slide ${i + 1} title`} disabled={step === "writing" || i < next} onChange={(e) => set(i, { title: e.target.value })} />
                <textarea rows={2} value={o.point} maxLength={500} aria-label={`What slide ${i + 1} teaches`} disabled={step === "writing" || i < next} onChange={(e) => set(i, { point: e.target.value })} />
                {i < next && <span className="card__meta">Written</span>}
              </li>
            ))}
          </ol>
          {step === "outline" && (
            <button
              type="button"
              className="text-action"
              onClick={() => setOutline((o) => [...o, { id: newId("o"), topic: o[o.length - 1]?.topic ?? "", title: "", point: "", element: "none", sourceIds: [] }])}
            >
              + Add a slide to the outline
            </button>
          )}
          <div className="be-row">
            {step === "writing" ? (
              <>
                <span role="status">{busy}</span>
                <button type="button" className="text-action" onClick={() => (stop.current = true)}>
                  Stop after this slide
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="button button-primary button-small"
                  disabled={next >= outline.length || outline.slice(next).some((o) => !o.title.trim())}
                  onClick={() => write(next)}
                >
                  {next > 0 ? `Write the remaining ${outline.length - next} slides` : `Step 3: write ${outline.length} slides`}
                </button>
                <button type="button" className="text-action" onClick={() => setStep("sources")}>
                  Back to sources
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {step === "done" && (
        <div className="be-stack" role="status">
          <p>
            <strong>{outline.length} slides added</strong> after the existing ones. Add pictures, check every fact against its source, and make the
            narration when you&rsquo;re happy with the scripts.
          </p>
          {flags.length > 0 && (
            <>
              <p className="card__meta">These need a look:</p>
              <ul className="builder__problems">
                {flags.map((f) => (
                  <li key={f.title}>
                    {f.title}: {f.problems.join(" ")}
                  </li>
                ))}
              </ul>
            </>
          )}
          <button type="button" className="text-action" onClick={() => setStep("start")}>
            Draft more slides
          </button>
        </div>
      )}
    </section>
  );
}
