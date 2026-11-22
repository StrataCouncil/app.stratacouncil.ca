"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  checkAllLegislationSources,
  createLegislationUploads,
  deleteLegislation,
  getLegislationDownloadUrl,
  registerLegislation,
  refreshLegislationFromSource,
  reindexLegislation,
  updateLegislation,
} from "@/app/admin/legislation/actions";
import type { LegislationEntry } from "@/lib/data/legislation";
import {
  guessKind,
  LEGISLATION_BUCKET,
  LEGISLATION_EXTENSIONS,
  LEGISLATION_KINDS,
  titleFromFileName,
  type LegislationKind,
} from "@/lib/legislation";

/**
 * The Knowledge Base (Super Admin). Upload Acts, regulations and
 * guidance; each is indexed in the background and from then on is what
 * Stratasphere quotes and cites for questions of law. Nothing about the
 * law comes from the model's memory, so what's here is the whole of it.
 */

interface Staged {
  file: File;
  title: string;
  shortName: string;
  kind: LegislationKind;
  currentTo: string;
}

const kindLabel = (k: LegislationKind) => LEGISLATION_KINDS.find((x) => x.value === k)?.label ?? k;

/** "Nov 24, 2026, 1:41 a.m. PT" */
function pacific(iso: string) {
  return `${new Date(iso).toLocaleString("en-CA", { timeZone: "America/Vancouver", dateStyle: "medium", timeStyle: "short" })} PT`;
}

function statusText(e: LegislationEntry) {
  switch (e.status) {
    case "indexed":
      return e.sectionCount
        ? `Indexed: ${e.sectionCount} sections`
        : `Indexed: ${e.chunkCount ?? 0} passages${e.kind === "guidance" ? "" : " (no sections found)"}`;
    case "pending":
      return e.sourceUrl && !e.fileName ? "Waiting to read from BC Laws" : "Waiting to index";
    case "processing":
      return e.readFromScan ? "Reading the scan…" : "Indexing";
    case "needs_text":
      return "Couldn’t read this scan";
    case "not_indexable":
      return "Can't be read";
    default:
      return "Failed";
  }
}

