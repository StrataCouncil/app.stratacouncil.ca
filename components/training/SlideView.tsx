"use client";

import { useState } from "react";
import { PhotoCreditLine } from "@/components/training/PhotoPicker";
import { bodyParts, videoSource, type Accordion, type FlipCards, type KnowledgeCheck, type PlayerSlide, type SlideElement } from "@/lib/training/slides";

/**
 * One slide as the learner sees it: its text (paragraphs and bullets), its
 * picture or video in the slide's layout, its interactive element and the
 * sections it relies on. The builder's preview renders the same component,
 * so what an author sees is what learners get. `onDone` fires once the
 * element is finished (question answered, every section or card opened).
 */
export function SlideView({ slide, onDone }: { slide: PlayerSlide; onDone?: () => void }) {
  const v = slide.visual;
  const layout = v ? (v.kind === "video" && slide.layout === "photo" ? "right" : slide.layout) : "text";
  const style = layout === "photo" && v ? { backgroundImage: `url("${v.url.replace(/"/g, "%22")}")` } : undefined;
  return (
    <div className="slide" data-layout={layout} style={style}>
      {layout === "photo" && v && <span className="visually-hidden">{v.alt}</span>}
      <div className="slide__content">
        <SlideText body={slide.body} />
        {slide.element && (
          <div className="slide__element">
            <ElementView element={slide.element} id={slide.id} onDone={onDone} />
          </div>
        )}
        {slide.citations.length > 0 && (
          <p className="slide__sources">
            <span>Source{slide.citations.length > 1 ? "s" : ""}:</span> {slide.citations.join("; ")}
          </p>
        )}
      </div>
      {v && layout !== "photo" && (
        <div className="slide__visual">
          {v.kind === "video" ? <Video url={v.url} title={v.alt || slide.title} /> : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={v.url} alt={v.alt} />
          )}
          <PhotoCreditLine credit={v.credit} />
        </div>
      )}
      {layout === "photo" && v?.credit && (
        <div className="slide__credit">
          <PhotoCreditLine credit={v.credit} />
        </div>
      )}
    </div>
  );
}

export function SlideText({ body }: { body: string }) {
  const parts = bodyParts(body);
  if (!parts.length) return null;
  return (
    <div className="slide__text">
      {parts.map((p, i) =>
        p.kind === "bullets" ? (
          <ul key={i}>
            {p.items.map((t, j) => (
              <li key={j}>{t}</li>
            ))}
          </ul>
        ) : (
          <p key={i}>{p.text}</p>
        )
      )}
    </div>
  );
}

function Video({ url, title }: { url: string; title: string }) {
  const src = videoSource(url);
  if (!src) return null;
  return src.kind === "embed" ? (
    <div className="slide__video">
      <iframe src={src.src} title={title || "Video"} allow="encrypted-media; picture-in-picture; fullscreen" allowFullScreen loading="lazy" />
    </div>
  ) : (
    <video src={src.src} controls preload="metadata" className="slide__video-file" />
  );
}

export function ElementView({ element, id, onDone }: { element: SlideElement; id: string; onDone?: () => void }) {
  switch (element.type) {
    case "knowledge_check":
      return <Check el={element} id={id} onDone={onDone} />;
    case "accordion":
      return <AccordionView el={element} onDone={onDone} />;
    case "flip_cards":
      return <Cards el={element} onDone={onDone} />;
  }
}

/** Opening every item finishes the element. */
function useSeen(ids: string[], onDone?: () => void) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [seen, setSeen] = useState<Set<string>>(new Set());
  function toggle(itemId: string) {
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(itemId)) n.delete(itemId);
      else n.add(itemId);
      return n;
    });
    if (seen.has(itemId)) return;
    const n = new Set(seen).add(itemId);
    setSeen(n);
    if (ids.every((i) => n.has(i))) onDone?.();
  }
  return { open, seen, toggle, left: ids.filter((i) => !seen.has(i)).length };
}

function AccordionView({ el, onDone }: { el: Accordion; onDone?: () => void }) {
  const items = el.items.filter((i) => i.title.trim() || i.body.trim());
  const { open, seen, toggle, left } = useSeen(items.map((i) => i.id), onDone);
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
      <p className="lesson-reveal__hint" aria-live="polite">
        {left === 0 ? "You've opened them all." : `Select each heading to learn more (${left} to go).`}
      </p>
    </div>
  );
}

function Cards({ el, onDone }: { el: FlipCards; onDone?: () => void }) {
  const items = el.items.filter((i) => i.front.trim() || i.back.trim());
  const { open, seen, toggle, left } = useSeen(items.map((i) => i.id), onDone);
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
            <span className="lesson-card__face">{open.has(i.id) ? i.back : i.front}</span>
            <span className="lesson-card__hint">{open.has(i.id) ? "Select to flip back" : "Select to reveal"}</span>
          </button>
        ))}
      </div>
      <p className="lesson-reveal__hint" aria-live="polite">
        {left === 0 ? "You've turned them all." : `Select each card to turn it over (${left} to go).`}
      </p>
    </div>
  );
}

const letter = (i: number) => String.fromCharCode(65 + i);

/** A practice question: one right answer, wrong answers that sound plausible. Not graded. */
function Check({ el, id, onDone }: { el: KnowledgeCheck; id: string; onDone?: () => void }) {
  const [chosen, setChosen] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const options = el.options.filter((o) => o.text.trim());
  const picked = options.findIndex((o) => o.id === chosen);
  const right = options.findIndex((o) => o.id === el.correctId);
  const correct = submitted && chosen === el.correctId;
  return (
    <section className="kc" data-state={submitted ? (correct ? "correct" : "incorrect") : "open"}>
      <header className="kc__head">
        <span className="kc__label">Knowledge check</span>
        {submitted && <span className="kc__badge">{correct ? "Correct" : "Not quite"}</span>}
      </header>
      <div className="kc__body">
        <p className="kc__question">{el.question || "Question"}</p>
        {!submitted ? (
          <fieldset className="kc__options">
            <legend className="visually-hidden">Choose one answer</legend>
            {options.map((o, i) => (
              <label key={o.id} className="kc__option" data-chosen={chosen === o.id}>
                <input type="radio" name={`kc-${id}`} checked={chosen === o.id} onChange={() => setChosen(o.id)} />
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
              Check my answer
            </button>
          </fieldset>
        ) : (
          <div role="status">
            <p className="kc__answer kc__answer--yours">
              <strong>Your answer ({letter(picked)}):</strong> {options[picked]?.text}
            </p>
            {!correct && right >= 0 && (
              <p className="kc__answer kc__answer--correct">
                <strong>The answer ({letter(right)}):</strong> {options[right].text}
              </p>
            )}
            {el.explanation && <p className="kc__explanation">{el.explanation}</p>}
          </div>
        )}
      </div>
    </section>
  );
}

export function Transcript({ text, label = "Transcript" }: { text: string; label?: string }) {
  return (
    <details className="lesson-video__transcript" open>
      <summary>{label}</summary>
      <div>{text}</div>
    </details>
  );
}
