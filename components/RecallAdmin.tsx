"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/Modal";
import {
  deleteRecallCase,
  getStrataRecords,
  markRecallAnswer,
  runAnswerCheck,
  saveRecallCase,
  type StrataRecords,
} from "@/app/admin/recall/actions";
import { getDocumentDownloadUrl } from "@/app/strata/[corpId]/documents/actions";
import { answerSegments } from "@/lib/ai/answer-text";
import { KIND_LABELS, type CitedRecord } from "@/lib/ai/citations";
import type { ReferenceComparison } from "@/lib/ai/recall";
import { tz } from "@/lib/time-zone";

/**
 * The recall check (docs/learn-decide-remember.md §7). A case is a question
 * a council member would ask. Ask puts it to Stratasphere exactly as a
 * member would; the answer comes with how it got there (each record it
 * cited, with the passage that was sent, its calculations, and what it
 * looked at but didn't use), and a person checks it and marks it Right,
 * Partly, or Wrong. Once an answer is marked Right, each new answer is
 * compared with it: the same figures, from the same records. Checks run one
 * case at a time from here, so a long list never runs into a server time
 * limit.
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
  /** The newest answer marked Right, and how the latest answer compares (null when the latest is that one). */
  reference: { at: string; comparison: ReferenceComparison | null } | null;
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

