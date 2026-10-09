"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  deleteLibraryItem,
  publishLibraryItem,
  saveLibraryDraft,
  searchLibrarySections,
  tidyLibraryDraft,
  unpublishLibraryItem,
} from "@/app/admin/library/actions";
import { LibraryArticle } from "@/components/library/LibraryArticle";
import { LIBRARY_KINDS, PASTE_MAX_CHARS, publishProblems, type LibraryDraft, type LibrarySource } from "@/lib/library/library";
import { MARKUP_MAX_CHARS } from "@/lib/library/markup";
import { knowledgeResourceKindLabels, type KnowledgeResourceKind } from "@/lib/placeholder-data";

type Hit = LibrarySource & { snippet: string };

/**
 * Editing one Library item (0049): paste a draft for the AI to put in the
 * Library's markup, edit it with a live preview, check the statements it
 * flagged against the Legislation Library, cite sections, then publish.
 */
export function LibraryEditor({ initial }: { initial: LibraryDraft }) {
  const router = useRouter();
  const [draft, setDraft] = useState(initial);
  const [kind, setKind] = useState(initial.kind);
  const [title, setTitle] = useState(initial.title);
  const [summary, setSummary] = useState(initial.summary);
  const [tags, setTags] = useState(initial.tags.join(", "));
  const [markup, setMarkup] = useState(initial.markup);
  const [sources, setSources] = useState<LibrarySource[]>(initial.sources);
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);

  const current = { kind, title, summary, tags, markup, sources };
  const dirty =
    kind !== draft.kind ||
    title !== draft.title ||
    summary !== draft.summary ||
    tags !== draft.tags.join(", ") ||
    markup !== draft.markup ||
    JSON.stringify(sources) !== JSON.stringify(draft.sources);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function load(d: LibraryDraft) {
    setDraft(d);
    setKind(d.kind);
    setTitle(d.title);
    setSummary(d.summary);
    setTags(d.tags.join(", "));
    setMarkup(d.markup);
    setSources(d.sources);
  }

  async function save(): Promise<boolean> {
    setBusy("Saving…");
    setError(null);
    const r = await saveLibraryDraft(draft.id, current);
    setBusy(null);
    if (!r.ok) {
      setError(r.error);
      return false;
    }
    load(r.draft);
    return true;
  }

  async function tidy() {
    if (markup.trim() && !window.confirm("Replace the title, summary, tags and content with the AI's version of the pasted draft? Sources you've chosen stay.")) return;
    if (dirty && !(await save())) return;
    setBusy("Reading the draft… (this can take a minute or two)");
    setError(null);
    setNotice(null);
    const r = await tidyLibraryDraft(draft.id, paste);
    setBusy(null);
    if (!r.ok) return setError(r.error);
    load(r.draft);
    setPaste("");
    setNotice("Done. Read it through below, check each flagged statement, then save.");
    router.refresh();
  }

  async function publish() {
    if (dirty && !(await save())) return;
    setBusy("Publishing…");
    const r = await publishLibraryItem(draft.id);
    setBusy(null);
    if (!r.ok) return setError(r.error);
    load(r.draft);
    setNotice("Published. Every strata's Knowledge Library has it now.");
    router.refresh();
  }

  async function unpublish() {
    if (!window.confirm("Take this item out of every strata's Knowledge Library? The draft stays here.")) return;
    setBusy("Unpublishing…");
    const r = await unpublishLibraryItem(draft.id);
    setBusy(null);
    if (!r.ok) return setError(r.error);
    load(r.draft);
    setNotice("Unpublished. Members no longer see it.");
    router.refresh();
  }

  async function remove() {
    if (!window.confirm(`Delete "${title || "this item"}"${draft.publishedAt ? ", and take it out of every strata's Knowledge Library" : ""}? This can't be undone.`)) return;
    setBusy("Deleting…");
    const r = await deleteLibraryItem(draft.id);
    if (!r.ok) {
      setBusy(null);
      return setError(r.error);
    }
    router.push("/admin/library");
  }

  async function search() {
    setBusy("Searching…");
    const r = await searchLibrarySections(query);
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setHits(r.hits);
  }

  const cite = (s: LibrarySource) => setSources((list) => (list.some((x) => x.chunkId === s.chunkId) ? list : [...list, { chunkId: s.chunkId, label: s.label }]));
  const cited = (id: string) => sources.some((s) => s.chunkId === id);
  const problems = publishProblems({ kind, title: title.trim(), summary: summary.trim(), tags: [], markup: markup.trim(), sources });

  return (
    <div className="lib-editor" data-testid="library-editor">
      <div className="lib-editor__bar">
        <Link href="/admin/library" className="card__meta">
          &larr; Library
        </Link>
        <span className="card__meta">
          {draft.publishedAt
            ? draft.changed || dirty
              ? "Published. The changes here aren't published yet."
              : "Published"
            : "Draft: members don't see it yet."}
        </span>
        <div className="be-row">
          <button type="button" className="button button-secondary button-small" disabled={!dirty || Boolean(busy)} onClick={save} data-testid="library-save">
            {dirty ? "Save" : "Saved"}
          </button>
          <button
            type="button"
            className="button button-primary button-small"
            disabled={Boolean(busy) || problems.length > 0 || (!dirty && !draft.changed && Boolean(draft.publishedAt))}
            title={problems.join(" ")}
            onClick={publish}
            data-testid="library-publish"
          >
            {draft.publishedAt ? "Publish changes" : "Publish"}
          </button>
          {draft.publishedAt && (
            <button type="button" className="text-action" disabled={Boolean(busy)} onClick={unpublish}>
              Unpublish
            </button>
          )}
          <button type="button" className="text-action text-action--danger" disabled={Boolean(busy)} onClick={remove}>
            Delete
          </button>
        </div>
      </div>
      {busy && (
        <p className="card__meta" role="status">
          {busy}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {notice && !error && (
        <p className="form-alert form-alert--ok" role="status">
          {notice}
        </p>
      )}

      <details className="builder__block lib-editor__paste" open={!markup.trim()}>
        <summary className="builder__block-type">Paste a draft</summary>
        <p className="card__meta">
          Paste a playbook, guide or template written elsewhere. The AI puts it in the Library&rsquo;s format, removes clutter,
          keeps it general, and lists the legal statements to check. It adds nothing of its own.
        </p>
        <textarea
          rows={10}
          value={paste}
          maxLength={PASTE_MAX_CHARS}
          aria-label="The draft"
          onChange={(e) => setPaste(e.target.value)}
          data-testid="library-paste"
        />
        <div className="be-row">
          <button type="button" className="button button-primary button-small" disabled={paste.trim().length < 40 || Boolean(busy)} onClick={tidy} data-testid="library-tidy">
            Put it in the Library&rsquo;s format
          </button>
        </div>
      </details>

      <div className="lib-editor__fields">
        <label>
          <span>Kind</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as KnowledgeResourceKind)}>
            {LIBRARY_KINDS.map((k) => (
              <option key={k} value={k}>
                {knowledgeResourceKindLabels[k]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Title</span>
          <input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} data-testid="library-title" />
        </label>
        <label className="lib-editor__wide">
          <span>Summary (one sentence, shown on the card)</span>
          <input value={summary} maxLength={600} onChange={(e) => setSummary(e.target.value)} />
        </label>
        <label className="lib-editor__wide">
          <span>Tags (comma-separated, used for search and related items)</span>
          <input value={tags} maxLength={300} onChange={(e) => setTags(e.target.value)} />
        </label>
      </div>

      <div className="lib-editor__panes">
        <div className="lib-editor__source">
          <div className="lib-editor__pane-head">
            <strong>Content</strong>
            <details className="lib-editor__help">
              <summary>Format</summary>
              <pre>{`## Heading {timing}
### Subheading
Paragraph text. **Bold** words.
- bullet      1. numbered      [ ] checklist
| Header | Header |
| cell   | cell   |
:::summary The first 30 minutes
:::important Title   guidance (green)
:::warning Title     caution (red)
:::sample Title      text to copy
:::fineprint         a disclaimer, small print
(close each box with a line of :::)`}</pre>
            </details>
          </div>
          <textarea
            className="lib-editor__markup"
            value={markup}
            maxLength={MARKUP_MAX_CHARS}
            onChange={(e) => setMarkup(e.target.value)}
            spellCheck
            aria-label="Content"
            data-testid="library-markup"
          />
        </div>
        <div className="lib-editor__preview">
          <div className="lib-editor__pane-head">
            <strong>Preview</strong>
          </div>
          {markup.trim() ? <LibraryArticle markup={markup} /> : <p className="card__meta">The content shows here as members will read it.</p>}
        </div>
      </div>

      <section className="builder__block">
        <div className="builder__block-head">
          <span className="builder__block-type">Statements to check</span>
        </div>
        {draft.claims.length === 0 ? (
          <p className="card__meta">None flagged. Statements about what the law requires or allows are listed here after the AI reads a draft.</p>
        ) : (
          <>
            <p className="card__meta">
              Check each against its source. Cite the section that supports it, or change or remove the statement if nothing
              does. This list is for you; members never see it.
            </p>
            <ol className="lib-claims">
              {draft.claims.map((c, i) => (
                <li key={i}>
                  <p>{c.statement}</p>
                  {c.suggestions.length === 0 ? (
                    <p className="card__meta">No matching section found. Search below, or remove the statement.</p>
                  ) : (
                    <ul className="lib-hits">
                      {c.suggestions.map((h) => (
                        <SectionHit key={h.chunkId} hit={h} cited={cited(h.chunkId)} onCite={() => cite(h)} />
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
          </>
        )}
      </section>

      <section className="builder__block">
        <div className="builder__block-head">
          <span className="builder__block-type">Sources ({sources.length})</span>
        </div>
        {sources.length === 0 ? (
          <p className="card__meta">None yet. Members see these as &ldquo;Legislation referenced&rdquo;.</p>
        ) : (
          <ul className="lib-sources">
            {sources.map((s) => (
              <li key={s.chunkId}>
                <span>{s.label}</span>
                <button type="button" className="text-action" onClick={() => setSources((l) => l.filter((x) => x.chunkId !== s.chunkId))}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="be-row"
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <input className="be-grow" value={query} maxLength={300} placeholder='Find a section: "98", "Standard Bylaw 7" or words' onChange={(e) => setQuery(e.target.value)} />
          <button className="button button-secondary button-small" disabled={!query.trim() || Boolean(busy)}>
            Search
          </button>
        </form>
        {hits.length > 0 && (
          <ul className="lib-hits">
            {hits.map((h) => (
              <SectionHit key={h.chunkId} hit={h} cited={cited(h.chunkId)} onCite={() => cite(h)} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function SectionHit({ hit, cited, onCite }: { hit: Hit; cited: boolean; onCite: () => void }) {
  return (
    <li>
      <div>
        <strong>{hit.label}</strong>
        <span className="card__meta"> {hit.snippet}</span>
      </div>
      <button type="button" className="button button-secondary button-small" disabled={cited} onClick={onCite}>
        {cited ? "Cited" : "Cite"}
      </button>
    </li>
  );
}
