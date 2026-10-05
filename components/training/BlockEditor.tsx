"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { createMediaUpload } from "@/app/admin/training/actions";
import {
  calloutLabels,
  newId,
  ratingLabels,
  revealStyleLabels,
  videoSource,
  type Block,
  type CalloutVariant,
  type RevealStyle,
  type Slide,
  type ScenarioRating,
} from "@/lib/training/content";
import { RichTextEditor } from "@/components/training/RichTextEditor";

/** The editing form for one block. Every change goes straight to `onChange`. */
export function BlockEditor({ moduleId, block, onChange }: { moduleId: string; block: Block; onChange: (b: Block) => void }) {
  switch (block.type) {
    case "text":
      return <RichTextEditor value={block.doc} onChange={(doc) => onChange({ ...block, doc })} placeholder="Write here…" />;

    case "callout":
      return (
        <div className="be-stack">
          <div className="be-row">
            <label className="field">
              <span>Type</span>
              <select value={block.variant} onChange={(e) => onChange({ ...block, variant: e.target.value as CalloutVariant })}>
                {(Object.keys(calloutLabels) as CalloutVariant[]).map((v) => (
                  <option key={v} value={v}>
                    {calloutLabels[v]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field be-grow">
              <span>Title (optional)</span>
              <input value={block.title} maxLength={200} onChange={(e) => onChange({ ...block, title: e.target.value })} />
            </label>
          </div>
          <RichTextEditor minimal value={block.doc} onChange={(doc) => onChange({ ...block, doc })} />
          <label className="field">
            <span>Reference (optional)</span>
            <input
              value={block.reference}
              maxLength={200}
              placeholder="e.g. Strata Property Act, s. 45"
              onChange={(e) => onChange({ ...block, reference: e.target.value })}
            />
          </label>
        </div>
      );

    case "image":
      return (
        <div className="be-stack">
          <MediaField moduleId={moduleId} kind="image" value={block.src} onChange={(src) => onChange({ ...block, src })} />
          <label className="field">
            <span>Description for screen readers (alt text)</span>
            <input value={block.alt} maxLength={500} onChange={(e) => onChange({ ...block, alt: e.target.value })} />
          </label>
          <label className="field">
            <span>Caption (optional)</span>
            <input value={block.caption} maxLength={500} onChange={(e) => onChange({ ...block, caption: e.target.value })} />
          </label>
        </div>
      );

    case "slides":
      return (
        <div className="be-stack">
          {block.slides.length === 0 && <p className="card__meta">No slides yet. Add slides as images, e.g. exported from Keynote, PowerPoint or Canva.</p>}
          {block.slides.map((s, i) => {
            const set = (patch: Partial<Slide>) =>
              onChange({ ...block, slides: block.slides.map((x) => (x.id === s.id ? { ...x, ...patch } : x)) });
            return (
            <div key={s.id} className="be-item">
              <div className="be-item__head">
                <strong>Slide {i + 1}</strong>
                <ItemTools
                  index={i}
                  count={block.slides.length}
                  onMove={(d) => onChange({ ...block, slides: move(block.slides, i, d) })}
                  onRemove={() => onChange({ ...block, slides: block.slides.filter((x) => x.id !== s.id) })}
                />
              </div>
              <MediaField moduleId={moduleId}
                kind="image"
                value={s.src}
                onChange={(src) => onChange({ ...block, slides: block.slides.map((x) => (x.id === s.id ? { ...x, src } : x)) })}
              />
              <div className="be-row">
                <label className="field be-grow">
                  <span>Alt text</span>
                  <input
                    value={s.alt}
                    maxLength={500}
                    onChange={(e) => onChange({ ...block, slides: block.slides.map((x) => (x.id === s.id ? { ...x, alt: e.target.value } : x)) })}
                  />
                </label>
                <label className="field be-grow">
                  <span>Caption (optional)</span>
                  <input
                    value={s.caption}
                    maxLength={1000}
                    onChange={(e) =>
                      onChange({ ...block, slides: block.slides.map((x) => (x.id === s.id ? { ...x, caption: e.target.value } : x)) })
                    }
                  />
                </label>
              </div>
              <MediaField
                moduleId={moduleId}
                kind="audio"
                value={s.audio}
                label={s.audio ? "Narration added" : "Narration (optional): an MP3 or M4A that plays with this slide"}
                onChange={(audio) => set({ audio })}
                onClear={s.audio ? () => set({ audio: "" }) : undefined}
              />
              {s.audio && (
                <label className="field">
                  <span>Narration transcript (recommended, for accessibility)</span>
                  <textarea rows={3} value={s.transcript} onChange={(e) => set({ transcript: e.target.value })} />
                </label>
              )}
            </div>
            );
          })}
          <button
            type="button"
            className="text-action"
            onClick={() =>
              onChange({ ...block, slides: [...block.slides, { id: newId("s"), src: "", alt: "", caption: "", audio: "", transcript: "" }] })
            }
          >
            + Add slide
          </button>
        </div>
      );

    case "video": {
      const ok = videoSource(block.url);
      return (
        <div className="be-stack">
          <label className="field">
            <span>YouTube or Vimeo link</span>
            <input
              value={block.url}
              placeholder="https://www.youtube.com/watch?v=…"
              onChange={(e) => onChange({ ...block, url: e.target.value })}
            />
            {block.url && !ok && <span className="roster-table__warn">That isn&rsquo;t a YouTube, Vimeo or video file link.</span>}
          </label>
          <MediaField moduleId={moduleId} kind="video" value="" label="Or upload a video file (MP4, WebM or MOV, up to 500 MB)" onChange={(url) => onChange({ ...block, url })} />
          <label className="field">
            <span>Caption (optional)</span>
            <input value={block.caption} maxLength={500} onChange={(e) => onChange({ ...block, caption: e.target.value })} />
          </label>
          <label className="field">
            <span>Transcript (recommended, for accessibility)</span>
            <textarea rows={4} value={block.transcript} onChange={(e) => onChange({ ...block, transcript: e.target.value })} />
          </label>
        </div>
      );
    }

    case "audio":
      return (
        <div className="be-stack">
          <MediaField
            moduleId={moduleId}
            kind="audio"
            value={block.src}
            label={block.src ? "Audio added" : "MP3, M4A, WAV or OGG, up to 100 MB"}
            onChange={(src) => onChange({ ...block, src })}
          />
          {block.src && <audio src={block.src} controls preload="metadata" className="be-audio" />}
          <label className="field">
            <span>Title (optional)</span>
            <input value={block.title} maxLength={200} onChange={(e) => onChange({ ...block, title: e.target.value })} />
          </label>
          <label className="field">
            <span>Transcript (recommended, for accessibility)</span>
            <textarea rows={4} value={block.transcript} onChange={(e) => onChange({ ...block, transcript: e.target.value })} />
          </label>
        </div>
      );

    case "reveal":
      return (
        <div className="be-stack">
          <label className="field">
            <span>Style</span>
            <select value={block.style} onChange={(e) => onChange({ ...block, style: e.target.value as RevealStyle })}>
              {(Object.keys(revealStyleLabels) as RevealStyle[]).map((s) => (
                <option key={s} value={s}>
                  {revealStyleLabels[s]}
                </option>
              ))}
            </select>
          </label>
          {block.items.map((it, i) => (
            <div key={it.id} className="be-item">
              <div className="be-item__head">
                <strong>{block.style === "cards" ? `Card ${i + 1}` : `Section ${i + 1}`}</strong>
                <ItemTools
                  index={i}
                  count={block.items.length}
                  onMove={(d) => onChange({ ...block, items: move(block.items, i, d) })}
                  onRemove={block.items.length > 1 ? () => onChange({ ...block, items: block.items.filter((x) => x.id !== it.id) }) : undefined}
                />
              </div>
              <input
                value={it.title}
                maxLength={200}
                placeholder={block.style === "cards" ? "Front of the card, e.g. a term or question" : "Heading"}
                aria-label={`Heading ${i + 1}`}
                onChange={(e) => onChange({ ...block, items: block.items.map((x) => (x.id === it.id ? { ...x, title: e.target.value } : x)) })}
              />
              <textarea
                rows={3}
                value={it.body}
                maxLength={4000}
                placeholder={block.style === "cards" ? "Back of the card" : "What opens up when the learner clicks"}
                aria-label={`Text ${i + 1}`}
                onChange={(e) => onChange({ ...block, items: block.items.map((x) => (x.id === it.id ? { ...x, body: e.target.value } : x)) })}
              />
            </div>
          ))}
          {block.items.length < 20 && (
            <button
              type="button"
              className="text-action"
              onClick={() => onChange({ ...block, items: [...block.items, { id: newId("r"), title: "", body: "" }] })}
            >
              + Add {block.style === "cards" ? "card" : "section"}
            </button>
          )}
        </div>
      );

    case "summary":
      return (
        <div className="be-stack">
          <label className="field">
            <span>Heading</span>
            <input value={block.title} maxLength={200} placeholder="Summary" onChange={(e) => onChange({ ...block, title: e.target.value })} />
          </label>
          {block.points.map((pt, i) => (
            <div key={pt.id} className="be-row">
              <input
                className="be-grow"
                value={pt.text}
                maxLength={1000}
                placeholder={`Key point ${i + 1}`}
                aria-label={`Key point ${i + 1}`}
                onChange={(e) => onChange({ ...block, points: block.points.map((x) => (x.id === pt.id ? { ...x, text: e.target.value } : x)) })}
              />
              <ItemTools
                index={i}
                count={block.points.length}
                onMove={(d) => onChange({ ...block, points: move(block.points, i, d) })}
                onRemove={block.points.length > 1 ? () => onChange({ ...block, points: block.points.filter((x) => x.id !== pt.id) }) : undefined}
              />
            </div>
          ))}
          <button type="button" className="text-action" onClick={() => onChange({ ...block, points: [...block.points, { id: newId("p"), text: "" }] })}>
            + Add point
          </button>
        </div>
      );

    case "knowledge_check":
      return (
        <div className="be-stack">
          <label className="field">
            <span>Question</span>
            <input value={block.question} maxLength={1000} onChange={(e) => onChange({ ...block, question: e.target.value })} />
          </label>
          <div className="card__meta">
            Answers. Select the correct one. Under each answer, explain why it&rsquo;s right or wrong; learners see every explanation once they
            check their answer.
          </div>
          {block.options.map((o, i) => (
            <div key={o.id} className="be-item be-item--answer" data-correct={block.correctId === o.id}>
              <div className="be-row">
                <label className="be-correct" title="Correct answer">
                  <input type="radio" name={`${block.id}-correct`} checked={block.correctId === o.id} onChange={() => onChange({ ...block, correctId: o.id })} />
                  <span className="visually-hidden">Correct answer</span>
                </label>
                <input
                  className="be-grow"
                  value={o.text}
                  maxLength={500}
                  placeholder={`Answer ${i + 1}`}
                  aria-label={`Answer ${i + 1}`}
                  onChange={(e) => onChange({ ...block, options: block.options.map((x) => (x.id === o.id ? { ...x, text: e.target.value } : x)) })}
                />
                <ItemTools
                  index={i}
                  count={block.options.length}
                  onMove={(d) => onChange({ ...block, options: move(block.options, i, d) })}
                  onRemove={
                    block.options.length > 2
                      ? () => {
                          const options = block.options.filter((x) => x.id !== o.id);
                          onChange({ ...block, options, correctId: block.correctId === o.id ? options[0].id : block.correctId });
                        }
                      : undefined
                  }
                />
              </div>
              <input
                className="be-feedback"
                value={o.feedback}
                maxLength={1000}
                placeholder={block.correctId === o.id ? "Why this is the answer" : "Why this answer is wrong"}
                aria-label={`Feedback for answer ${i + 1}`}
                onChange={(e) => onChange({ ...block, options: block.options.map((x) => (x.id === o.id ? { ...x, feedback: e.target.value } : x)) })}
              />
            </div>
          ))}
          {block.options.length < 8 && (
            <button
              type="button"
              className="text-action"
              onClick={() => onChange({ ...block, options: [...block.options, { id: newId("o"), text: "", feedback: "" }] })}
            >
              + Add answer
            </button>
          )}
          <label className="field">
            <span>Explanation shown after answering (optional)</span>
            <textarea rows={2} value={block.explanation} onChange={(e) => onChange({ ...block, explanation: e.target.value })} />
          </label>
          <label className="field">
            <span>Study tip (optional)</span>
            <textarea rows={2} value={block.studyTip} maxLength={1000} onChange={(e) => onChange({ ...block, studyTip: e.target.value })} />
          </label>
          <label className="field">
            <span>Reference (optional)</span>
            <input
              value={block.reference}
              maxLength={300}
              placeholder="e.g. Strata Property Act, s. 18"
              onChange={(e) => onChange({ ...block, reference: e.target.value })}
            />
          </label>
        </div>
      );

    case "scenario":
      return (
        <div className="be-stack">
          <div className="card__meta">The situation</div>
          <RichTextEditor minimal value={block.situation} onChange={(situation) => onChange({ ...block, situation })} placeholder="Describe what's happening…" />
          <label className="field">
            <span>Prompt</span>
            <input value={block.prompt} maxLength={300} onChange={(e) => onChange({ ...block, prompt: e.target.value })} />
          </label>
          {block.choices.map((c, i) => (
            <div key={c.id} className="be-item">
              <div className="be-item__head">
                <strong>Response {i + 1}</strong>
                <ItemTools
                  index={i}
                  count={block.choices.length}
                  onMove={(d) => onChange({ ...block, choices: move(block.choices, i, d) })}
                  onRemove={block.choices.length > 2 ? () => onChange({ ...block, choices: block.choices.filter((x) => x.id !== c.id) }) : undefined}
                />
              </div>
              <div className="be-row">
                <input
                  className="be-grow"
                  value={c.text}
                  maxLength={500}
                  placeholder="What the learner could do"
                  aria-label={`Response ${i + 1}`}
                  onChange={(e) => onChange({ ...block, choices: block.choices.map((x) => (x.id === c.id ? { ...x, text: e.target.value } : x)) })}
                />
                <select
                  value={c.rating}
                  aria-label={`Response ${i + 1} rating`}
                  onChange={(e) =>
                    onChange({ ...block, choices: block.choices.map((x) => (x.id === c.id ? { ...x, rating: e.target.value as ScenarioRating } : x)) })
                  }
                >
                  {(Object.keys(ratingLabels) as ScenarioRating[]).map((r) => (
                    <option key={r} value={r}>
                      {ratingLabels[r]}
                    </option>
                  ))}
                </select>
              </div>
              <textarea
                rows={2}
                value={c.outcome}
                placeholder="What happens next, and why"
                aria-label={`Outcome of response ${i + 1}`}
                onChange={(e) => onChange({ ...block, choices: block.choices.map((x) => (x.id === c.id ? { ...x, outcome: e.target.value } : x)) })}
              />
            </div>
          ))}
          {block.choices.length < 6 && (
            <button
              type="button"
              className="text-action"
              onClick={() => onChange({ ...block, choices: [...block.choices, { id: newId("c"), text: "", outcome: "", rating: "okay" }] })}
            >
              + Add response
            </button>
          )}
        </div>
      );

    case "checklist":
      return (
        <div className="be-stack">
          <label className="field">
            <span>Title (optional)</span>
            <input value={block.title} maxLength={200} onChange={(e) => onChange({ ...block, title: e.target.value })} />
          </label>
          {block.items.map((it, i) => (
            <div key={it.id} className="be-row">
              <input
                className="be-grow"
                value={it.text}
                maxLength={500}
                placeholder={`Item ${i + 1}`}
                aria-label={`Item ${i + 1}`}
                onChange={(e) => onChange({ ...block, items: block.items.map((x) => (x.id === it.id ? { ...x, text: e.target.value } : x)) })}
              />
              <ItemTools
                index={i}
                count={block.items.length}
                onMove={(d) => onChange({ ...block, items: move(block.items, i, d) })}
                onRemove={block.items.length > 1 ? () => onChange({ ...block, items: block.items.filter((x) => x.id !== it.id) }) : undefined}
              />
            </div>
          ))}
          <button type="button" className="text-action" onClick={() => onChange({ ...block, items: [...block.items, { id: newId("i"), text: "" }] })}>
            + Add item
          </button>
        </div>
      );

    case "divider":
      return <p className="card__meta">A divider line between sections. Nothing to edit.</p>;
  }
}

function move<T>(list: T[], i: number, d: -1 | 1): T[] {
  const j = i + d;
  if (j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

function ItemTools({ index, count, onMove, onRemove }: { index: number; count: number; onMove: (d: -1 | 1) => void; onRemove?: () => void }) {
  return (
    <span className="be-tools">
      <button type="button" className="be-icon" onClick={() => onMove(-1)} disabled={index === 0} aria-label="Move up" title="Move up">
        &uarr;
      </button>
      <button type="button" className="be-icon" onClick={() => onMove(1)} disabled={index === count - 1} aria-label="Move down" title="Move down">
        &darr;
      </button>
      {onRemove && (
        <button type="button" className="be-icon be-icon--danger" onClick={onRemove} aria-label="Remove" title="Remove">
          &times;
        </button>
      )}
    </span>
  );
}

/** Upload an image or video to the training media bucket, or paste a link. */
function MediaField({
  moduleId,
  kind,
  value,
  onChange,
  onClear,
  label,
}: {
  moduleId: string;
  kind: "image" | "video" | "audio";
  value: string;
  onChange: (url: string) => void;
  onClear?: () => void;
  label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    const ticket = await createMediaUpload(moduleId, { type: file.type, size: file.size });
    if (!ticket.ok) {
      setBusy(false);
      return setError(ticket.error);
    }
    const { error: upErr } = await createClient()
      .storage.from("training-media")
      .uploadToSignedUrl(ticket.path, ticket.token, file, { contentType: file.type });
    setBusy(false);
    if (upErr) return setError("The upload didn't finish. Try again.");
    onChange(ticket.publicUrl);
  }

  return (
    <div className="be-media">
      {kind === "image" && value && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={value} alt="" className="be-media__thumb" />
      )}
      <div className="be-row">
        <button type="button" className="button button-secondary button-small" onClick={() => input.current?.click()} disabled={busy}>
          {busy ? "Uploading…" : `${value && kind !== "video" ? "Replace" : "Upload"} ${kind}`}
        </button>
        {label && <span className="card__meta">{label}</span>}
        {onClear && (
          <button type="button" className="text-action" onClick={onClear}>
            Remove
          </button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        hidden
        accept={
          kind === "image"
            ? "image/jpeg,image/png,image/webp,image/gif,image/svg+xml"
            : kind === "audio"
              ? "audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/x-wav,audio/ogg"
              : "video/mp4,video/webm,video/quicktime"
        }
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void upload(f);
        }}
      />
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}
