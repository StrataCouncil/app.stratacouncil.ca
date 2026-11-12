"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/Modal";
import {
  deleteRecallCase,
  getStrataRecords,
  runAnswerCheck,
  runFindCheck,
  saveRecallCase,
  type StrataRecords,
} from "@/app/admin/recall/actions";
import { tz } from "@/lib/time-zone";

/**
 * The recall check (docs/learn-decide-remember.md §7): the cases, their
 * latest results, and the form to write one. Checks run one case at a time
 * from here, so a long list never runs into a server time limit.
 */

type Run = { passed: boolean; at: string; details: Record<string, unknown>; costUsd: number } | null;

export interface RecallCaseView {
  id: string;
  corporationId: string;
  question: string;
  meetingId: string | null;
  itemId: string | null;
  expectDocuments: string[];
  expectDecisions: string[];
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

function Status({ run, testId }: { run: Run; testId: string }) {
  if (!run) return <span className="card__meta" data-testid={testId}>Not run</span>;
  return (
    <span data-testid={testId}>
      <span className={`billing-tag ${run.passed ? "billing-tag--ok" : "billing-tag--warn"}`}>{run.passed ? "Pass" : "Fail"}</span>
      <span className="roster-table__meta">{when(run.at)}</span>
    </span>
  );
}

export function RecallAdmin({ cases, corporations, costPerQuestion }: { cases: RecallCaseView[]; corporations: Corp[]; costPerQuestion: number }) {
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
  const found = shown.filter((c) => c.find?.passed).length;
  const answered = shown.filter((c) => c.answer?.passed).length;

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
        `This asks the AI ${plural(list.length, "question")}, at about ${usd(costPerQuestion)} each: about ${usd(estimate)} in all. Go ahead?`
      );
      if (!ok) return;
    }
    setError(null);
    setBusy(kind);
    let spent = 0;
    let failed = 0;
    for (let i = 0; i < list.length; i++) {
      setProgress(`${kind === "find" ? "Checking finding" : "Checking answers"}: ${i + 1} of ${list.length}${kind === "answer" && spent ? `, ${usd(spent)} so far` : ""}`);
      const r = kind === "find" ? await runFindCheck(list[i].id) : await runAnswerCheck(list[i].id);
      if (!r.ok) {
        failed++;
        setError(r.error);
        continue;
      }
      if ("costUsd" in r) spent += r.costUsd;
      if (!r.passed) failed++;
    }
    setProgress(
      `${kind === "find" ? "Finding" : "Answers"}: ${list.length - failed} of ${list.length} passed${kind === "answer" ? `. Cost ${usd(spent)}.` : "."}`
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
            Check finding for all ({shown.length})
          </button>
          <button type="button" className="button button-secondary" disabled={busy !== null || !shown.length} onClick={() => runAll("answer", shown)} data-testid="recall-answer-all">
            Check answers for all
          </button>
          <button type="button" className="button button-primary" disabled={busy !== null} onClick={() => setEditing("new")} data-testid="recall-add">
            Add a case
          </button>
        </div>
      </div>

      {shown.length > 0 && (
        <p className="card__meta" data-testid="recall-summary">
          Finding: {found} of {shown.length} pass. Answers: {answered} of {shown.length} pass. An answering check costs about {usd(costPerQuestion)} a case
          (the average of recent Stratasphere questions).
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
            No cases yet. Add one for each kind of question Stratasphere must get right: bylaw questions worded nothing like the bylaw, exact lot
            and bylaw numbers, old decisions, scanned documents, agenda attachments, counting, and something that truly isn&rsquo;t on file.
          </p>
        </div>
      ) : (
        <div className="roster-table-wrap">
          <table className="roster-table recall__table">
            <thead>
              <tr>
                <th>Question</th>
                <th>Holds the answer</th>
                <th>Finding</th>
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
                  records={records[c.corporationId] ?? null}
                  busy={busy}
                  onToggle={() => toggle(c)}
                  onFind={() => runAll("find", [c])}
                  onAnswer={() => runAll("answer", [c])}
                  onEdit={async () => {
                    await loadRecords(c.corporationId);
                    setEditing(c);
                  }}
                  onDelete={() => remove(c)}
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
  records,
  busy,
  onToggle,
  onFind,
  onAnswer,
  onEdit,
  onDelete,
}: {
  c: RecallCaseView;
  corpName: string;
  open: boolean;
  records: StrataRecords | null;
  busy: string | null;
  onToggle: () => void;
  onFind: () => void;
  onAnswer: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const expects = [
    c.expectDocuments.length ? plural(c.expectDocuments.length, "document") : "",
    c.expectDecisions.length ? plural(c.expectDecisions.length, "decision") : "",
    c.expectPhrases.length ? plural(c.expectPhrases.length, "phrase") : "",
  ].filter(Boolean);
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
            {c.note ? `. ${c.note}` : ""}
          </div>
        </td>
        <td>{expects.join(", ")}</td>
        <td>
          <Status run={c.find} testId="recall-find-status" />
        </td>
        <td>
          <Status run={c.answer} testId="recall-answer-status" />
        </td>
        <td className="demo-links__actions">
          <button type="button" className="button button-secondary button-small" disabled={busy !== null} onClick={onFind} data-testid="recall-find">
            Check finding
          </button>
          <button type="button" className="button button-secondary button-small" disabled={busy !== null} onClick={onAnswer} data-testid="recall-answer">
            Check answer
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
          <td colSpan={5}>
            <RecallDetails c={c} records={records} />
          </td>
        </tr>
      )}
    </>
  );
}

