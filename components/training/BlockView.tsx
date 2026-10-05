"use client";

import { useState } from "react";
import { calloutLabels, ratingLabels, videoSource, type Block } from "@/lib/training/content";
import { RichText } from "@/components/training/RichText";

/**
 * One block as the learner sees it. The builder's preview renders the
 * same component, so what an author sees is exactly what learners get.
 * `onDone` fires once a block that the screen waits on is finished: a
 * knowledge check or scenario answered, every click-to-reveal item opened.
 */
export function BlockView({ block, onDone }: { block: Block; onDone?: () => void }) {
  switch (block.type) {
    case "text":
      return <RichText doc={block.doc} />;
    case "callout":
      return (
        <aside className="lesson-callout" data-variant={block.variant}>
          <div className="lesson-callout__label">{calloutLabels[block.variant]}</div>
          {block.title && <div className="lesson-callout__title">{block.title}</div>}
          <RichText doc={block.doc} />
          {block.reference && <div className="lesson-callout__ref">{block.reference}</div>}
        </aside>
      );
    case "image":
      if (!block.src) return <Missing what="image" />;
      return (
        <figure className="lesson-figure">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={block.src} alt={block.alt} loading="lazy" />
          {block.caption && <figcaption>{block.caption}</figcaption>}
        </figure>
      );
    case "slides":
      return <Slides block={block} />;
    case "video":
      return <Video block={block} />;
    case "audio":
      if (!block.src) return <Missing what="audio" />;
      return (
        <figure className="lesson-audio">
          {block.title && <figcaption className="lesson-audio__title">{block.title}</figcaption>}
          <audio src={block.src} controls preload="metadata" />
          <Transcript text={block.transcript} />
        </figure>
      );
    case "reveal":
      return <Reveal block={block} onDone={onDone} />;
    case "summary":
      return (
        <section className="lesson-summary">
          <div className="lesson-summary__title">{block.title || "Summary"}</div>
          <ul>
            {block.points
              .filter((p) => p.text.trim())
              .map((p) => (
                <li key={p.id}>{p.text}</li>
              ))}
          </ul>
        </section>
      );
    case "table":
      return <Table block={block} />;
    case "features":
      return (
        <div className="lesson-features" data-count={block.items.length}>
          {block.items
            .filter((i) => i.image || i.title.trim() || i.text.trim())
            .map((i) => (
              <div key={i.id} className="lesson-feature">
                {i.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={i.image} alt="" loading="lazy" />
                )}
                {i.title && <div className="lesson-feature__title">{i.title}</div>}
                {i.text && <p>{i.text}</p>}
              </div>
            ))}
        </div>
      );
    case "gallery":
      if (!block.images.some((i) => i.src)) return <Missing what="pictures" />;
      return (
        <div className="lesson-gallery">
          {block.images
            .filter((i) => i.src)
            .map((i) => (
              <figure key={i.id}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={i.src} alt={i.alt} loading="lazy" />
                {i.caption && <figcaption>{i.caption}</figcaption>}
              </figure>
            ))}
        </div>
      );
    case "knowledge_check":
      return <KnowledgeCheck block={block} onDone={onDone} />;
    case "scenario":
      return <Scenario block={block} onDone={onDone} />;
    case "checklist":
      return <Checklist block={block} />;
    case "divider":
      return <hr className="lesson-divider" />;
  }
}

function Missing({ what }: { what: string }) {
  return <div className="lesson-missing">No {what} added yet.</div>;
}

export function Transcript({ text, label = "Transcript" }: { text: string; label?: string }) {
  if (!text.trim()) return null;
  return (
    <details className="lesson-video__transcript">
      <summary>{label}</summary>
      <div>{text}</div>
    </details>
  );
}

function Slides({ block }: { block: Extract<Block, { type: "slides" }> }) {
  const [i, setI] = useState(0);
  const slides = block.slides.filter((s) => s.src);
  if (slides.length === 0) return <Missing what="slides" />;
  const at = Math.min(i, slides.length - 1);
  const s = slides[at];
  return (
    <figure className="lesson-slides" aria-roledescription="carousel">
      <div className="lesson-slides__frame">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={s.src} alt={s.alt} />
      </div>
      {s.caption && <figcaption>{s.caption}</figcaption>}
      {s.audio && (
        <div className="lesson-slides__narration">
          {/* Remount per slide so each slide's narration starts from the top. */}
          <audio key={s.id} src={s.audio} controls preload="metadata" aria-label={`Narration for slide ${at + 1}`} />
          <Transcript text={s.transcript} />
        </div>
      )}
      <div className="lesson-slides__nav">
        <button type="button" className="text-action" onClick={() => setI(at - 1)} disabled={at === 0}>
          &larr; Previous
        </button>
        <span className="card__meta" aria-live="polite">
          {at + 1} of {slides.length}
        </span>
        <button type="button" className="text-action" onClick={() => setI(at + 1)} disabled={at === slides.length - 1}>
          Next &rarr;
        </button>
      </div>
    </figure>
  );
}