function EntryRow({ e, onError }: { e: LegislationEntry; onError: (m: string) => void }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    title: e.title,
    shortName: e.shortName ?? "",
    kind: e.kind as string,
    currentTo: e.currentTo ?? "",
    sourceUrl: e.sourceUrl ?? "",
  });

  async function run(p: Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    const res = await p;
    setBusy(false);
    if (!res.ok) onError(res.error ?? "Something went wrong.");
    else router.refresh();
    return res.ok;
  }

  if (editing) {
    return (
      <tr>
        <td colSpan={5}>
          <form
            className="legis-edit"
            onSubmit={async (ev) => {
              ev.preventDefault();
              if (await run(updateLegislation(e.id, form))) setEditing(false);
            }}
          >
            <input value={form.title} onChange={(ev) => setForm({ ...form, title: ev.target.value })} aria-label="Name" maxLength={200} />
            <input
              value={form.shortName}
              onChange={(ev) => setForm({ ...form, shortName: ev.target.value })}
              aria-label="Short name"
              placeholder="Short name"
              maxLength={30}
            />
            <select value={form.kind} onChange={(ev) => setForm({ ...form, kind: ev.target.value })} aria-label="Type">
              {LEGISLATION_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
            <input type="date" value={form.currentTo} onChange={(ev) => setForm({ ...form, currentTo: ev.target.value })} aria-label="Current to" />
            <input
              value={form.sourceUrl}
              onChange={(ev) => setForm({ ...form, sourceUrl: ev.target.value })}
              aria-label="BC Laws link"
              placeholder="BC Laws link (complete document)"
              type="url"
            />
            <button type="submit" className="button button-primary button-small" disabled={busy}>
              Save and re-index
            </button>
            <button type="button" className="link-button" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </form>
        </td>
      </tr>
    );
  }

  return (
    <tr data-testid={`legislation-${e.id}`}>
      <td>
        <strong>{e.title}</strong>
        {e.shortName ? <span className="roster-table__meta"> ({e.shortName})</span> : null}
        <div className="roster-table__meta">{e.fileName}</div>
        {e.sourceUrl ? (
          <div className="roster-table__meta">
            <a href={e.sourceUrl} target="_blank" rel="noreferrer">
              From BC Laws
            </a>
            {e.sourceCheckedAt ? `, checked ${pacific(e.sourceCheckedAt)}` : ", not checked yet"}
          </div>
        ) : null}
        {e.sourceError ? <div className="roster-table__meta legis-row-error">BC Laws: {e.sourceError}</div> : null}
      </td>
      <td>{kindLabel(e.kind)}</td>
      <td>{e.currentTo ?? <span className="roster-table__meta">Not set</span>}</td>
      <td>
        <span className={`doc-status doc-status--${e.status}`} title={e.error ?? undefined}>
          {statusText(e)}
        </span>
        {e.error && e.status !== "indexed" ? <div className="roster-table__meta legis-row-error">{e.error}</div> : null}
        {e.status === "indexed" && e.readFromScan ? (
          <div className="roster-table__meta">Read from scan{e.unclearPages > 0 ? `; ${e.unclearPages} pages unclear` : ""}.</div>
        ) : null}
        {e.status === "needs_text" ? (
          <div className="roster-table__meta">No text found, even from the scan. Upload a clearer copy, or a text PDF, Word or HTML version.</div>
        ) : null}
      </td>
      <td className="legis-actions">
        <button type="button" className="link-button" onClick={() => setEditing(true)} disabled={busy}>
          Edit
        </button>
        {e.sourceUrl ? (
          <button type="button" className="link-button" onClick={() => run(refreshLegislationFromSource(e.id))} disabled={busy}>
            Update from BC Laws
          </button>
        ) : null}
        <button type="button" className="link-button" onClick={() => run(reindexLegislation(e.id))} disabled={busy}>
          Re-index
        </button>
        <button
          type="button"
          className="link-button"
          disabled={busy}
          onClick={async () => {
            const res = await getLegislationDownloadUrl(e.id);
            if (res.ok) window.location.href = res.url;
            else onError(res.error);
          }}
        >
          Download
        </button>
        <button
          type="button"
          className="link-button agenda-danger"
          disabled={busy}
          onClick={() => {
            if (window.confirm(`Remove "${e.title}" from the Knowledge Base? Stratasphere will stop citing it.`)) run(deleteLegislation(e.id));
          }}
        >
          Delete
        </button>
      </td>
    </tr>
  );
}

