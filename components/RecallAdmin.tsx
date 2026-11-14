"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/Modal";
import {
  deleteRecallCase,
  getKnowledgeEntries,
  getKnowledgeSections,
  getStrataRecords,
  markRecallAnswer,
  runAnswerCheck,
  runFindCheck,
  saveRecallCase,
  type KnowledgeEntry,
  type StrataRecords,
} from "@/app/admin/recall/actions";
import { tz } from "@/lib/time-zone";

/**
 * The recall check (docs/learn-decide-remember.md §7). A case is a question
 * and the answer expected, with its key figures. Check answer asks
 * Stratasphere, checks the key figures automatically, and shows what was
 * sent with it; a person marks the answer Right, Partly, or Wrong. The
 * records that hold the answer (documents, decisions, Knowledge Base
 * sections) are optional: name them to see whether they reached the AI when
 * an answer goes wrong. Checks run one case at a time from here, so a long
 * list never runs into a server time limit.
 */

type Verdict = "right" | "partly" | "wrong";
type Run = {
  id: string;
  passed: boolean;
  at: string;
  details: Record<string, unknown>;
  costUsd: number;
  verdict: Verdict | null;
  verdictNote: string;
} | null;

export interface RecallCaseView {
  id: string;
  corporationId: string;
  question: string;
  meetingId: string | null;
  itemId: string | null;
  expectedAnswer: string;
  keyFigures: string[];
  expectDocuments: string[];
  expectDecisions: string[];
  expectLegislationDocuments: string[];
  expectLegislationSections: string[];
  expectPhrases: string[];
  answerPhrases: string[];
  note: string;
  find: Run;
  answer: Run;
}