function Video({ block }: { block: Extract<Block, { type: "video" }> }) {
  const source = videoSource(block.url);
  if (!source) return <Missing what="video" />;
  return (
    <figure className="lesson-video">
      <div className="lesson-video__frame">
        {source.kind === "embed" ? (
          <iframe
            src={source.src}
            title={block.caption || "Lesson video"}
            allow="fullscreen; picture-in-picture; encrypted-media"
            allowFullScreen
            loading="lazy"
          />
        ) : (
          <video src={source.src} controls preload="metadata" />
        )}
      </div>
      {block.caption && <figcaption>{block.caption}</figcaption>}
      <Transcript text={block.transcript} />
    </figure>
  );
}

function Table({ block }: { block: Extract<Block, { type: "table" }> }) {
  const rows = block.rows.filter((r) => r.some((c) => c.trim()));
  if (rows.length === 0) return <Missing what="table" />;
  const head = block.header ? rows[0] : null;
  const body = block.header ? rows.slice(1) : rows;
  return (
    <div className="lesson-table">
      <table>
        {block.caption && <caption>{block.caption}</caption>}
        {head && (
          <thead>
            <tr>
              {head.map((c, i) => (
                <th key={i} scope="col">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {body.map((r, ri) => (
            <tr key={ri}>
              {r.map((c, ci) => (
                <td key={ci}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Reveal({ block, onDone }: { block: Extract<Block, { type: "reveal" }>; onDone?: () => void }) {
  const items = block.items.filter((i) => i.title.trim() || i.body.trim());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [seen, setSeen] = useState<Set<string>>(new Set());
  function toggle(id: string) {
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
    if (seen.has(id)) return;
    const n = new Set(seen).add(id);
    setSeen(n);
    if (items.every((i) => n.has(i.id))) onDone?.();
  }
  if (items.length === 0) return <Missing what="items" />;
  const left = items.filter((i) => !seen.has(i.id)).length;
  const hint = (
    <p className="lesson-reveal__hint" aria-live="polite">
      {left === 0 ? "You've opened them all." : `Select each ${block.style === "cards" ? "card" : "heading"} to learn more (${left} to go).`}
    </p>
  );

  if (block.style === "cards") {
    return (
      <div>
        <div className="lesson-cards">
          {items.map((i) => (
            <button
              key={i.id}
              type="button"
              className="lesson-card"
              data-flipped={open.has(i.id)}
              data-seen={seen.has(i.id)}
              aria-pressed={open.has(i.id)}
              onClick={() => toggle(i.id)}
            >
              <span className="lesson-card__face">{open.has(i.id) ? i.body : i.title}</span>
              <span className="lesson-card__hint">{open.has(i.id) ? "Select to flip back" : "Select to reveal"}</span>
            </button>
          ))}
        </div>
        {hint}
      </div>
    );
  }
  return (
    <div>
      <div className="lesson-accordion">
        {items.map((i) => (
          <div key={i.id} className="lesson-accordion__item" data-open={open.has(i.id)} data-seen={seen.has(i.id)}>
            <button type="button" aria-expanded={open.has(i.id)} onClick={() => toggle(i.id)}>
              <span>{i.title}</span>
              <span aria-hidden="true">{open.has(i.id) ? "−" : "+"}</span>
            </button>
            {open.has(i.id) && <div className="lesson-accordion__body">{i.body}</div>}
          </div>
        ))}
      </div>
      {hint}
    </div>
  );
}

const letter = (i: number) => String.fromCharCode(65 + i);

/**
 * A practice question. Once answered, the learner sees their answer, the
 * correct one, why each option is right or wrong, a study note and the
 * reference. Not graded, and any answer lets them move on.
 */
function KnowledgeCheck({ block, onDone }: { block: Extract<Block, { type: "knowledge_check" }>; onDone?: () => void }) {
  const [chosen, setChosen] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const options = block.options.filter((o) => o.text.trim());
  const pickedIndex = options.findIndex((o) => o.id === chosen);
  const correctIndex = options.findIndex((o) => o.id === block.correctId);
  const correct = submitted && chosen === block.correctId;
  const why = options.map((o, i) => ({ ...o, i })).filter((o) => o.feedback.trim());

  return (
    <section className="kc" data-state={submitted ? (correct ? "correct" : "incorrect") : "open"}>
      <header className="kc__head">
        <span className="kc__label">Knowledge check</span>
        {submitted && <span className="kc__badge">{correct ? "Correct" : "Incorrect"}</span>}
      </header>
      <div className="kc__body">
        <p className="kc__question">{block.question || "Question"}</p>
        {!submitted ? (
          <fieldset className="kc__options">
            <legend className="visually-hidden">Choose one answer</legend>
            {options.map((o, i) => (
              <label key={o.id} className="kc__option" data-chosen={chosen === o.id}>
                <input type="radio" name={block.id} checked={chosen === o.id} onChange={() => setChosen(o.id)} />
                <span className="kc__letter">{letter(i)}</span>
                <span>{o.text}</span>
              </label>
            ))}
            <button
              type="button"
              className="button button-primary"
              disabled={!chosen}
              onClick={() => {
                setSubmitted(true);
                onDone?.();
              }}
            >
              Submit
            </button>
          </fieldset>
        ) : (
          <div role="status">
            <p className="kc__answer kc__answer--yours">
              <strong>Your answer ({letter(pickedIndex)}):</strong> {options[pickedIndex]?.text}
            </p>
            {!correct && correctIndex >= 0 && (
              <p className="kc__answer kc__answer--correct">
                <strong>Correct answer ({letter(correctIndex)}):</strong> {options[correctIndex].text}
              </p>
            )}
            {block.explanation && <p className="kc__explanation">{block.explanation}</p>}
            {why.length > 0 && (
              <ul className="kc__why">
                {why.map((o) => (
                  <li key={o.id} data-correct={o.id === block.correctId}>
                    <strong>
                      ({letter(o.i)}) {o.id === block.correctId ? "Correct" : "Incorrect"}.
                    </strong>{" "}
                    {o.feedback}
                  </li>
                ))}
              </ul>
            )}
            {block.studyTip && (
              <div className="kc__note">
                <div className="kc__note-label">Study note</div>
                <p>{block.studyTip}</p>
              </div>
            )}
            {block.reference && <span className="kc__ref">{block.reference}</span>}
          </div>
        )}
      </div>
    </section>
  );
}

function Scenario({ block, onDone }: { block: Extract<Block, { type: "scenario" }>; onDone?: () => void }) {
  const [chosen, setChosen] = useState<string | null>(null);
  const choices = block.choices.filter((c) => c.text.trim());
  const picked = choices.find((c) => c.id === chosen);
  return (
    <section className="lesson-scenario">
      <div className="lesson-scenario__label">Scenario</div>
      <RichText doc={block.situation} />
      <div className="lesson-scenario__prompt">{block.prompt || "What do you do?"}</div>
      <div className="lesson-scenario__choices">
        {choices.map((c) => (
          <button
            key={c.id}
            type="button"
            className="lesson-choice"
            data-chosen={chosen === c.id}
            data-rating={chosen ? c.rating : undefined}
            onClick={() => {
              if (!chosen) onDone?.();
              setChosen(c.id);
            }}
          >
            {c.text}
          </button>
        ))}
      </div>
      {picked && (
        <div className="lesson-scenario__outcome" data-rating={picked.rating} role="status">
          <span className="lesson-rating" data-rating={picked.rating}>
            {ratingLabels[picked.rating]}
          </span>
          <p>{picked.outcome}</p>
          <span className="card__meta">You can pick another response to see how it would play out.</span>
        </div>
      )}
    </section>
  );
}

function Checklist({ block }: { block: Extract<Block, { type: "checklist" }> }) {
  const [done, setDone] = useState<Set<string>>(new Set());
  const items = block.items.filter((i) => i.text.trim());
  return (
    <section className="lesson-checklist">
      {block.title && <div className="lesson-checklist__title">{block.title}</div>}
      <ul>
        {items.map((i) => (
          <li key={i.id}>
            <label>
              <input
                type="checkbox"
                checked={done.has(i.id)}
                onChange={() =>
                  setDone((d) => {
                    const n = new Set(d);
                    if (n.has(i.id)) n.delete(i.id);
                    else n.add(i.id);
                    return n;
                  })
                }
              />
              <span>{i.text}</span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}
