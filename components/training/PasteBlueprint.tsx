"use client";

import { useState } from "react";
import { applyPastedBlueprint } from "@/app/admin/training/actions";
import { readPastedBlueprint } from "@/app/admin/training/drafting-actions";
import { PASTE_MAX_CHARS, type PastedBlueprint } from "@/lib/training/drafting";
import { bloomLabels, elementLabels } from "@/lib/training/slides";

/**
 * Paste an outline written elsewhere and turn it into this module's
 * settings: title, summary, length, objectives, blueprint and further
 * reading. The AI only reorganizes the outline; the author sees the
 * result before anything changes. Applying replaces those settings and
 * deletes every slide, so Create slides starts from the new blueprint.
 */
export function PasteBlueprint({
  moduleId,
  token,
  slideCount,
  beforeRead,
  onApplied,
  onError,
}: {
  moduleId: string;
  token: string;
  slideCount: number;
  /** Saves any settings still waiting, so nothing queued lands on top of the new ones. */
  beforeRead: () => Promise<boolean>;
  onApplied: () => Promise<void>;
  onError: (e: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [result, setResult] = useState<PastedBlueprint | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function read() {
    setBusy("Reading the outline… (this can take a minute)");
    setError(null);
    await beforeRead();
    const r = await readPastedBlueprint(moduleId, token, text);
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setResult(r.blueprint);
  }

  async function apply() {
    if (!result) return;
    if (slideCount > 0 && !window.confirm(`Replace this module's settings and delete all ${slideCount} slides, with their pictures and narration? This can't be undone. Learners' published version isn't affected.`)) return;
    setBusy("Applying…");
    setError(null);
    await beforeRead();
    const r = await applyPastedBlueprint(moduleId, token, result);
    if (!r.ok) {
      setBusy(null);
      return r.error.startsWith("You're not editing") ? onError(r.error) : setError(r.error);
    }
    await onApplied();
    setBusy(null);
    setResult(null);
    setText("");
    setDone(true);
  }

  return (
    <section className="builder__block" data-testid="paste-blueprint">
      <div className="builder__block-head">
        <span className="builder__block-type">Paste a blueprint</span>
      </div>
      <p className="card__meta">
        Paste a module outline written elsewhere. The AI sorts it into this module&rsquo;s title, summary, objectives (at most three),
        blueprint and further reading, without adding anything. You see the result before anything changes.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {done && !open && (
        <p role="status">
          <strong>Blueprint applied.</strong> Check the settings above, then use Create slides below.
        </p>
      )}

      {!open && (
        <div className="be-row">
          <button
            type="button"
            className="button button-secondary button-small"
            onClick={() => {
              setOpen(true);
              setDone(false);
            }}
          >
            Paste blueprint
          </button>
        </div>
      )}

      {open && !result && (
        <div className="be-stack">
          <textarea
            rows={14}
            value={text}
            maxLength={PASTE_MAX_CHARS}
            aria-label="The outline"
            placeholder="Paste the whole outline: title, objectives, sections, wrap-up and knowledge check."
            onChange={(e) => setText(e.target.value)}
            data-testid="paste-blueprint-text"
          />
          <div className="be-row">
            <button type="button" className="button button-primary button-small" disabled={text.trim().length < 40 || Boolean(busy)} onClick={read}>
              {busy ?? "Read the outline"}
            </button>
            <button type="button" className="text-action" disabled={Boolean(busy)} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {open && result && (
        <div className="be-stack" data-testid="paste-blueprint-preview">
          <p>
            <strong>{result.title}</strong>
            {result.estimatedMinutes ? ` (about ${result.estimatedMinutes} minutes)` : ""}
          </p>
          {result.summary && <p className="card__meta">{result.summary}</p>}

          <p className="card__meta">
            <strong>Objectives</strong>
          </p>
          <ol>
            {result.objectives.map((o, i) => (
              <li key={i}>
                {o.text} <span className="card__meta">({bloomLabels[o.bloom]})</span>
              </li>
            ))}
          </ol>
          {result.originalObjectives.length > result.objectives.length && (
            <p className="card__meta">
              The outline had {result.originalObjectives.length} objectives; they&rsquo;re merged into {result.objectives.length}. The
              originals: {result.originalObjectives.join(" / ")}
            </p>
          )}

          <p className="card__meta">
            <strong>Blueprint: {result.blueprint.length} steps</strong>
          </p>
          <ol>
            {result.blueprint.map((b, i) => (
              <li key={i}>
                <strong>{b.topic}</strong> <span className="card__meta">({b.activity === "none" ? "Slides only" : elementLabels[b.activity]})</span>
                <span className="card__meta"> {b.teach.length > 220 ? `${b.teach.slice(0, 220)}…` : b.teach}</span>
              </li>
            ))}
          </ol>

          {result.furtherReading.length > 0 && (
            <>
              <p className="card__meta">
                <strong>Further reading</strong>
              </p>
              <ul>
                {result.furtherReading.map((r, i) => (
                  <li key={i}>
                    {r.title}
                    {r.url ? <span className="card__meta"> {r.url}</span> : <span className="card__meta"> (no link yet)</span>}
                  </li>
                ))}
              </ul>
            </>
          )}

          <p className="form-error">
            Applying replaces the title, summary, length, objectives, blueprint and further reading
            {slideCount > 0 ? `, and deletes all ${slideCount} slides` : ""}.
          </p>
          <div className="be-row">
            <button type="button" className="button button-primary button-small" disabled={Boolean(busy)} onClick={apply} data-testid="paste-blueprint-apply">
              {busy ?? "Apply"}
            </button>
            <button type="button" className="text-action" disabled={Boolean(busy)} onClick={() => setResult(null)}>
              Back to the outline
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
