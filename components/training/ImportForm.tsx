"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { createImportUpload, findModuleReferences, startImport, type FoundReference, type ImportSource } from "@/app/admin/training/ai/actions";
import { TRAINING_IMPORT_BUCKET } from "@/lib/training/ai";
import type { BuildTarget } from "@/lib/data/training-imports";

type Picked = { key: string; kind: "upload"; file: File } | { key: string; kind: "library"; id: string; title: string };

/**
 * Start an AI build: one to five documents (uploaded files and/or
 * Legislation library entries), an optional track, and notes for the AI.
 * With a target, it writes that curriculum module instead of proposing
 * new ones.
 */
export function ImportForm({
  library,
  tracks,
  target,
}: {
  library: { id: string; title: string; kind: string }[];
  tracks: { id: string; title: string }[];
  target?: BuildTarget | null;
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [references, setReferences] = useState<string[]>([]);
  const [libraryChoice, setLibraryChoice] = useState("");
  const [title, setTitle] = useState("");
  const [trackId, setTrackId] = useState("");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const full = picked.length >= 5;

  function addFiles(files: FileList | null) {
    if (!files) return;
    const next = [...picked];
    for (const f of Array.from(files)) {
      if (next.length >= 5) break;
      next.push({ key: `${f.name}-${f.size}-${Math.random()}`, kind: "upload", file: f });
    }
    setPicked(next);
  }

  async function start() {
    setError(null);
    if (!picked.length && !references.length) return setError(target ? "Choose some library passages or add a document." : "Add at least one document.");
    const sources: ImportSource[] = [];
    try {
      for (const p of picked) {
        if (p.kind === "library") {
          sources.push({ kind: "library", legislationId: p.id });
          continue;
        }
        setBusy(`Uploading ${p.file.name}…`);
        const ticket = await createImportUpload({ name: p.file.name, size: p.file.size });
        if (!ticket.ok) throw new Error(ticket.error);
        const { error: upErr } = await createClient()
          .storage.from(TRAINING_IMPORT_BUCKET)
          .uploadToSignedUrl(ticket.path, ticket.token, p.file, { contentType: p.file.type || undefined });
        if (upErr) throw new Error(`${p.file.name} didn't finish uploading. Try again.`);
        sources.push({ kind: "upload", path: ticket.path, fileName: p.file.name, mimeType: p.file.type });
      }
      setBusy("Starting…");
      const r = await startImport({ sources, title, trackId: trackId || null, instructions, moduleId: target?.id ?? null, referenceIds: references });
      if (!r.ok) throw new Error(r.error);
      router.push(`/admin/training/ai/${r.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
      setBusy(null);
    }
  }

  return (
    <section className="card import-form" data-testid="import-form">
      {target ? (
        <>
          <h2>Build &ldquo;{target.title}&rdquo;</h2>
          <p className="card__meta">
            {target.trackTitle} &middot; {target.estimatedMinutes ?? 12} minutes. Add the reference documents for this module. The
            AI plans its sections to the objectives below, you review the plan, then it writes the module as a draft. Personal
            information is removed before the AI sees anything.
            {target.hasSections && " Building replaces the module's current sections."}
          </p>
          {target.objectives.length > 0 && (
            <ul className="import-form__objectives">
              {target.objectives.map((o) => (
                <li key={o}>{o}</li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          <h2>Build modules from documents</h2>
          <p className="card__meta">
            Add one to five documents on a topic. The AI reads them, proposes modules for you to review, then writes the ones you
            choose as drafts. Personal information is removed before the AI sees anything.
          </p>
        </>
      )}

      {target && <ReferencePicker moduleId={target.id} chosen={references} onChange={setReferences} disabled={Boolean(busy)} />}

      {target && <h3 className="import-form__subhead">Other documents (optional)</h3>}
      <div className="import-form__sources">
        {picked.length === 0 && <p className="card__meta">{target ? "None added. Add a whole library entry or upload a file if the passages above miss something." : "No documents yet."}</p>}
        {picked.map((p) => (
          <div key={p.key} className="import-form__source">
            <span>
              {p.kind === "upload" ? p.file.name : p.title}
              <span className="card__meta"> &middot; {p.kind === "upload" ? "upload" : "Legislation library"}</span>
            </span>
            <button
              type="button"
              className="text-action"
              onClick={() => setPicked(picked.filter((x) => x.key !== p.key))}
              disabled={Boolean(busy)}
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      <div className="import-form__add">
        <button
          type="button"
          className="button button-secondary button-small"
          onClick={() => fileInput.current?.click()}
          disabled={full || Boolean(busy)}
        >
          Upload files
        </button>
        <span className="card__meta">PDF, Word, HTML or text, up to 50 MB each</span>
        <input
          ref={fileInput}
          type="file"
          hidden
          multiple
          accept=".pdf,.docx,.txt,.html,.htm"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      {library.length > 0 && (
        <div className="import-form__add">
          <select
            value={libraryChoice}
            onChange={(e) => setLibraryChoice(e.target.value)}
            aria-label="Legislation library entry"
            disabled={full || Boolean(busy)}
          >
            <option value="">Or choose from the Legislation library…</option>
            {library
              .filter((l) => !picked.some((p) => p.kind === "library" && p.id === l.id))
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title}
                </option>
              ))}
          </select>
          <button
            type="button"
            className="button button-secondary button-small"
            disabled={!libraryChoice || full || Boolean(busy)}
            onClick={() => {
              const l = library.find((x) => x.id === libraryChoice);
              if (l) setPicked([...picked, { key: l.id, kind: "library", id: l.id, title: l.title }]);
              setLibraryChoice("");
            }}
          >
            Add
          </button>
        </div>
      )}

      <div className="import-form__fields">
        {!target && (
          <label className="field">
            <span>Name (optional)</span>
            <input
              value={title}
              maxLength={200}
              placeholder="e.g. What a strata corporation is"
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
        )}
        {!target && (
          <label className="field">
            <span>Track</span>
            <select value={trackId} onChange={(e) => setTrackId(e.target.value)}>
              <option value="">Let the AI suggest a track for each module</option>
              {tracks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field import-form__notes">
          <span>Notes for the AI (optional)</span>
          <textarea
            rows={3}
            maxLength={2000}
            value={instructions}
            placeholder="e.g. Aim at first-year council members. Keep it to one module. Use examples from small self-managed stratas."
            onChange={(e) => setInstructions(e.target.value)}
          />
        </label>
      </div>

      {error && (
        <p className="form-alert" role="alert">
          {error}
        </p>
      )}
      <div className="text-actions">
        <button
          type="button"
          className="button button-primary"
          onClick={start}
          disabled={Boolean(busy) || (picked.length === 0 && references.length === 0)}
          data-testid="import-start"
        >
          {busy ?? (target ? "Read and plan this module" : "Read and propose modules")}
        </button>
      </div>
    </section>
  );
}

const KIND_LABEL = { act: "Act", regulation: "Regulation", guidance: "Guidance" } as const;
const PRESELECT = 20;

/**
 * The Legislation Library passages that match the module's title and
 * objectives. The best matches start ticked; the author adjusts.
 */
function ReferencePicker({
  moduleId,
  chosen,
  onChange,
  disabled,
}: {
  moduleId: string;
  chosen: string[];
  onChange: (ids: string[]) => void;
  disabled: boolean;
}) {
  const [found, setFound] = useState<FoundReference[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    findModuleReferences(moduleId).then((r) => {
      if (!live) return;
      if (!r.ok) return setError(r.error);
      setFound(r.references);
      onChange(r.references.slice(0, PRESELECT).map((x) => x.id));
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleId]);

  const toggle = (id: string) => onChange(chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id]);
  const groups = new Map<string, FoundReference[]>();
  for (const r of found ?? []) groups.set(r.documentTitle, [...(groups.get(r.documentTitle) ?? []), r]);

  return (
    <section className="ref-picker" data-testid="reference-picker">
      <div className="ref-picker__head">
        <h3 className="import-form__subhead">From the Legislation Library</h3>
        {found && found.length > 0 && (
          <span className="ref-picker__count">
            {chosen.length} of {found.length} chosen &middot;{" "}
            <button type="button" className="text-action" disabled={disabled} onClick={() => onChange(found.map((r) => r.id))}>
              All
            </button>{" "}
            <button type="button" className="text-action" disabled={disabled} onClick={() => onChange([])}>
              None
            </button>
          </span>
        )}
      </div>
      <p className="card__meta">
        Passages that match this module&rsquo;s objectives, best first. The AI treats the Act and Regulation as the authority and
        cites their sections. Untick anything that doesn&rsquo;t belong.
      </p>
      {error && (
        <p className="form-alert" role="alert">
          {error}
        </p>
      )}
      {!found && !error && <p className="card__meta">Searching the library&hellip;</p>}
      {found && found.length === 0 && <p className="card__meta">Nothing in the library matched. Add documents below instead.</p>}
      {[...groups.entries()].map(([doc, list]) => (
        <div key={doc} className="ref-picker__group">
          <div className="ref-picker__doc">
            {doc} <span className="pill pill--locked">{KIND_LABEL[list[0].kind]}</span>
          </div>
          <ul>
            {list.map((r) => (
              <li key={r.id}>
                <label className="be-check">
                  <input type="checkbox" checked={chosen.includes(r.id)} disabled={disabled} onChange={() => toggle(r.id)} />
                  <span>{r.label}</span>
                </label>
                <button type="button" className="text-action" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
                  {open === r.id ? "Hide" : "Preview"}
                </button>
                {open === r.id && <p className="ref-picker__preview">{r.preview}&hellip;</p>}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