export function LegislationLibrary({ entries }: { entries: LegislationEntry[] }) {
  const router = useRouter();
  const [staged, setStaged] = useState<Staged[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const linked = entries.filter((e) => e.sourceUrl).length;

  // Keep statuses fresh while anything is still indexing.
  const working = entries.some((e) => e.status === "pending" || e.status === "processing");
  useEffect(() => {
    if (!working) return;
    const t = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(t);
  }, [working, router]);

  function pick(files: FileList | null) {
    if (!files) return;
    setError("");
    setStaged((prev) => [
      ...prev,
      ...Array.from(files).map((file) => {
        const title = titleFromFileName(file.name);
        return { file, title, shortName: "", kind: guessKind(title), currentTo: "" };
      }),
    ]);
    if (picker.current) picker.current.value = "";
  }

  async function upload() {
    if (!staged.length) return;
    setError("");
    setUploading(true);
    try {
      const tickets = await createLegislationUploads(staged.map((s) => ({ name: s.file.name, size: s.file.size })));
      if (!tickets.ok) return setError(tickets.error);
      const storage = createClient().storage.from(LEGISLATION_BUCKET);
      for (let i = 0; i < staged.length; i++) {
        const { error: upErr } = await storage.uploadToSignedUrl(tickets.tickets[i].path, tickets.tickets[i].token, staged[i].file, {
          contentType: staged[i].file.type || undefined,
        });
        if (upErr) return setError(`${staged[i].file.name} didn't upload: ${upErr.message}`);
      }
      const res = await registerLegislation(
        staged.map((s, i) => ({
          path: tickets.tickets[i].path,
          fileName: s.file.name,
          size: s.file.size,
          type: s.file.type,
          title: s.title,
          shortName: s.shortName,
          kind: s.kind,
          currentTo: s.currentTo,
        }))
      );
      if (!res.ok) return setError(res.error);
      setStaged([]);
      router.refresh();
    } finally {
      setUploading(false);
    }
  }

  const update = (i: number, patch: Partial<Staged>) => setStaged((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  return (
    <div className="legis">
      <section className="legis-upload">
        <div className="legis-upload__head">
          <div>
            <h2>Add to the Knowledge Base</h2>
            <p className="roster-table__meta">
              PDF, Word (.docx), HTML or text. Text versions from BC Laws index best: Acts and regulations are split by
              section so answers can cite them. &ldquo;Current to&rdquo; is read from the file when left blank.
            </p>
          </div>
          <button type="button" className="button button-secondary" onClick={() => picker.current?.click()} disabled={uploading}>
            Choose files
          </button>
          <input
            ref={picker}
            type="file"
            multiple
            hidden
            accept={LEGISLATION_EXTENSIONS.map((e) => `.${e}`).join(",")}
            onChange={(e) => pick(e.target.files)}
            data-testid="legislation-file-input"
          />
        </div>

        {staged.length > 0 && (
          <>
            <div className="roster-table-wrap">
              <table className="roster-table legis-staged">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Short name</th>
                    <th>Type</th>
                    <th>Current to</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {staged.map((s, i) => (
                    <tr key={`${s.file.name}-${i}`}>
                      <td>
                        <input value={s.title} maxLength={200} onChange={(e) => update(i, { title: e.target.value })} aria-label="Name" />
                        <div className="roster-table__meta">{s.file.name}</div>
                      </td>
                      <td>
                        <input
                          value={s.shortName}
                          maxLength={30}
                          placeholder="e.g. SPA"
                          onChange={(e) => update(i, { shortName: e.target.value })}
                          aria-label="Short name"
                        />
                      </td>
                      <td>
                        <select value={s.kind} onChange={(e) => update(i, { kind: e.target.value as LegislationKind })} aria-label="Type">
                          {LEGISLATION_KINDS.map((k) => (
                            <option key={k.value} value={k.value}>
                              {k.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input type="date" value={s.currentTo} onChange={(e) => update(i, { currentTo: e.target.value })} aria-label="Current to" />
                      </td>
                      <td>
                        <button type="button" className="link-button" onClick={() => setStaged((prev) => prev.filter((_, j) => j !== i))}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="legis-upload__actions">
              <button type="button" className="link-button" onClick={() => setStaged([])} disabled={uploading}>
                Clear
              </button>
              <button
                type="button"
                className="button button-primary"
                onClick={upload}
                disabled={uploading || staged.some((s) => !s.title.trim())}
                data-testid="legislation-upload"
              >
                {uploading ? "Uploading" : `Upload and index ${staged.length === 1 ? "1 file" : `${staged.length} files`}`}
              </button>
            </div>
          </>
        )}
        {error && (
          <p className="legis-error" role="alert">
            {error}
          </p>
        )}
      </section>

      <div className="legis-upload__head" style={{ margin: "2rem 0 1rem" }}>
        <div>
          <h2>In the Knowledge Base</h2>
          <p className="roster-table__meta">
            Entries with a BC Laws link are read from BC Laws and checked for a newer version every Monday at 1:41 a.m. PT.
            {` ${linked} of ${entries.length} have a link.`}
          </p>
        </div>
        {linked > 0 ? (
          <button
            type="button"
            className="button button-secondary"
            disabled={checking}
            onClick={async () => {
              setError("");
              setChecking(true);
              const res = await checkAllLegislationSources();
              setChecking(false);
              if (!res.ok) setError(res.error);
              else router.refresh();
            }}
          >
            {checking ? "Checking" : "Check BC Laws now"}
          </button>
        ) : null}
      </div>
      {entries.length === 0 ? (
        <p className="roster-notice">
          Nothing yet. Until legislation is added, Stratasphere tells people it can&rsquo;t answer questions of law from
          the Knowledge Base.
        </p>
      ) : (
        <div className="roster-table-wrap">
          <table className="roster-table" data-testid="legislation-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Current to</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <EntryRow key={e.id} e={e} onError={setError} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