function AnswerStatus({ c }: { c: RecallCaseView }) {
  const run = c.answer;
  if (!run) return <span className="card__meta" data-testid="recall-answer-status">Not asked</span>;
  const v = VERDICTS.find((x) => x.value === run.verdict);
  const cmp = c.reference?.comparison;
  return (
    <span className="recall__status" data-testid="recall-answer-status">
      {v ? <span className={`billing-tag ${v.tag}`}>{v.label}</span> : <span className="billing-tag billing-tag--off">To check</span>}
      {!v && cmp && (
        <span className={`roster-table__meta ${cmp.same ? "" : "recall__short"}`} data-testid="recall-compare">
          {cmp.same ? "Same as the Right answer" : "Differs from the Right answer"}
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
}: {
  cases: RecallCaseView[];
  corporations: Corp[];
  costPerQuestion: number;
  /** Titles of Knowledge Base entries named by older cases (kept, not shown). */
  knowledgeLabels?: Record<string, string>;
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
  const count = (v: Verdict) => shown.filter((c) => c.answer?.verdict === v).length;
  const toCheck = shown.filter((c) => c.answer && !c.answer.verdict).length;
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

  async function ask(list: RecallCaseView[]) {
    if (!list.length) return;
    const ok = window.confirm(
      `This asks Stratasphere ${plural(list.length, "question")}, at about ${usd(costPerQuestion)} each: about ${usd(list.length * costPerQuestion)} in all. Go ahead?`
    );
    if (!ok) return;
    setError(null);
    setBusy("ask");
    let spent = 0;
    let problems = 0;
    for (let i = 0; i < list.length; i++) {
      setProgress(`Asking ${i + 1} of ${list.length}${spent ? `, ${usd(spent)} so far` : ""}`);
      const r = await runAnswerCheck(list[i].id);
      if (!r.ok) {
        problems++;
        setError(r.error);
        continue;
      }
      spent += r.costUsd;
    }
    setProgress(`Asked ${plural(list.length - problems, "question")}. Cost ${usd(spent)}. Open each to check it.`);
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
          <button type="button" className="button button-secondary" disabled={busy !== null || !notRight.length} onClick={() => ask(notRight)} data-testid="recall-answer-not-right">
            Ask the ones not Right ({notRight.length})
          </button>
          <button type="button" className="button button-secondary" disabled={busy !== null || !shown.length} onClick={() => ask(shown)} data-testid="recall-answer-all">
            Ask all ({shown.length})
          </button>
          <button type="button" className="button button-primary" disabled={busy !== null} onClick={() => setEditing("new")} data-testid="recall-add">
            Add a question
          </button>
        </div>
      </div>

      {shown.length > 0 && (
        <p className="card__meta" data-testid="recall-summary">
          {count("right")} Right, {count("partly")} Partly, {count("wrong")} Wrong{toCheck ? `, ${toCheck} to check` : ""}. Asking costs about{" "}
          {usd(costPerQuestion)} a question (the average of recent Stratasphere questions).
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
            No questions yet. Add the questions council members really ask: bylaws worded nothing like the question, exact lot and bylaw numbers, old
            decisions, sums and prorating, the Strata Property Act, and something that truly isn&rsquo;t on file. Then ask, and check each answer
            and where it came from.
          </p>
        </div>
      ) : (
        <div className="roster-table-wrap">
          <table className="roster-table recall__table">
            <thead>
              <tr>
                <th>Question</th>
                <th>Answer</th>
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
                  busy={busy}
                  onToggle={() => setOpen(open === c.id ? null : c.id)}
                  onAsk={() => ask([c])}
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
  busy,
  onToggle,
  onAsk,
  onEdit,
  onDelete,
  onMarked,
}: {
  c: RecallCaseView;
  corpName: string;
  open: boolean;
  busy: string | null;
  onToggle: () => void;
  onAsk: () => void;
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
            {c.itemId ? ", asked about an agenda item" : ""}
            {c.note ? `. ${c.note}` : ""}
          </div>
        </td>
        <td>
          <AnswerStatus c={c} />
        </td>
        <td className="demo-links__actions">
          <button type="button" className="button button-primary button-small" disabled={busy !== null} onClick={onAsk} data-testid="recall-answer">
            Ask
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
          <td colSpan={3}>
            <RecallDetails c={c} onMarked={onMarked} />
          </td>
        </tr>
      )}
    </>
  );
}

type AnswerDetails = {
  answer?: string;
  rawAnswer?: string;
  cited?: CitedRecord[];
  unused?: CitedRecord[];
  calculations?: Array<{ name: string; input: unknown; result: string }>;
  find?: { sizes?: Record<string, number>; contextChars?: number };
  usage?: unknown;
};

const SIZE_LABELS: Array<[string, string]> = [
  ["passages", "document passages"],
  ["ledger", "decision ledger"],
  ["bylaws", "bylaws"],
  ["platform", "platform records"],
  ["legislation", "Knowledge Base"],
  ["precedent", "precedent"],
  ["otherForQuestion", "attachments and other records"],
  ["rules", "instructions"],
];

/** The answer, with a numbered reference after each fact pointing to the record below that backs it. */
function NumberedAnswer({ a }: { a: AnswerDetails }) {
  const cited = a.cited ?? [];
  if (!a.rawAnswer || !cited.length) return <blockquote className="recall__answer" data-testid="recall-answer-text">{a.answer}</blockquote>;
  const number = new Map(cited.map((r, i) => [r.tag, i + 1]));
  const segments = answerSegments(a.rawAnswer, new Set(number.keys()));
  return (
    <blockquote className="recall__answer" data-testid="recall-answer-text">
      {segments.map((s, i) =>
        "text" in s ? (
          <span key={i}>{s.text}</span>
        ) : (
          <sup key={i} className="recall__ref">
            {s.tags
              .map((t) => number.get(t))
              .filter(Boolean)
              .map((n, j) => (
                <a key={j} href={`#src-${n}`}>
                  {j ? "," : ""}
                  {n}
                </a>
              ))}
          </sup>
        )
      )}
    </blockquote>
  );
}

function SourceItem({ r, n, corpId }: { r: CitedRecord; n?: number; corpId: string }) {
  const [problem, setProblem] = useState<string | null>(null);
  async function openDoc() {
    if (!r.documentId) return;
    setProblem(null);
    const res = await getDocumentDownloadUrl(corpId, r.documentId, { view: true });
    if (!res.ok) return setProblem(res.error);
    window.open(res.url, "_blank", "noopener");
  }
  return (
    <li id={n ? `src-${n}` : undefined} className="recall__source">
      <div>
        {n ? <strong>{n}. </strong> : null}
        <span className="card__meta">{KIND_LABELS[r.kind] ?? r.kind}: </span>
        {r.kind === "legislation" && r.sourceAct && r.sourceAct !== r.title ? `${r.sourceAct}, ${r.title}` : r.title}
        {r.documentId && (
          <>
            {" "}
            <button type="button" className="link-button" onClick={openDoc}>
              Open
            </button>
          </>
        )}
      </div>
      {r.excerpt && (
        <details>
          <summary>The text that was sent</summary>
          <pre className="recall__excerpt">{r.excerpt}</pre>
        </details>
      )}
      {problem && <p className="form-alert">{problem}</p>}
    </li>
  );
}

function RecallDetails({ c, onMarked }: { c: RecallCaseView; onMarked: () => void }) {
  const a = c.answer?.details as AnswerDetails | undefined;
  const [note, setNote] = useState(c.answer?.verdictNote ?? "");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const cmp = c.reference?.comparison;
  const sizes = a?.find?.sizes;

  async function mark(verdict: Verdict | null) {
    if (!c.answer) return;
    setSaving(true);
    setProblem(null);
    const r = await markRecallAnswer(c.answer.id, verdict, note);
    setSaving(false);
    if (!r.ok) return setProblem(r.error);
    onMarked();
  }

  if (!a) return <p className="card__meta recall__details">Not asked yet. Press Ask to put this question to Stratasphere.</p>;

  return (
    <div className="recall__details" data-testid="recall-details">
      <div>
        <h3>Stratasphere&rsquo;s answer</h3>
        <NumberedAnswer a={a} />
        {cmp && !cmp.same && (
          <div className="recall__compare" data-testid="recall-compare-details">
            <strong>Compared with the answer marked Right ({when(c.reference!.at)}):</strong>
            <ul className="recall__list">
              {cmp.figuresMissing.map((f) => (
                <li key={`m${f}`} data-found="false">
                  <strong>No longer states</strong> {f}
                </li>
              ))}
              {cmp.figuresNew.map((f) => (
                <li key={`n${f}`}>
                  <strong>Now states</strong> {f}
                </li>
              ))}
              {cmp.sourcesDropped.map((s) => (
                <li key={s.key} data-found="false">
                  <strong>No longer uses</strong> {s.title}
                </li>
              ))}
            </ul>
          </div>
        )}
        {cmp?.same && <p className="card__meta">Same figures, from the same records, as the answer marked Right ({when(c.reference!.at)}).</p>}
        {c.expectedAnswer && (
          <>
            <h3>What you expected</h3>
            <blockquote className="recall__answer">{c.expectedAnswer}</blockquote>
          </>
        )}
        <p className="card__meta">Cost {usd(c.answer?.costUsd ?? 0)}.</p>

        <div className="recall__verdict" data-testid="recall-verdict">
          <label htmlFor={`note-${c.id}`}>What was right or wrong, and anything it should have used (optional)</label>
          <textarea id={`note-${c.id}`} rows={3} maxLength={4000} value={note} onChange={(e) => setNote(e.target.value)} />
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
      </div>

      <div>
        <h3>How it got the answer</h3>
        {(a.cited ?? []).length ? (
          <ol className="recall__sources" data-testid="recall-cited">
            {(a.cited ?? []).map((r, i) => (
              <SourceItem key={r.tag} r={r} n={i + 1} corpId={c.corporationId} />
            ))}
          </ol>
        ) : (
          <p className="card__meta">This answer didn&rsquo;t cite any record.</p>
        )}
        {(a.calculations ?? []).length > 0 && (
          <details className="recall__calc" open>
            <summary>Calculations ({(a.calculations ?? []).length})</summary>
            <pre>{(a.calculations ?? []).map((x) => x.result).join("\n\n")}</pre>
          </details>
        )}
        {(a.unused ?? []).length > 0 && (
          <details className="recall__unused" data-testid="recall-unused">
            <summary>Looked at but didn&rsquo;t use ({(a.unused ?? []).length})</summary>
            <ul className="recall__sources">
              {(a.unused ?? []).map((r) => (
                <SourceItem key={r.tag} r={r} corpId={c.corporationId} />
              ))}
            </ul>
          </details>
        )}
        {sizes && (
          <p className="card__meta" data-testid="recall-sizes">
            {kChars(sizes.total)} characters sent:{" "}
            {SIZE_LABELS.filter(([k]) => (sizes[k] ?? 0) > 0)
              .map(([k, label]) => `${label} ${kChars(sizes[k])}`)
              .join(", ")}
            .
          </p>
        )}
      </div>
    </div>
  );
}

function CaseForm({
  initial,
  corporations,
  defaultStrata,
  loadRecords,
  onClose,
  onSaved,
}: {
  initial: RecallCaseView | null;
  corporations: Corp[];
  defaultStrata: string;
  loadRecords: (corpId: string) => Promise<StrataRecords | null>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [corpId, setCorpId] = useState(initial?.corporationId ?? defaultStrata);
  // Undefined while loading, null if it couldn't load.
  const [records, setRecords] = useState<StrataRecords | null | undefined>(undefined);
  const [question, setQuestion] = useState(initial?.question ?? "");
  const [expectedAnswer, setExpectedAnswer] = useState(initial?.expectedAnswer ?? "");
  const [meetingId, setMeetingId] = useState(initial?.meetingId ?? "");
  const [itemId, setItemId] = useState(initial?.itemId ?? "");
  const [note, setNote] = useState(initial?.note ?? "");
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

  const meeting = records?.meetings.find((m) => m.id === meetingId);
  const sameStrata = initial?.corporationId === corpId;

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
      // Records named by older cases are kept as they were (for the same strata).
      keyFigures: (initial?.keyFigures ?? []).join("\n"),
      expectDocuments: sameStrata ? (initial?.expectDocuments ?? []) : [],
      expectDecisions: sameStrata ? (initial?.expectDecisions ?? []) : [],
      expectLegislationDocuments: initial?.expectLegislationDocuments ?? [],
      expectLegislationSections: initial?.expectLegislationSections ?? [],
      expectPhrases: (initial?.expectPhrases ?? []).join("\n"),
      answerPhrases: (initial?.answerPhrases ?? []).join("\n"),
      note,
    });
    setSaving(false);
    if (!r.ok) return setError(r.error);
    onSaved();
  }

  return (
    <Modal title={initial ? "Edit question" : "Add a question"} onClose={onClose} wide closeOnBackdrop={false} testId="recall-form">
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
            <p className="form-alert">This strata isn&rsquo;t subscribed, so Stratasphere can&rsquo;t answer for it until it is (complimentary works).</p>
          )}
        </div>
        <div className="field">
          <label htmlFor="rc-question">Question, as a council member would ask it</label>
          <textarea id="rc-question" rows={3} maxLength={4000} value={question} onChange={(e) => setQuestion(e.target.value)} required data-testid="rc-question" />
        </div>
        {records && records.meetings.length > 0 && (
          <div className="recall-form__pair">
            <div className="field">
              <label htmlFor="rc-meeting">Asked during a meeting (optional)</label>
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
        )}
        <div className="field">
          <label htmlFor="rc-expected">The answer you expect (optional)</label>
          <textarea
            id="rc-expected"
            rows={3}
            maxLength={8000}
            value={expectedAnswer}
            onChange={(e) => setExpectedAnswer(e.target.value)}
            placeholder="Shown beside Stratasphere's answer, for comparing. Leave it blank to judge the answer as it comes."
            data-testid="rc-expected"
          />
        </div>
        <div className="field">
          <label htmlFor="rc-note">Note (optional)</label>
          <input id="rc-note" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What this question tests, e.g. prorating across two policies" />
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
            {saving ? "Saving…" : "Save question"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