type Corp = { id: string; name: string };

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-CA", { timeZone: tz("America/Vancouver", iso), month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " PT";
const usd = (n: number) => `US$${n.toFixed(2)}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const kChars = (n: number | undefined) => `${Math.round((n ?? 0) / 1000)}k`;

const VERDICTS: Array<{ value: Verdict; label: string; tag: string }> = [
  { value: "right", label: "Right", tag: "billing-tag--ok" },
  { value: "partly", label: "Partly", tag: "billing-tag--warn" },
  { value: "wrong", label: "Wrong", tag: "billing-tag--bad" },
];

function FindStatus({ c }: { c: RecallCaseView }) {
  const run = c.find;
  const named = c.expectDocuments.length + c.expectDecisions.length + c.expectPhrases.length + c.expectLegislationDocuments.length + c.expectLegislationSections.length;
  if (!named) return <span className="card__meta" data-testid="recall-find-status">Nothing named</span>;
  if (!run) return <span className="card__meta" data-testid="recall-find-status">Not run</span>;
  return (
    <span className="recall__status" data-testid="recall-find-status">
      <span className={`billing-tag ${run.passed ? "billing-tag--ok" : "billing-tag--warn"}`}>{run.passed ? "All sent" : "Missing"}</span>
      <span className="roster-table__meta">{when(run.at)}</span>
    </span>
  );
}

function AnswerStatus({ run }: { run: Run }) {
  if (!run) return <span className="card__meta" data-testid="recall-answer-status">Not run</span>;
  const v = VERDICTS.find((x) => x.value === run.verdict);
  const checked = Number((run.details as { checked?: number }).checked ?? 0);
  const figures = (run.details as { figures?: Array<{ found: boolean }>; phrases?: Array<{ found: boolean }> });
  const stated = [...(figures.figures ?? []), ...(figures.phrases ?? [])].filter((x) => x.found).length;
  return (
    <span className="recall__status" data-testid="recall-answer-status">
      {v ? (
        <span className={`billing-tag ${v.tag}`}>{v.label}</span>
      ) : (
        <span className="billing-tag billing-tag--off">To mark</span>
      )}
      {checked > 0 && (
        <span className={`roster-table__meta ${stated < checked ? "recall__short" : ""}`}>
          Key figures {stated} of {checked}
        </span>
      )}
      <span className="roster-table__meta">{when(run.at)}</span>
    </span>
  );
}

export function RecallAdmin({
  cases,
  corporations,
  costPerQuestion,
  knowledgeLabels,
}: {
  cases: RecallCaseView[];
  corporations: Corp[];
  costPerQuestion: number;
  /** Titles of the Knowledge Base entries and sections the cases name. */
  knowledgeLabels: Record<string, string>;
}) {
  const router = useRouter();
  const [strata, setStrata] = useState("");
  const [editing, setEditing] = useState<RecallCaseView | "new" | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [records, setRecords] = useState<Record<string, StrataRecords>>({});

  const shown = strata ? cases.filter((c) => c.corporationId === strata) : cases;
  const corpName = useMemo(() => new Map(corporations.map((c) => [c.id, c.name])), [corporations]);
  const right = shown.filter((c) => c.answer?.verdict === "right").length;
  const partly = shown.filter((c) => c.answer?.verdict === "partly").length;
  const wrong = shown.filter((c) => c.answer?.verdict === "wrong").length;
  const toMark = shown.filter((c) => c.answer && !c.answer.verdict).length;
  const notRight = shown.filter((c) => c.answer?.verdict !== "right");

  async function loadRecords(corpId: string) {
    if (records[corpId]) return records[corpId];
    const r = await getStrataRecords(corpId).catch(() => ({ ok: false as const, error: "Couldn't load that strata's records." }));
    if (!r.ok) {
      setError(r.error);
      return null;
    }
    setRecords((m) => ({ ...m, [corpId]: r }));
    return r;
  }

  async function runAll(kind: "find" | "answer", list: RecallCaseView[]) {
    if (!list.length) return;
    if (kind === "answer") {
      const estimate = list.length * costPerQuestion;
      const ok = window.confirm(
        `This asks Stratasphere ${plural(list.length, "question")}, at about ${usd(costPerQuestion)} each: about ${usd(estimate)} in all. Go ahead?`
      );
      if (!ok) return;
    }
    setError(null);
    setBusy(kind);
    let spent = 0;
    let problems = 0;
    for (let i = 0; i < list.length; i++) {
      setProgress(`${kind === "find" ? "Checking what's sent" : "Asking"}: ${i + 1} of ${list.length}${kind === "answer" && spent ? `, ${usd(spent)} so far` : ""}`);
      const r = kind === "find" ? await runFindCheck(list[i].id) : await runAnswerCheck(list[i].id);
      if (!r.ok) {
        problems++;
        setError(r.error);
        continue;
      }
      if ("costUsd" in r) spent += r.costUsd;
    }
    setProgress(
      kind === "find"
        ? `Checked what's sent for ${plural(list.length, "case")}.`
        : `Asked ${plural(list.length - problems, "question")}. Cost ${usd(spent)}. Mark each answer Right, Partly, or Wrong.`
    );
    setBusy(null);
    router.refresh();
  }

  async function remove(c: RecallCaseView) {
    if (!window.confirm("Delete this case and its results?")) return;
    setBusy(c.id);
    const r = await deleteRecallCase(c.id);
    setBusy(null);
    if (!r.ok) return setError(r.error);
    router.refresh();
  }

  async function toggle(c: RecallCaseView) {
    if (open === c.id) return setOpen(null);
    setOpen(c.id);
    await loadRecords(c.corporationId);
  }

  return (
    <section className="recall" data-testid="recall-admin">
      <div className="recall__bar">
        <div className="field recall__filter">
          <label htmlFor="recall-strata">Strata</label>
          <select id="recall-strata" value={strata} onChange={(e) => setStrata(e.target.value)} data-testid="recall-filter">
            <option value="">All stratas</option>
            {corporations
              .filter((c) => cases.some((x) => x.corporationId === c.id))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.id}, {c.name}
                </option>
              ))}
          </select>
        </div>
        <div className="recall__buttons">
          <button type="button" className="button button-secondary" disabled={busy !== null || !shown.length} onClick={() => runAll("find", shown)} data-testid="recall-find-all">
            Check what&rsquo;s sent ({shown.length})
          </button>
          <button
            type="button"
            className="button button-secondary"
            disabled={busy !== null || !notRight.length}
            onClick={() => runAll("answer", notRight)}
            data-testid="recall-answer-not-right"
          >
            Ask the ones not Right ({notRight.length})
          </button>
          <button type="button" className="button button-secondary" disabled={busy !== null || !shown.length} onClick={() => runAll("answer", shown)} data-testid="recall-answer-all">
            Ask all ({shown.length})
          </button>
          <button type="button" className="button button-primary" disabled={busy !== null} onClick={() => setEditing("new")} data-testid="recall-add">
            Add a case
          </button>
        </div>
      </div>

      {shown.length > 0 && (
        <p className="card__meta" data-testid="recall-summary">
          Answers: {right} Right, {partly} Partly, {wrong} Wrong{toMark ? `, ${toMark} to mark` : ""}. Asking costs about {usd(costPerQuestion)} a case (the average of
          recent Stratasphere questions). Checking what&rsquo;s sent costs nothing.
        </p>
      )}
      {progress && (
        <p className="sync-note sync-note--ok" role="status" data-testid="recall-progress">
          {progress}
        </p>
      )}
      {error && (
        <p className="form-alert" role="alert">
          {error}
        </p>
      )}

      {shown.length === 0 ? (
        <div className="card">
          <p className="card__meta">
            No cases yet. A case is a question a council member would ask, with the answer you expect and its key figures. Add one for each kind of
            question Stratasphere must get right: bylaw questions worded nothing like the bylaw, exact lot and bylaw numbers, old decisions, sums and
            prorating, the Strata Property Act, and something that truly isn&rsquo;t on file.
          </p>
        </div>
      ) : (
        <div className="roster-table-wrap">
          <table className="roster-table recall__table">
            <thead>
              <tr>
                <th>Question</th>
                <th>Answer</th>
                <th>What&rsquo;s sent</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => (
                <RecallRow
                  key={c.id}
                  c={c}
                  corpName={corpName.get(c.corporationId) ?? c.corporationId}
                  open={open === c.id}
                  records={records[c.corporationId] ?? null}
                  knowledgeLabels={knowledgeLabels}
                  busy={busy}
                  onToggle={() => toggle(c)}
                  onFind={() => runAll("find", [c])}
                  onAnswer={() => runAll("answer", [c])}
                  onEdit={async () => {
                    await loadRecords(c.corporationId);
                    setEditing(c);
                  }}
                  onDelete={() => remove(c)}
                  onMarked={() => router.refresh()}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <CaseForm
          initial={editing === "new" ? null : editing}
          corporations={corporations}
          defaultStrata={strata}
          loadRecords={loadRecords}
          knowledgeLabels={knowledgeLabels}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
    </section>
  );
}

function RecallRow({
  c,
  corpName,
  open,
  records,
  knowledgeLabels,
  busy,
  onToggle,
  onFind,
  onAnswer,
  onEdit,
  onDelete,
  onMarked,
}: {
  c: RecallCaseView;
  corpName: string;
  open: boolean;
  records: StrataRecords | null;
  knowledgeLabels: Record<string, string>;
  busy: string | null;
  onToggle: () => void;
  onFind: () => void;
  onAnswer: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onMarked: () => void;
}) {
  return (
    <>
      <tr data-testid="recall-row">
        <td>
          <button type="button" className="recall__question" onClick={onToggle} aria-expanded={open}>
            {c.question}
          </button>
          <div className="roster-table__meta">
            {c.corporationId}, {corpName}
            {c.itemId ? ", about an agenda item" : ""}
            {c.keyFigures.length ? `. Key figures: ${c.keyFigures.join(", ")}` : ""}
            {c.note ? `. ${c.note}` : ""}
          </div>
        </td>
        <td>
          <AnswerStatus run={c.answer} />
        </td>
        <td>
          <FindStatus c={c} />
        </td>
        <td className="demo-links__actions">
          <button type="button" className="button button-primary button-small" disabled={busy !== null} onClick={onAnswer} data-testid="recall-answer">
            Ask
          </button>
          <button type="button" className="button button-secondary button-small" disabled={busy !== null} onClick={onFind} data-testid="recall-find">
            Check what&rsquo;s sent
          </button>
          <button type="button" className="button button-secondary button-small" disabled={busy !== null} onClick={onEdit}>
            Edit
          </button>
          <button type="button" className="button button-secondary button-small agenda-danger" disabled={busy !== null} onClick={onDelete}>
            Delete
          </button>
        </td>
      </tr>
      {open && (
        <tr className="recall__details-row">
          <td colSpan={4}>
            <RecallDetails c={c} records={records} knowledgeLabels={knowledgeLabels} onMarked={onMarked} />
          </td>
        </tr>
      )}
    </>
  );
}

type Finding = { id?: string; phrase?: string; figure?: string; kind?: string; found: boolean; where?: string };
type FindDetails = {
  problem?: string;
  documents?: Finding[];
  decisions?: Finding[];
  phrases?: Finding[];
  knowledge?: Finding[];
  searchFailed?: boolean;
  contextChars?: number;
  sizes?: Record<string, number>;
  searchResults?: Array<{ rank: number; documentId: string | null; title: string | null; similarity: number }>;
  legislationResults?: Array<{ rank: number; id: string | null; title: string | null; similarity: number }>;
};

const SIZE_LABELS: Array<[string, string]> = [
  ["passages", "document passages"],
  ["ledger", "decision ledger"],
  ["bylaws", "bylaws"],
  ["platform", "platform records"],
  ["legislation", "legislation"],
  ["precedent", "precedent"],
  ["otherForQuestion", "attachments and other records"],
  ["rules", "instructions"],
];

function WhatWasSent({ f, docTitle, decisionTitle, knowledgeLabels }: { f: FindDetails; docTitle: (id: string) => string; decisionTitle: (id: string) => string; knowledgeLabels: Record<string, string> }) {
  const mark = (x: Finding) => (x.found ? "Sent" : "Not sent");
  const named = [...(f.documents ?? []), ...(f.decisions ?? []), ...(f.phrases ?? []), ...(f.knowledge ?? [])];
  return (
    <>
      {f.searchFailed && <p className="form-alert">The search failed, so only the bylaws, ledger, and platform records were sent.</p>}
      {named.length > 0 && (
        <ul className="recall__list">
          {(f.documents ?? []).map((d) => (
            <li key={`d${d.id}`} data-found={d.found}>
              <strong>{mark(d)}</strong> {docTitle(d.id!)} <span className="card__meta">({d.where})</span>
            </li>
          ))}
          {(f.decisions ?? []).map((d) => (
            <li key={`x${d.id}`} data-found={d.found}>
              <strong>{mark(d)}</strong> {decisionTitle(d.id!)}
            </li>
          ))}
          {(f.knowledge ?? []).map((k) => (
            <li key={`k${k.id}`} data-found={k.found}>
              <strong>{mark(k)}</strong> {knowledgeLabels[k.id!] ?? (k.kind === "entry" ? "A Knowledge Base entry" : "A Knowledge Base section")}
              {k.kind === "entry" ? " (any section)" : ""} <span className="card__meta">({k.where})</span>
            </li>
          ))}
          {(f.phrases ?? []).map((p) => (
            <li key={`p${p.phrase}`} data-found={p.found}>
              <strong>{mark(p)}</strong> &ldquo;{p.phrase}&rdquo;
            </li>
          ))}
        </ul>
      )}
      {f.sizes ? (
        <p className="card__meta" data-testid="recall-sizes">
          {kChars(f.sizes.total)} characters sent:{" "}
          {SIZE_LABELS.filter(([k]) => (f.sizes?.[k] ?? 0) > 0)
            .map(([k, label]) => `${label} ${kChars(f.sizes?.[k])}`)
            .join(", ")}
          .{(f.sizes.savedByJoining ?? 0) > 0 ? ` ${kChars(f.sizes.savedByJoining)} not repeated (overlapping passages joined, identical copies once).` : ""}
        </p>
      ) : (
        <p className="card__meta">{kChars(f.contextChars)} characters sent.</p>
      )}
      <p className="card__meta">
        The strata&rsquo;s own passages:{" "}
        {(f.searchResults ?? []).length
          ? (f.searchResults ?? []).map((r) => `${r.rank}. ${r.documentId ? docTitle(r.documentId) : (r.title ?? "?")} (${r.similarity})`).join("; ")
          : "none"}
        .
      </p>
      <p className="card__meta">
        Knowledge Base sections:{" "}
        {(f.legislationResults ?? []).length ? (f.legislationResults ?? []).map((r) => `${r.rank}. ${r.title ?? "?"} (${r.similarity})`).join("; ") : "none"}.
      </p>
    </>
  );
}

function RecallDetails({
  c,
  records,
  knowledgeLabels,
  onMarked,
}: {
  c: RecallCaseView;
  records: StrataRecords | null;
  knowledgeLabels: Record<string, string>;
  onMarked: () => void;
}) {
  const docTitle = (id: string) => records?.documents.find((d) => d.id === id)?.title ?? "A document no longer on file";
  const decisionTitle = (id: string) => {
    const d = records?.decisions.find((x) => x.id === id);
    return d ? `${d.decidedAt}: ${d.title}` : "A decision no longer in the ledger";
  };
  const a = c.answer?.details as
    | {
        answer?: string;
        figures?: Finding[];
        phrases?: Finding[];
        cited?: Finding[];
        calculations?: Array<{ name: string; input: unknown; result: string }>;
        find?: FindDetails;
      }
    | undefined;
  const f = (a?.find ?? c.find?.details) as FindDetails | undefined;
  const [note, setNote] = useState(c.answer?.verdictNote ?? "");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function mark(verdict: Verdict | null) {
    if (!c.answer) return;
    setSaving(true);
    setProblem(null);
    const r = await markRecallAnswer(c.answer.id, verdict, note);
    setSaving(false);
    if (!r.ok) return setProblem(r.error);
    onMarked();
  }

  return (
    <div className="recall__details" data-testid="recall-details">
      <div>
        <h3>Expected</h3>
        {c.expectedAnswer ? <blockquote className="recall__answer">{c.expectedAnswer}</blockquote> : <p className="card__meta">No answer written; key figures only.</p>}
        <h3>Stratasphere&rsquo;s answer</h3>
        {!a ? (
          <p className="card__meta">Not asked yet.</p>
        ) : (
          <>
            <blockquote className="recall__answer" data-testid="recall-answer-text">
              {a.answer}
            </blockquote>
            {(a.figures?.length || a.phrases?.length) ? (
              <ul className="recall__list">
                {(a.figures ?? []).map((x) => (
                  <li key={`af${x.figure}`} data-found={x.found}>
                    <strong>{x.found ? "Stated" : "Not stated"}</strong> {x.figure}
                  </li>
                ))}
                {(a.phrases ?? []).map((p) => (
                  <li key={`ap${p.phrase}`} data-found={p.found}>
                    <strong>{p.found ? "Stated" : "Not stated"}</strong> &ldquo;{p.phrase}&rdquo;
                  </li>
                ))}
              </ul>
            ) : null}
            {(a.calculations ?? []).length > 0 && (
              <details className="recall__calc">
                <summary>Calculations ({(a.calculations ?? []).length})</summary>
                <pre>{(a.calculations ?? []).map((x) => x.result).join("\n\n")}</pre>
              </details>
            )}
            {(a.cited ?? []).length > 0 && (
              <p className="card__meta">
                Cited:{" "}
                {(a.cited ?? []).map((d) => `${docTitle(d.id!)} ${d.found ? "(cited)" : "(not cited)"}`).join("; ")}.
              </p>
            )}
            <p className="card__meta">Cost {usd(c.answer?.costUsd ?? 0)}.</p>

            <div className="recall__verdict" data-testid="recall-verdict">
              <label htmlFor={`note-${c.id}`}>What was right or wrong (optional)</label>
              <textarea id={`note-${c.id}`} rows={2} maxLength={4000} value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="recall__buttons">
                {VERDICTS.map((v) => (
                  <button
                    key={v.value}
                    type="button"
                    className={`button button-small ${c.answer?.verdict === v.value ? "button-primary" : "button-secondary"}`}
                    disabled={saving}
                    onClick={() => mark(v.value)}
                    data-testid={`recall-mark-${v.value}`}
                  >
                    {v.label}
                  </button>
                ))}
                {c.answer?.verdict && (
                  <button type="button" className="link-button" disabled={saving} onClick={() => mark(null)}>
                    Clear
                  </button>
                )}
              </div>
              {problem && <p className="form-alert">{problem}</p>}
            </div>
          </>
        )}
      </div>
      <div>
        <h3>What was sent{a?.find ? " with this answer" : ""}</h3>
        {!f ? (
          <p className="card__meta">Not checked yet.</p>
        ) : f.problem ? (
          <p className="form-alert">{f.problem}</p>
        ) : (
          <WhatWasSent f={f} docTitle={docTitle} decisionTitle={decisionTitle} knowledgeLabels={knowledgeLabels} />
        )}
      </div>
    </div>
  );
}

function KnowledgePicker({
  entries,
  docs,
  sections,
  labels,
  onDocs,
  onSections,
}: {
  entries: KnowledgeEntry[] | null;
  docs: Set<string>;
  sections: Set<string>;
  labels: Record<string, string>;
  onDocs: (s: Set<string>) => void;
  onSections: (s: Set<string>) => void;
}) {
  const [entry, setEntry] = useState("");
  const [list, setList] = useState<Array<{ id: string; title: string }> | null>(null);
  const [filter, setFilter] = useState("");
  const [known, setKnown] = useState<Record<string, string>>(labels);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let gone = false;
    setList(null);
    setFilter("");
    if (!entry) return;
    void getKnowledgeSections(entry).then((r) => {
      if (gone) return;
      if (!r.ok) return setProblem(r.error);
      const title = entries?.find((e) => e.id === entry)?.title ?? "";
      setKnown((k) => ({ ...k, ...Object.fromEntries(r.sections.map((s) => [s.id, `${title}, ${s.title}`])) }));
      setList(r.sections);
    });
    return () => {
      gone = true;
    };
  }, [entry, entries]);

  const flip = (set: Set<string>, id: string, update: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    update(next);
  };
  const entryTitle = (id: string) => entries?.find((e) => e.id === id)?.title ?? labels[id] ?? "An entry";
  const q = filter.trim().toLowerCase();

  return (
    <fieldset className="recall-form__pick" data-testid="rc-knowledge">
      <legend>
        Knowledge Base: Acts, regulations, and guidance that hold the answer ({docs.size + sections.size} chosen)
      </legend>
      {(docs.size > 0 || sections.size > 0) && (
        <div className="recall__chips">
          {[...docs].map((id) => (
            <button key={id} type="button" className="recall__chip" onClick={() => flip(docs, id, onDocs)} title="Remove">
              {entryTitle(id)} (any section) &times;
            </button>
          ))}
          {[...sections].map((id) => (
            <button key={id} type="button" className="recall__chip" onClick={() => flip(sections, id, onSections)} title="Remove">
              {known[id] ?? "A section"} &times;
            </button>
          ))}
        </div>
      )}
      {entries === null ? (
        <p className="card__meta">Loading the Knowledge Base&hellip;</p>
      ) : entries.length === 0 ? (
        <p className="card__meta">Nothing in the Knowledge Base is indexed yet.</p>
      ) : (
        <>
          <select value={entry} onChange={(e) => setEntry(e.target.value)} aria-label="Knowledge Base entry" data-testid="rc-knowledge-entry">
            <option value="">Choose an entry</option>
            {entries.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}
              </option>
            ))}
          </select>
          {entry && (
            <div className="recall-form__options">
              <label className="field--checkbox">
                <input type="checkbox" checked={docs.has(entry)} onChange={() => flip(docs, entry, onDocs)} />
                Any section of this entry
              </label>
              {list === null ? (
                <p className="card__meta">Loading its sections&hellip;</p>
              ) : (
                <>
                  <input placeholder="Filter sections, e.g. 45 or quorum" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter sections" />
                  {list
                    .filter((s) => sections.has(s.id) || !q || s.title.toLowerCase().includes(q))
                    .slice(0, 300)
                    .map((s) => (
                      <label key={s.id} className="field--checkbox">
                        <input type="checkbox" checked={sections.has(s.id)} onChange={() => flip(sections, s.id, onSections)} />
                        {s.title}
                      </label>
                    ))}
                  {list.filter((s) => !q || s.title.toLowerCase().includes(q)).length > 300 && (
                    <p className="card__meta">Showing the first 300: filter to find the rest.</p>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
      {problem && <p className="form-alert">{problem}</p>}
    </fieldset>
  );
}

function CaseForm({
  initial,
  corporations,
  defaultStrata,
  loadRecords,
  knowledgeLabels,
  onClose,
  onSaved,
}: {
  initial: RecallCaseView | null;
  corporations: Corp[];
  defaultStrata: string;
  loadRecords: (corpId: string) => Promise<StrataRecords | null>;
  knowledgeLabels: Record<string, string>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [corpId, setCorpId] = useState(initial?.corporationId ?? defaultStrata);
  // Undefined while loading, null if it couldn't load.
  const [records, setRecords] = useState<StrataRecords | null | undefined>(undefined);
  const [entries, setEntries] = useState<KnowledgeEntry[] | null>(null);
  const [question, setQuestion] = useState(initial?.question ?? "");
  const [expectedAnswer, setExpectedAnswer] = useState(initial?.expectedAnswer ?? "");
  const [keyFigures, setKeyFigures] = useState((initial?.keyFigures ?? []).join("\n"));
  const [meetingId, setMeetingId] = useState(initial?.meetingId ?? "");
  const [itemId, setItemId] = useState(initial?.itemId ?? "");
  const [docs, setDocs] = useState<Set<string>>(new Set(initial?.expectDocuments ?? []));
  const [decisions, setDecisions] = useState<Set<string>>(new Set(initial?.expectDecisions ?? []));
  const [lawDocs, setLawDocs] = useState<Set<string>>(new Set(initial?.expectLegislationDocuments ?? []));
  const [lawSections, setLawSections] = useState<Set<string>>(new Set(initial?.expectLegislationSections ?? []));
  const [phrases, setPhrases] = useState((initial?.expectPhrases ?? []).join("\n"));
  const [answerPhrases, setAnswerPhrases] = useState((initial?.answerPhrases ?? []).join("\n"));
  const [note, setNote] = useState(initial?.note ?? "");
  const [docFilter, setDocFilter] = useState("");
  const [decisionFilter, setDecisionFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let gone = false;
    setRecords(undefined);
    if (corpId) void loadRecords(corpId).then((r) => !gone && setRecords(r));
    return () => {
      gone = true;
    };
    // loadRecords is cached by the parent; only a new strata loads again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [corpId]);

  useEffect(() => {
    void getKnowledgeEntries().then((r) => setEntries(r.ok ? r.entries : []));
  }, []);

  const meeting = records?.meetings.find((m) => m.id === meetingId);
  const match = (q: string, s: string) => !q.trim() || s.toLowerCase().includes(q.trim().toLowerCase());
  const toggle = (set: Set<string>, id: string, update: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    update(next);
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const r = await saveRecallCase({
      id: initial?.id,
      corporationId: corpId,
      question,
      meetingId: meetingId || null,
      itemId: itemId || null,
      expectedAnswer,
      keyFigures,
      expectDocuments: [...docs],
      expectDecisions: [...decisions],
      expectLegislationDocuments: [...lawDocs],
      expectLegislationSections: [...lawSections],
      expectPhrases: phrases,
      answerPhrases,
      note,
    });
    setSaving(false);
    if (!r.ok) return setError(r.error);
    onSaved();
  }

  return (
    <Modal title={initial ? "Edit case" : "Add a case"} onClose={onClose} wide closeOnBackdrop={false} testId="recall-form">
      <form className="recall-form" onSubmit={save}>
        <div className="field">
          <label htmlFor="rc-strata">Strata</label>
          <select
            id="rc-strata"
            value={corpId}
            onChange={(e) => {
              setCorpId(e.target.value);
              setMeetingId("");
              setItemId("");
              setDocs(new Set());
              setDecisions(new Set());
            }}
            required
            data-testid="rc-strata"
          >
            <option value="">Choose a strata</option>
            {corporations.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id}, {c.name}
              </option>
            ))}
          </select>
          {records && !records.subscribed && (
            <p className="form-alert">This strata isn&rsquo;t subscribed, so Stratasphere can&rsquo;t answer for it. Its checks will fail until it is (complimentary works).</p>
          )}
        </div>
        <div className="field">
          <label htmlFor="rc-question">Question, as a council member would ask it</label>
          <textarea id="rc-question" rows={2} maxLength={4000} value={question} onChange={(e) => setQuestion(e.target.value)} required data-testid="rc-question" />
        </div>
        <div className="recall-form__pair">
          <div className="field">
            <label htmlFor="rc-expected">The answer you expect</label>
            <textarea
              id="rc-expected"
              rows={5}
              maxLength={8000}
              value={expectedAnswer}
              onChange={(e) => setExpectedAnswer(e.target.value)}
              placeholder="e.g. $23,333.33: the new policy's premium for September to January, 5 of its 18 months. The previous policy's premium for February to July is on the financial statements."
              data-testid="rc-expected"
            />
          </div>
          <div className="field">
            <label htmlFor="rc-figures">Key figures, one per line</label>
            <textarea
              id="rc-figures"
              rows={5}
              value={keyFigures}
              onChange={(e) => setKeyFigures(e.target.value)}
              placeholder={"$23,333.33\n5 months\n2027-01-31"}
              data-testid="rc-figures"
            />
            <p className="card__meta">Checked in each answer automatically, by value: $23,333.33 matches 23333.33; 2027-01-31 matches January 31, 2027.</p>
          </div>
        </div>

        <p className="card__meta recall-form__divider">
          Optional, for finding out why an answer went wrong: the records that hold the answer. Each run shows whether they reached the AI.
        </p>
        <KnowledgePicker entries={entries} docs={lawDocs} sections={lawSections} labels={knowledgeLabels} onDocs={setLawDocs} onSections={setLawSections} />

        {corpId && records === undefined && <p className="card__meta">Loading this strata&rsquo;s records&hellip;</p>}
        {corpId && records === null && <p className="form-alert">This strata&rsquo;s records couldn&rsquo;t be loaded. Close this and try again.</p>}
        {records && (
          <>
            <div className="recall-form__pair">
              <div className="field">
                <label htmlFor="rc-meeting">Asked during a meeting</label>
                <select
                  id="rc-meeting"
                  value={meetingId}
                  onChange={(e) => {
                    setMeetingId(e.target.value);
                    setItemId("");
                  }}
                >
                  <option value="">No: the Stratasphere window</option>
                  {records.meetings.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
              {meeting && (
                <div className="field">
                  <label htmlFor="rc-item">About this agenda item</label>
                  <select id="rc-item" value={itemId} onChange={(e) => setItemId(e.target.value)} required>
                    <option value="">Choose an item</option>
                    {meeting.items.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <fieldset className="recall-form__pick">
              <legend>The strata&rsquo;s documents ({docs.size} chosen)</legend>
              <input placeholder="Filter documents" value={docFilter} onChange={(e) => setDocFilter(e.target.value)} aria-label="Filter documents" />
              <div className="recall-form__options" data-testid="rc-documents">
                {records.documents
                  .filter((d) => docs.has(d.id) || match(docFilter, d.title))
                  .map((d) => (
                    <label key={d.id} className="field--checkbox">
                      <input type="checkbox" checked={docs.has(d.id)} onChange={() => toggle(docs, d.id, setDocs)} />
                      {d.title}{" "}
                      <span className="card__meta">
                        ({d.uploadedAt}
                        {d.status !== "indexed" ? `, ${d.status.replace("_", " ")}` : ""}
                        {d.copyOf ? `, identical copy of "${d.copyOf}"` : ""})
                      </span>
                    </label>
                  ))}
                {records.documents.length === 0 && <p className="card__meta">No documents on file.</p>}
              </div>
            </fieldset>

            <fieldset className="recall-form__pick">
              <legend>Ledger decisions ({decisions.size} chosen)</legend>
              <input placeholder="Filter decisions" value={decisionFilter} onChange={(e) => setDecisionFilter(e.target.value)} aria-label="Filter decisions" />
              <div className="recall-form__options">
                {records.decisions
                  .filter((d) => decisions.has(d.id) || match(decisionFilter, `${d.decidedAt} ${d.title}`))
                  .map((d) => (
                    <label key={d.id} className="field--checkbox">
                      <input type="checkbox" checked={decisions.has(d.id)} onChange={() => toggle(decisions, d.id, setDecisions)} />
                      {d.decidedAt}: {d.title}
                    </label>
                  ))}
                {records.decisions.length === 0 && <p className="card__meta">No decisions in the ledger.</p>}
              </div>
            </fieldset>
          </>
        )}
        <details className="recall-form__more" open={Boolean(phrases || answerPhrases)}>
          <summary>Exact wording (optional)</summary>
          <div className="recall-form__pair">
            <div className="field">
              <label htmlFor="rc-phrases">Wording that must reach the AI, one per line</label>
              <textarea id="rc-phrases" rows={3} value={phrases} onChange={(e) => setPhrases(e.target.value)} placeholder={"e.g. no more than two pets\nbylaw 3.1"} data-testid="rc-phrases" />
              <p className="card__meta">Short wording from the record itself. Avoid names: they&rsquo;re replaced before anything is sent.</p>
            </div>
            <div className="field">
              <label htmlFor="rc-answer">Wording the answer must use, one per line</label>
              <textarea id="rc-answer" rows={3} value={answerPhrases} onChange={(e) => setAnswerPhrases(e.target.value)} placeholder="e.g. two pets" />
            </div>
          </div>
        </details>
        <div className="field">
          <label htmlFor="rc-note">Note (optional)</label>
          <input id="rc-note" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What this case tests, e.g. prorating across two policies" />
        </div>
        {error && (
          <p className="form-alert" role="alert">
            {error}
          </p>
        )}
        <div className="recall-form__actions">
          <button type="button" className="button button-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button button-primary" disabled={saving} data-testid="rc-save">
            {saving ? "Saving…" : "Save case"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
