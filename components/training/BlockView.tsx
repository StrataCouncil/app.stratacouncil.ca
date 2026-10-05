"use client";

import { useState } from "react";
import {
  calloutLabels,
  ratingLabels,
  videoSource,
  type Block,
} from "@/lib/training/content";
import { RichText } from "@/components/training/RichText";

/**
 * One block as the learner sees it. The builder's preview renders the
 * same component, so what an author sees is exactly what learners get.
 * `onAnswered` fires the first time a knowledge check or scenario is
 * answered (the lesson's Continue waits on those).
 */
export function BlockView({ block, onAnswered }: { block: Block; onAnswered?: () => void }) {
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
      return <Reveal block={block} />;
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
    case "knowledge_check":
      return <KnowledgeCheck block={block} onAnswered={onAnswered} />;
    case "scenario":
      return <Scenario block={block} onAnswered={onAnswered} />;
    case "checklist":
      return <Checklist block={block} />;
    case "divider":
      return <hr className="lesson-divider" />;
  }
}

function Missing({ what }: { what: string }) {
  return <div className="lesson-missing">No {what} added yet.</div>;
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

function Transcript({ text }: { text: string }) {
  if (!text.trim()) return null;
  return (
    <details className="lesson-video__transcript">
      <summary>Transcript</summary>
      <div>{text}</div>
    </details>
  );
}

function Reveal({ block }: { block: Extract<Block, { type: "reveal" }> }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const items = block.items.filter((i) => i.title.trim() || i.body.trim());
  const toggle = (id: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  if (items.length === 0) return <Missing what="items" />;

  if (block.style === "cards") {
    return (
      <div className="lesson-cards">
        {items.map((i) => (
          <button key={i.id} type="button" className="lesson-card" data-flipped={open.has(i.id)} aria-pressed={open.has(i.id)} onClick={() => toggle(i.id)}>
            <span className="lesson-card__face">{open.has(i.id) ? i.body : i.title}</span>
            <span className="lesson-card__hint">{open.has(i.id) ? "Click to flip back" : "Click to reveal"}</span>
          </button>
        ))}
      </div>
    );
  }
  return (
    <div className="lesson-accordion">
      {items.map((i) => (
        <div key={i.id} className="lesson-accordion__item" data-open={open.has(i.id)}>
          <button type="button" aria-expanded={open.has(i.id)} onClick={() => toggle(i.id)}>
            <span>{i.title}</span>
            <span aria-hidden="true">{open.has(i.id) ? "−" : "+"}</span>
          </button>
          {open.has(i.id) && <div className="lesson-accordion__body">{i.body}</div>}
        </div>
      ))}
    </div>
  );
}

function KnowledgeCheck({ block, onAnswered }: { block: Extract<Block, { type: "knowledge_check" }>; onAnswered?: () => void }) {
  const [chosen, setChosen] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const options = block.options.filter((o) => o.text.trim());
  const picked = options.find((o) => o.id === chosen);
  const correct = submitted && chosen === block.correctId;

  return (
    <fieldset className="lesson-check" data-state={submitted ? (correct ? "correct" : "incorrect") : "open"}>
      <legend className="lesson-check__label">Knowledge check</legend>
      <div className="lesson-check__question">{block.question || "Question"}</div>
      <div className="lesson-check__options">
        {options.map((o) => (
          <label key={o.id} className="lesson-option" data-chosen={chosen === o.id} data-correct={submitted && o.id === block.correctId}>
            <input
              type="radio"
              name={block.id}
              checked={chosen === o.id}
              disabled={submitted}
              onChange={() => setChosen(o.id)}
            />
            {o.text}
          </label>
        ))}
      </div>
      {!submitted ? (
        <button
          type="button"
          className="button button-primary button-small"
          disabled={!chosen}
          onClick={() => {
            setSubmitted(true);
            onAnswered?.();
          }}
        >
          Check answer
        </button>
      ) : (
        <div className="lesson-check__result" role="status">
          <strong>{correct ? "Correct." : "Not quite."}</strong>
          {block.explanation && <p>{block.explanation}</p>}
          <ul className="lesson-check__answers">
            {options.map((o) => (
              <li key={o.id} data-correct={o.id === block.correctId} data-chosen={o.id === picked?.id}>
                <span className="lesson-check__answer">
                  {o.id === block.correctId ? "Answer: " : ""}
                  {o.text}
                </span>
                {o.feedback && <span className="lesson-check__why">{o.feedback}</span>}
              </li>
            ))}
          </ul>
          {block.studyTip && (
            <p className="lesson-check__tip">
              <strong>Study tip.</strong> {block.studyTip}
            </p>
          )}
          {block.reference && <p className="lesson-check__ref">{block.reference}</p>}
          {!correct && (
            <button
              type="button"
              className="text-action"
              onClick={() => {
                setSubmitted(false);
                setChosen(null);
              }}
            >
              Try again
            </button>
          )}
        </div>
      )}
    </fieldset>
  );
}

function Scenario({ block, onAnswered }: { block: Extract<Block, { type: "scenario" }>; onAnswered?: () => void }) {
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
              if (!chosen) onAnswered?.();
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