type Finding = { id?: string; phrase?: string; found: boolean; where?: string };

function RecallDetails({ c, records }: { c: RecallCaseView; records: StrataRecords | null }) {
  const docTitle = (id: string) => records?.documents.find((d) => d.id === id)?.title ?? "A document no longer on file";
  const decisionTitle = (id: string) => {
    const d = records?.decisions.find((x) => x.id === id);
    return d ? `${d.decidedAt}: ${d.title}` : "A decision no longer in the ledger";
  };
  const f = c.find?.details as
    | { problem?: string; documents?: Finding[]; decisions?: Finding[]; phrases?: Finding[]; searchFailed?: boolean; contextChars?: number; searchResults?: Array<{ rank: number; documentId: string | null; title: string | null; similarity: number }> }
    | undefined;
  const a = c.answer?.details as { answer?: string; phrases?: Finding[]; cited?: Finding[] } | undefined;
  const mark = (x: Finding) => (x.found ? "Found" : "Missing");

  return (
    <div className="recall__details" data-testid="recall-details">
      <div>
        <h3>Finding</h3>
        {!f ? (
          <p className="card__meta">Not run yet.</p>
        ) : f.problem ? (
          <p className="form-alert">{f.problem}</p>
        ) : (
          <>
            {f.searchFailed && <p className="form-alert">The search failed, so only the bylaws, ledger, and profile were sent.</p>}
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
              {(f.phrases ?? []).map((p) => (
                <li key={`p${p.phrase}`} data-found={p.found}>
                  <strong>{mark(p)}</strong> &ldquo;{p.phrase}&rdquo;
                </li>
              ))}
            </ul>
            <p className="card__meta">
              {Math.round((f.contextChars ?? 0) / 1000)}k characters sent. The strata&rsquo;s own search results:{" "}
              {(f.searchResults ?? []).length
                ? (f.searchResults ?? []).map((r) => `${r.rank}. ${r.documentId ? docTitle(r.documentId) : r.title ?? "?"} (${r.similarity})`).join("; ")
                : "none"}
              .
            </p>
          </>
        )}
      </div>
      <div>
        <h3>Answer</h3>
        {!a ? (
          <p className="card__meta">Not run yet.</p>
        ) : (
          <>
            <ul className="recall__list">
              {(a.phrases ?? []).map((p) => (
                <li key={`ap${p.phrase}`} data-found={p.found}>
                  <strong>{p.found ? "Stated" : "Not stated"}</strong> &ldquo;{p.phrase}&rdquo;
                </li>
              ))}
              {(a.cited ?? []).map((d) => (
                <li key={`ac${d.id}`} data-found={d.found}>
                  <strong>{d.found ? "Cited" : "Not cited"}</strong> {docTitle(d.id!)}
                </li>
              ))}
            </ul>
            <blockquote className="recall__answer">{a.answer}</blockquote>
            <p className="card__meta">Cost {usd(c.answer?.costUsd ?? 0)}.</p>
          </>
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
  const [meetingId, setMeetingId] = useState(initial?.meetingId ?? "");
  const [itemId, setItemId] = useState(initial?.itemId ?? "");
  const [docs, setDocs] = useState<Set<string>>(new Set(initial?.expectDocuments ?? []));
  const [decisions, setDecisions] = useState<Set<string>>(new Set(initial?.expectDecisions ?? []));
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
      expectDocuments: [...docs],
      expectDecisions: [...decisions],
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
            <p className="form-alert">This strata isn&rsquo;t subscribed, so Stratasphere can&rsquo;t search it. Its checks will fail until it is (complimentary works).</p>
          )}
        </div>
        <div className="field">
          <label htmlFor="rc-question">Question, as a council member would ask it</label>
          <textarea id="rc-question" rows={2} maxLength={4000} value={question} onChange={(e) => setQuestion(e.target.value)} required data-testid="rc-question" />
        </div>
        {corpId && records === undefined && <p className="card__meta">Loading this strata&rsquo;s records&hellip;</p>}
        {corpId && records === null && <p className="form-alert">This strata&rsquo;s records couldn&rsquo;t be loaded. Close this and try again.</p>}
        {records && (
          <>
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

            <fieldset className="recall-form__pick">
              <legend>Documents that hold the answer ({docs.size} chosen)</legend>
              <input placeholder="Filter documents" value={docFilter} onChange={(e) => setDocFilter(e.target.value)} aria-label="Filter documents" />
              <div className="recall-form__options" data-testid="rc-documents">
                {records.documents
                  .filter((d) => docs.has(d.id) || match(docFilter, d.title))
                  .map((d) => (
                    <label key={d.id} className="field--checkbox">
                      <input type="checkbox" checked={docs.has(d.id)} onChange={() => toggle(docs, d.id, setDocs)} />
                      {d.title} <span className="card__meta">({d.uploadedAt}{d.status !== "indexed" ? `, ${d.status.replace("_", " ")}` : ""})</span>
                    </label>
                  ))}
                {records.documents.length === 0 && <p className="card__meta">No documents on file.</p>}
              </div>
            </fieldset>

            <fieldset className="recall-form__pick">
              <legend>Ledger decisions that hold the answer ({decisions.size} chosen)</legend>
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
        <div className="recall-form__pair">
          <div className="field">
            <label htmlFor="rc-phrases">Phrases that must reach the AI, one per line</label>
            <textarea
              id="rc-phrases"
              rows={4}
              value={phrases}
              onChange={(e) => setPhrases(e.target.value)}
              placeholder={"e.g. no more than two pets\nbylaw 3.1"}
              data-testid="rc-phrases"
            />
            <p className="card__meta">Short wording from the record itself. Avoid names: they&rsquo;re replaced before anything is sent.</p>
          </div>
          <div className="field">
            <label htmlFor="rc-answer">Phrases the answer must state, one per line (optional)</label>
            <textarea id="rc-answer" rows={4} value={answerPhrases} onChange={(e) => setAnswerPhrases(e.target.value)} placeholder="e.g. two pets" />
          </div>
        </div>
        <div className="field">
          <label htmlFor="rc-note">Note (optional)</label>
          <input id="rc-note" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What this case tests, e.g. a bylaw worded nothing like the question" />
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
