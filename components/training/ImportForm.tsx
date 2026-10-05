"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { createImportUpload, startImport, type ImportSource } from "@/app/admin/training/ai/actions";
import { TRAINING_IMPORT_BUCKET } from "@/lib/training/ai";

type Picked = { key: string; kind: "upload"; file: File } | { key: string; kind: "library"; id: string; title: string };

/**
 * Start an AI build: one to five documents (uploaded files and/or
 * Legislation library entries), an optional track, and notes for the AI.
 */
export function ImportForm({
  library,
  tracks,
}: {
  library: { id: string; title: string; kind: string }[];
  tracks: { id: string; title: string }[];
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<Picked[]>([]);
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
    if (!picked.length) return setError("Add at least one document.");
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
      const r = await startImport({ sources, title, trackId: trackId || null, instructions });
      if (!r.ok) throw new Error(r.error);
      router.push(`/admin/training/ai/${r.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
      setBusy(null);
    }
  }

  return (
    <section className="card import-form" data-testid="import-form">
      <h2>Build modules from documents</h2>
      <p className="card__meta">
        Add one to five documents on a topic. The AI reads them, proposes modules for you to review, then writes the ones you
        choose as drafts. Personal information is removed before the AI sees anything.
      </p>

      <div className="import-form__sources">
        {picked.length === 0 && <p className="card__meta">No documents yet.</p>}
        {picked.map((p) => (
          <div key={p.key} className="import-form__source">
            <span>
              {p.kind === "upload" ? p.file.name : p.title}
              <span className="card__meta"> &middot; {p.kind === "upload" ? "upload" : "Legislation library"}</span>
            </span>
            <button type="button" className="text-action" onClick={() => setPicked(picked.filter((x) => x.key !== p.key))} disabled={Boolean(busy)}>
              Remove
            </button>
          </div>
        ))}
      </div>

      <div className="import-form__add">
        <button type="button" className="button button-secondary button-small" onClick={() => fileInput.current?.click()} disabled={full || Boolean(busy)}>
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
          <select value={libraryChoice} onChange={(e) => setLibraryChoice(e.target.value)} aria-label="Legislation library entry" disabled={full || Boolean(busy)}>
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
        <label className="field">
          <span>Name (optional)</span>
          <input value={title} maxLength={200} placeholder="e.g. What a strata corporation is" onChange={(e) => setTitle(e.target.value)} />
        </label>
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
        <button type="button" className="button button-primary" onClick={start} disabled={Boolean(busy) || picked.length === 0} data-testid="import-start">
          {busy ?? "Read and propose modules"}
        </button>
      </div>
    </section>
  );
}
