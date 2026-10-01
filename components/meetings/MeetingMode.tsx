"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  decisionTypeLabels,
  groupByCategory,
  isAdjournment,
  isApproveAgenda,
  isCallToOrder,
  isNextMeeting,
  makeItem,
  meetingTypeLabels,
  newCategoryId,
  renumber,
  resolutionTypeLabels,
  type AgendaItem,
  type MeetingType,
} from "@/lib/meetings/agenda";
import {
  attendanceRoll,
  evaluateVote,
  isGeneralMeeting,
  minutesSummary,
  quorum,
  unresolvedItems,
  type AttendanceStatus,
} from "@/lib/meetings/rules";
import { callToOrderScript, itemScript, zonedInstant } from "@/lib/meetings/scripts";
import { adjournMeeting, askMeetingAssistant, callToOrder, saveMeetingState } from "@/app/strata/[corpId]/meetings/[meetingId]/run/actions";
import { saveItemNote } from "@/app/strata/[corpId]/meetings/actions";
import { getDocumentDownloadUrl } from "@/app/strata/[corpId]/documents/actions";
import { ItemEditor } from "@/components/meetings/ItemEditor";

/**
 * Meeting Mode (doc01 §4, doc03 Stage 5a). Run by one person — whoever
 * launched the meeting. Attendance and quorum, Call to Order, each item
 * with its script, motion, votes and outcome, the embedded Stratasphere
 * assistant, and adjournment. Everything saves as it changes.
 */

type Lot = { lot: string; name: string; isCouncil: boolean };
type Turn = { role: "user" | "assistant"; content: string; error?: boolean };
type Confirm = { title: string; body: React.ReactNode; confirmLabel: string; danger?: boolean; onConfirm: () => void } | null;

const ATTENDANCE_VIEW = "__attendance__";

export function MeetingMode(props: {
  corpId: string;
  meetingId: string;
  planNumber: string;
  corpName: string;
  type: MeetingType;
  meetingDate: string;
  startTime: string | null;
  timezone: string;
  chairName: string | null;
  status: "DRAFT" | "LIVE";
  actualStartAt: string | null;
  initialAgenda: AgendaItem[];
  initialAttendance: Record<string, AttendanceStatus>;
  initialAgendaApproved: boolean;
  initialNotes: Record<string, string>;
  lots: Lot[];
  isTrial: boolean;
  aiAvailable: boolean;
}) {
  const { corpId, meetingId, type, timezone } = props;
  const router = useRouter();
  const general = isGeneralMeeting(type);

  const [agenda, setAgenda] = useState<AgendaItem[]>(props.initialAgenda);
  const [attendance, setAttendance] = useState<Record<string, AttendanceStatus>>(props.initialAttendance);
  const [agendaApproved, setAgendaApproved] = useState(props.initialAgendaApproved);
  const [startedAt, setStartedAt] = useState<string | null>(props.actualStartAt);
  const [current, setCurrent] = useState<string>(() => {
    if (!props.actualStartAt) return ATTENDANCE_VIEW;
    return props.initialAgenda.find((i) => !i.done && !i.deferred)?.id ?? props.initialAgenda[0]?.id ?? ATTENDANCE_VIEW;
  });
  const [notes, setNotes] = useState(props.initialNotes);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [editing, setEditing] = useState<AgendaItem | null>(null);
  const [panel, setPanel] = useState<"none" | "agenda" | "assistant">("none");
  const [busy, setBusy] = useState(false);
  // Coarse clock for the quorum deadline; the visible timer ticks on its own.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);

  // ── Autosave ─────────────────────────────────────────────────────────
  const firstRender = useRef(true);
  const latest = useRef({ agenda, attendance, agendaApproved });
  latest.current = { agenda, attendance, agendaApproved };
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    setSaveState("saving");
    const t = setTimeout(async () => {
      const result = await saveMeetingState(corpId, meetingId, latest.current).catch(() => ({
        ok: false as const,
        error: "Couldn't save. Check your connection; your changes are kept on this screen and will save with your next change.",
      }));
      setSaveState(result.ok ? "saved" : "error");
      setSaveError(result.ok ? null : result.error);
    }, 700);
    return () => clearTimeout(t);
  }, [agenda, attendance, agendaApproved, corpId, meetingId]);

  // ── Roll, quorum ─────────────────────────────────────────────────────
  const councilLots = props.lots.filter((l) => l.isCouncil).map((l) => l.lot);
  const roll = attendanceRoll(type, props.lots.map((l) => l.lot), councilLots);
  const names = useMemo(() => Object.fromEntries(props.lots.map((l) => [l.lot, l.name])), [props.lots]);
  const q = quorum(type, { lotCount: props.lots.length, councilCount: roll.length, attendance });
  const present = roll.filter((l) => attendance[l] === "present");
  const voters = present.length + (general ? q.proxies : 0);
  const called = Boolean(startedAt);

  const scheduled = props.startTime ? zonedInstant(props.meetingDate, props.startTime, timezone).getTime() : null;
  const quorumDeadlinePassed = !called && scheduled !== null && now > scheduled + 30 * 60 * 1000;

  const update = useCallback((fn: (a: AgendaItem[]) => AgendaItem[]) => setAgenda((a) => renumber(fn(a))), []);
  const patchItem = useCallback(
    (id: string, patch: Partial<AgendaItem>) => update((a) => a.map((i) => (i.id === id ? { ...i, ...patch } : i))),
    [update]
  );

  const item = agenda.find((i) => i.id === current) ?? null;

  function goNext(fromId: string, list = agenda) {
    const idx = list.findIndex((i) => i.id === fromId);
    const next = list.slice(idx + 1).find((i) => !i.done && !i.deferred) ?? list.find((i) => !i.done && !i.deferred);
    if (next) setCurrent(next.id);
    setPanel("none");
  }

  // ── Attendance ──────────────────────────────────────────────────────
  const cycle: AttendanceStatus[] = general ? ["", "present", "regrets", "proxy"] : ["", "present", "regrets"];
  function cycleLot(lot: string) {
    setAttendance((a) => {
      const next = cycle[(cycle.indexOf(a[lot] ?? "") + 1) % cycle.length];
      const out = { ...a };
      if (next) out[lot] = next;
      else delete out[lot];
      return out;
    });
  }
  function markAll(status: AttendanceStatus) {
    setAttendance(status ? Object.fromEntries(roll.map((l) => [l, status])) : {});
  }

  // ── Call to Order ───────────────────────────────────────────────────
  async function doCallToOrder() {
    const cto = agenda.find(isCallToOrder);
    setBusy(true);
    const result = await callToOrder(corpId, meetingId, attendance).catch(() => ({ ok: false as const, error: "Couldn't reach the server. Try again." }));
    setBusy(false);
    if (!result.ok) return setSaveError(result.error);
    setStartedAt(result.startedAt);
    if (cto) {
      const regrets = roll.filter((l) => attendance[l] === "regrets");
      const proxies = roll.filter((l) => attendance[l] === "proxy");
      const summary = general
        ? `${present.length} strata lots were present${proxies.length ? ` and ${proxies.length} represented by proxy` : ""}. Quorum was confirmed and the meeting was called to order.`
        : `The following strata lots were present: ${present.join(", ")}.${regrets.length ? ` Regrets received from: ${regrets.join(", ")}.` : ""} Quorum was confirmed and the meeting was called to order.`;
      const next = renumber(agenda.map((i) => (i.id === cto.id ? { ...i, done: true, minutesSummary: i.minutesSummary || summary } : i)));
      setAgenda(next);
      goNext(cto.id, next);
    }
  }

  // ── Decisions ───────────────────────────────────────────────────────
  function confirmDecision(it: AgendaItem) {
    const m = it.motion!;
    if (!m.mover || !m.sec) return setSaveError("Choose a mover and a seconder first.");
    if (m.mover === m.sec) return setSaveError("The mover and seconder must be different lots.");
    const v = evaluateVote(m);
    if (v.total === 0) return setSaveError("Record the votes first.");
    const outcome = v.passing ? "CARRIED" : "DEFEATED";
    setSaveError(null);
    setConfirm({
      title: outcome === "CARRIED" ? "Motion carried" : "Motion defeated",
      confirmLabel: `Record as ${outcome}`,
      danger: outcome === "DEFEATED",
      body: (
        <>
          <p>&ldquo;{it.text}&rdquo;</p>
          <p>
            Moved by {m.mover}, seconded by {m.sec}.<br />
            {decisionTypeLabels[m.dt]}: {m.for} in favour, {m.against} opposed{m.abstain ? `, ${m.abstain} abstaining` : ""}.
            {m.abstain ? " Abstentions don't count toward the threshold." : ""}
          </p>
          {m.dt !== "MAJORITY" && (
            <p className="form-error">Confirm the exact wording of this resolution was included with the meeting notice (SPA s.45).</p>
          )}
          {m.dt === "THREE_QUARTER" && outcome === "CARRIED" && (
            <p className="card__meta">A 3/4 vote resolution takes effect after a one-week delay unless immediate action is needed for safety.</p>
          )}
          <p className="card__meta">This can&rsquo;t be undone.</p>
        </>
      ),
      onConfirm: () => recordOutcome(it, outcome),
    });
  }

  function recordOutcome(it: AgendaItem, outcome: "CARRIED" | "DEFEATED", motionPatch: Partial<NonNullable<AgendaItem["motion"]>> = {}) {
    const decided: AgendaItem = { ...it, done: true, deferred: false, motion: { ...it.motion!, ...motionPatch, outcome } };
    decided.minutesSummary = it.minutesSummary || minutesSummary(decided);
    const next = renumber(agenda.map((i) => (i.id === it.id ? decided : i)));
    setAgenda(next);
    if (isApproveAgenda(it) && outcome === "CARRIED") setAgendaApproved(true);
    setConfirm(null);
    if (isAdjournment(it) && outcome === "CARRIED") return startAdjournment(next);
    goNext(it.id, next);
  }

  function unanimous(it: AgendaItem) {
    const m = it.motion!;
    if (!m.mover || !m.sec) return setSaveError("Choose a mover and a seconder first.");
    if (m.mover === m.sec) return setSaveError("The mover and seconder must be different lots.");
    setSaveError(null);
    setConfirm({
      title: "Unanimous vote",
      confirmLabel: "Record as unanimous",
      body: <p>&ldquo;{it.text}&rdquo; — record as carried unanimously, {voters} in favour?</p>,
      onConfirm: () => recordOutcome(it, "CARRIED", { for: voters, against: 0, abstain: 0 }),
    });
  }

  function defer(it: AgendaItem) {
    setConfirm({
      title: "Defer this item?",
      confirmLabel: "Defer",
      body: <p>&ldquo;{it.text}&rdquo; will be marked deferred. You can come back to it later in this meeting.</p>,
      onConfirm: () => {
        const next = renumber(agenda.map((i) => (i.id === it.id ? { ...i, deferred: true } : i)));
        setAgenda(next);
        setConfirm(null);
        goNext(it.id, next);
      },
    });
  }

  function consensus(it: AgendaItem) {
    setConfirm({
      title: "Accept by consensus?",
      confirmLabel: "Accept",
      body: <p>&ldquo;{it.text}&rdquo; — mark as accepted by consensus and move on?</p>,
      onConfirm: () => {
        const next = renumber(
          agenda.map((i) =>
            i.id === it.id
              ? { ...i, done: true, deferred: false, consensus: true, minutesSummary: i.minutesSummary || `${i.text} was reviewed and accepted by consensus.` }
              : i
          )
        );
        setAgenda(next);
        setConfirm(null);
        goNext(it.id, next);
      },
    });
  }

  function markReceived(it: AgendaItem) {
    const next = renumber(
      agenda.map((i) => (i.id === it.id ? { ...i, done: true, deferred: false, minutesSummary: i.minutesSummary || minutesSummary({ ...i, done: true }) } : i))
    );
    setAgenda(next);
    goNext(it.id, next);
  }

  // ── Adjournment ─────────────────────────────────────────────────────
  function startAdjournment(list: AgendaItem[], noQuorum = false) {
    const open = unresolvedItems(list).filter((i) => !isAdjournment(i) || !noQuorum);
    const finish = async () => {
      setConfirm(null);
      setBusy(true);
      const marked = noQuorum
        ? list.map((i) => (isAdjournment(i) ? { ...i, done: true, minutesSummary: "Quorum was not achieved. The meeting was adjourned without business being conducted." } : i))
        : list;
      const result = await adjournMeeting(corpId, meetingId, marked, attendance).catch(() => ({ ok: false as const, error: "Couldn't reach the server. Try again." }));
      setBusy(false);
      if (!result.ok) return setSaveError(result.error);
      router.push(`/strata/${corpId}/meetings/${meetingId}/minutes`);
    };
    if (open.length > 0) {
      setConfirm({
        title: "Unresolved items",
        confirmLabel: "Defer them and adjourn",
        body: (
          <>
            <p>This meeting has unresolved agenda items. Mark all unresolved agenda items as deferred?</p>
            <ul className="attachment-list">
              {open.map((i) => (
                <li key={i.id}>
                  {i.num}. {i.text}
                </li>
              ))}
            </ul>
          </>
        ),
        onConfirm: finish,
      });
    } else {
      void finish();
    }
  }

  function adjournWithoutQuorum() {
    setConfirm({
      title: "Adjourn without quorum?",
      confirmLabel: "Adjourn",
      danger: true,
      body: <p>No business can be conducted without quorum. The meeting is adjourned and every item is recorded as deferred.</p>,
      onConfirm: () => startAdjournment(agenda, true),
    });
  }

  // ── Adding and editing during the meeting ───────────────────────────
  function guardApproved(action: () => void) {
    if (!agendaApproved) return action();
    setConfirm({
      title: "Are you sure?",
      confirmLabel: "Yes, change the agenda",
      body: <p>The agenda has already been approved!</p>,
      onConfirm: () => {
        setConfirm(null);
        action();
      },
    });
  }

  function addItem() {
    guardApproved(() => {
      const nb = agenda.find((i) => /new business/i.test(i.cat));
      const it = makeItem("New item", nb?.cat ?? "New Business", { catId: nb?.catId ?? newCategoryId(), addedDuringMeeting: agendaApproved || undefined });
      const adjIdx = agenda.findIndex(isAdjournment);
      const next = [...agenda];
      const lastInCat = nb ? next.map((i) => i.catId).lastIndexOf(nb.catId) + 1 : adjIdx < 0 ? next.length : adjIdx;
      next.splice(lastInCat, 0, it);
      update(() => next);
      setEditing(it);
    });
  }

  function saveEdited(edited: AgendaItem, note: string) {
    const exists = agenda.some((i) => i.id === edited.id);
    update((a) => (exists ? a.map((i) => (i.id === edited.id ? edited : i)) : [...a, edited]));
    setEditing(null);
    setCurrent(edited.id);
    if ((notes[edited.id] ?? "") !== note) {
      setNotes((n) => ({ ...n, [edited.id]: note }));
      void saveItemNote(corpId, meetingId, edited.id, note);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div className="mm" data-testid="meeting-mode">
      <header className="mm__top">
        <div className="mm__title">
          <strong>{meetingTypeLabels[type]}</strong>
          <span>
            {props.planNumber} &middot; {props.corpName}
            {props.isTrial ? " · Free meeting" : ""}
          </span>
        </div>
        <div className="mm__clock" aria-live="off">
          <MeetingClock startedAt={startedAt} scheduled={scheduled} />
        </div>
        <div className="mm__status" role="status">
          {saveState === "saving" ? "Saving…" : saveState === "error" ? "Not saved" : "Saved"}
        </div>
        <button type="button" className="button button-secondary button-small mm__toggle" onClick={() => setPanel(panel === "agenda" ? "none" : "agenda")} aria-expanded={panel === "agenda"}>
          Agenda
        </button>
        <button type="button" className="button button-secondary button-small mm__toggle" onClick={() => setPanel(panel === "assistant" ? "none" : "assistant")} aria-expanded={panel === "assistant"}>
          Stratasphere
        </button>
        <Link href={`/strata/${corpId}/meetings/${meetingId}`} className="button button-secondary button-small">
          Exit
        </Link>
      </header>

      {saveError && (
        <div className="mm__alert" role="alert">
          {saveError}
          <button type="button" className="link-button" onClick={() => setSaveError(null)}>
            Dismiss
          </button>
        </div>
      )}
      {quorumDeadlinePassed && !q.met && (
        <div className="mm__alert" role="alert">
          30 minutes have passed since the scheduled start and quorum hasn&rsquo;t been confirmed. No decisions may be made.{" "}
          <button type="button" className="link-button" onClick={adjournWithoutQuorum}>
            Adjourn the meeting
          </button>
        </div>
      )}

      <div className="mm__body" data-panel={panel}>
        <nav className="mm__nav" aria-label="Agenda">
          <button type="button" className="mm-nav__item" data-active={current === ATTENDANCE_VIEW} data-done={called} onClick={() => { setCurrent(ATTENDANCE_VIEW); setPanel("none"); }}>
            <span className="mm-nav__check" aria-hidden="true">{called ? <Tick /> : null}</span>
            Attendance <span className="card__meta">({q.counted})</span>
          </button>
          {groupByCategory(agenda).map((cat) => (
            <div key={cat.id}>
              <div className="mm-nav__cat">{cat.name}</div>
              {cat.items.map((it) => (
                <button
                  type="button"
                  key={it.id}
                  className="mm-nav__item"
                  data-active={current === it.id}
                  data-done={it.done}
                  data-deferred={it.deferred && !it.done}
                  onClick={() => {
                    setCurrent(it.id);
                    setPanel("none");
                  }}
                >
                  <span className="mm-nav__check" aria-hidden="true">{it.done ? <Tick /> : null}</span>
                  <span>
                    {it.num}. {it.text}
                    {it.deferred && !it.done && <span className="card__meta"> (deferred)</span>}
                    <span className="visually-hidden">{it.done ? " (done)" : ""}</span>
                  </span>
                </button>
              ))}
            </div>
          ))}
          <button type="button" className="button button-secondary button-small mm-nav__add" onClick={addItem} data-testid="mm-add-item">
            Add item
          </button>
        </nav>

        <main className="mm__main">
          {current === ATTENDANCE_VIEW || !item ? (
            <section className="mm-panel" data-testid="mm-attendance">
              <h2>Attendance</h2>
              <p className="card__meta">
                {general
                  ? "Every strata lot. Tap a lot to cycle: present, regrets, proxy. Proxies count toward quorum."
                  : "Council members. Tap to cycle: present, regrets. Late arrivals can be added any time."}
              </p>
              <QuorumBar q={q} general={general} />
              <div className="mm-roll__bulk">
                <button type="button" className="button button-secondary button-small" onClick={() => markAll("present")}>
                  All present
                </button>
                <button type="button" className="button button-secondary button-small" onClick={() => markAll("regrets")}>
                  All regrets
                </button>
                <button type="button" className="button button-secondary button-small" onClick={() => markAll("")}>
                  Clear
                </button>
              </div>
              {roll.length === 0 ? (
                <p className="roster-notice">
                  No {general ? "lots" : "council members"} on the lot roster yet. Mark council members on the Strata Lots page first.
                </p>
              ) : (
                <div className="mm-roll">
                  {roll.map((lot) => (
                    <button type="button" key={lot} className="mm-roll__lot" data-status={attendance[lot] || "none"} onClick={() => cycleLot(lot)} data-testid={`att-${lot}`}>
                      <strong>{lot}</strong>
                      {!general && names[lot] && <span>{names[lot]}</span>}
                      <em>{statusLabel(attendance[lot] ?? "")}</em>
                    </button>
                  ))}
                </div>
              )}
              {!called && (
                <div className="mm-actions">
                  <button
                    type="button"
                    className="button button-primary"
                    onClick={() => {
                      const cto = agenda.find(isCallToOrder);
                      if (cto) setCurrent(cto.id);
                    }}
                    data-testid="mm-confirm-attendance"
                  >
                    Confirm attendance
                  </button>
                </div>
              )}
            </section>
          ) : isCallToOrder(item) ? (
            <CallToOrderPanel
              q={q}
              called={called}
              startedAt={startedAt}
              timezone={timezone}
              busy={busy}
              script={callToOrderScript({ type, planNumber: props.planNumber, chair: props.chairName, quorumMet: q.met, counted: q.counted, required: q.required, timezone })}
              onCall={doCallToOrder}
              onAdjournNoQuorum={adjournWithoutQuorum}
              onAttendance={() => setCurrent(ATTENDANCE_VIEW)}
              general={general}
            />
          ) : (
            <ItemPanel
              key={item.id}
              corpId={corpId}
              item={item}
              general={general}
              called={called}
              present={present}
              names={names}
              note={notes[item.id] ?? ""}
              onNote={(body) => {
                setNotes((n) => ({ ...n, [item.id]: body }));
                void saveItemNote(corpId, meetingId, item.id, body);
              }}
              onPatch={(patch) => patchItem(item.id, patch)}
              onConfirm={() => confirmDecision(item)}
              onUnanimous={() => unanimous(item)}
              onDefer={() => defer(item)}
              onConsensus={() => consensus(item)}
              onReceived={() => markReceived(item)}
              onSkip={() => goNext(item.id)}
              onEdit={() => guardApproved(() => setEditing(item))}
              onTakeUp={() => patchItem(item.id, { deferred: false })}
            />
          )}
        </main>

        <aside className="mm__assistant" aria-label="Stratasphere assistant">
          <Assistant
            key={item?.id ?? "none"}
            corpId={corpId}
            meetingId={meetingId}
            item={item}
            agenda={agenda}
            aiAvailable={props.aiAvailable}
            isTrial={props.isTrial}
          />
        </aside>
      </div>

      {editing && (
        <ItemEditor
          corpId={corpId}
          meetingId={meetingId}
          item={editing}
          note={notes[editing.id] ?? ""}
          categories={[...new Set(agenda.map((i) => i.cat))]}
          onSave={saveEdited}
          onClose={() => setEditing(null)}
        />
      )}
      {confirm && <ConfirmDialog {...confirm} busy={busy} onCancel={() => setConfirm(null)} />}
    </div>
  );
}

/** Elapsed time since Call to Order, or the 30-minute quorum window before it. */
function MeetingClock({ startedAt, scheduled }: { startedAt: string | null; scheduled: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const hh = (n: number) => String(n).padStart(2, "0");
  if (startedAt) {
    const elapsed = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
    return (
      <span title="Time since Call to Order">
        {hh(Math.floor(elapsed / 3600))}:{hh(Math.floor((elapsed % 3600) / 60))}:{hh(elapsed % 60)}
      </span>
    );
  }
  if (scheduled === null) return null;
  const left = scheduled + 30 * 60000 - now;
  return (
    <span className={left <= 0 ? "mm__clock--late" : undefined} title="Quorum must be reached within 30 minutes of the scheduled start">
      {left <= 0 ? "Quorum window passed" : now < scheduled ? "Not started" : `Quorum window: ${Math.ceil(left / 60000)} min`}
    </span>
  );
}

function statusLabel(s: AttendanceStatus) {
  return s === "present" ? "Present" : s === "regrets" ? "Regrets" : s === "proxy" ? "Proxy" : "—";
}

function QuorumBar({ q, general }: { q: ReturnType<typeof quorum>; general: boolean }) {
  const text =
    q.counted === 0
      ? `Mark attendance to check quorum (${q.required} required).`
      : q.met
        ? `Quorum met: ${q.present} present${general && q.proxies ? ` + ${q.proxies} by proxy` : ""}, ${q.required} required.`
        : `Quorum not met: ${q.present} present${general && q.proxies ? ` + ${q.proxies} by proxy` : ""}, ${q.required} required.`;
  return (
    <div className="mm-quorum" data-state={q.counted === 0 ? "pending" : q.met ? "met" : "fail"} role="status">
      {text}
    </div>
  );
}

function CallToOrderPanel(props: {
  q: ReturnType<typeof quorum>;
  called: boolean;
  startedAt: string | null;
  timezone: string;
  busy: boolean;
  script: { title: string; lines: string[] };
  onCall: () => void;
  onAdjournNoQuorum: () => void;
  onAttendance: () => void;
  general: boolean;
}) {
  return (
    <section className="mm-panel" data-testid="mm-call-to-order">
      <h2>Call to Order</h2>
      <QuorumBar q={props.q} general={props.general} />
      {props.called ? (
        <p>
          Called to order at{" "}
          {new Date(props.startedAt!).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit", timeZone: props.timezone, timeZoneName: "short" })}. The
          clock is running.
        </p>
      ) : (
        <>
          <Script title={props.script.title} lines={props.script.lines} />
          <div className="mm-actions">
            <button type="button" className="button button-secondary" onClick={props.onAttendance}>
              Attendance
            </button>
            {!props.q.met && props.q.counted > 0 && (
              <button type="button" className="button button-danger" onClick={props.onAdjournNoQuorum}>
                Adjourn without quorum
              </button>
            )}
            <button type="button" className="button button-primary" onClick={props.onCall} disabled={!props.q.met || props.busy} data-testid="mm-call-to-order-button">
              Call to Order
            </button>
          </div>
          <p className="card__meta">If quorum isn&rsquo;t reached within 30 minutes of the scheduled start, no decisions may be made.</p>
        </>
      )}
    </section>
  );
}

function Script({ title, lines }: { title: string; lines: string[] }) {
  return (
    <details className="mm-script" open>
      <summary>{title}</summary>
      {lines.map((l, i) =>
        l.startsWith("[") ? (
          <p key={i} className="mm-script__direction">
            {l.slice(1, -1)}
          </p>
        ) : (
          <p key={i}>{l}</p>
        )
      )}
    </details>
  );
}

function ItemPanel(props: {
  corpId: string;
  item: AgendaItem;
  general: boolean;
  called: boolean;
  present: string[];
  names: Record<string, string>;
  note: string;
  onNote: (body: string) => void;
  onPatch: (patch: Partial<AgendaItem>) => void;
  onConfirm: () => void;
  onUnanimous: () => void;
  onDefer: () => void;
  onConsensus: () => void;
  onReceived: () => void;
  onSkip: () => void;
  onEdit: () => void;
  onTakeUp: () => void;
}) {
  const { item: it, onPatch } = props;
  const m = it.motion;
  const script = itemScript(it);
  const vote = m ? evaluateVote(m) : null;
  const [note, setNote] = useState(props.note);
  const locked = it.done || !props.called;
  const setMotion = (patch: Partial<NonNullable<AgendaItem["motion"]>>) => onPatch({ motion: { ...m!, ...patch } });
  const lotLabel = (lot: string) => (!props.general && props.names[lot] ? `${lot} — ${props.names[lot]}` : lot);

  async function openAttachment(documentId: string | null, url?: string) {
    if (!documentId && url) return window.open(url, "_blank", "noopener,noreferrer");
    if (!documentId) return;
    const result = await getDocumentDownloadUrl(props.corpId, documentId);
    if (result.ok) window.open(result.url, "_blank", "noopener,noreferrer");
  }

  return (
    <section className="mm-panel" data-testid="mm-item">
      <div className="mm-item__head">
        <div>
          <div className="card__meta">{it.cat}</div>
          <h2>
            {it.num}. {it.text}
          </h2>
          <div className="mm-item__tags">
            <span className={`rtag rtag--${it.type.toLowerCase()}`}>{resolutionTypeLabels[it.type]}</span>
            {m && <span className="rtag">{decisionTypeLabels[m.dt]}</span>}
            {it.addedDuringMeeting && <span className="rtag">Added during meeting</span>}
            {it.done && <span className="pill mm-outcome" data-outcome={m?.outcome ?? "DONE"}>{m?.outcome ?? (it.consensus ? "Consensus" : "Done")}</span>}
            {it.deferred && !it.done && <span className="pill">Deferred</span>}
          </div>
        </div>
        {!it.done && (
          <button type="button" className="button button-secondary button-small" onClick={props.onEdit}>
            Edit item
          </button>
        )}
      </div>

      {!props.called && (
        <p className="mm__alert">The meeting hasn&rsquo;t been called to order yet. Nothing can be decided until it is.</p>
      )}

      {script && <Script title="Chair script" lines={[script]} />}

      {!isNextMeeting(it) && !isAdjournment(it) && (it.background || it.financial || it.risks) && (
        <div className="mm-details">
          {it.background && <Detail title="Background / rationale" body={it.background} />}
          {it.financial && <Detail title="Financial implications" body={it.financial} />}
          {it.risks && <Detail title="Risks / compliance" body={it.risks} />}
        </div>
      )}

      {it.atts.length > 0 && (
        <div className="mm-details">
          <h3 className="mm-subhead">Attachments</h3>
          <ul className="attachment-list">
            {it.atts.map((a) => (
              <li key={a.id}>
                <span className="pill">{a.kind === "link" ? "Link" : "File"}</span>
                <button type="button" className="link-button" onClick={() => openAttachment(a.documentId, a.kind === "link" ? a.url : undefined)}>
                  {a.title}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {isNextMeeting(it) && (
        <div className="field-grid">
          {(["date", "time", "location"] as const).map((f) => (
            <label className={`field${f === "location" ? " field--wide" : ""}`} key={f}>
              <span>{f === "date" ? "Next meeting date" : f === "time" ? "Time" : "Location or link"}</span>
              <input
                type={f === "date" ? "date" : f === "time" ? "time" : "text"}
                value={it.nextMeeting?.[f] ?? ""}
                onChange={(e) => onPatch({ nextMeeting: { date: "", time: "", location: "", ...it.nextMeeting, [f]: e.target.value } })}
              />
            </label>
          ))}
        </div>
      )}

      {m && (
        <div className="mm-vote">
          <label className="field">
            <span>Motion</span>
            <textarea rows={2} value={m.text} onChange={(e) => setMotion({ text: e.target.value })} disabled={it.done} data-testid="mm-motion" />
          </label>
          <div className="field-grid">
            <label className="field">
              <span>Moved by</span>
              <select value={m.mover} onChange={(e) => setMotion({ mover: e.target.value, sec: e.target.value === m.sec ? "" : m.sec })} disabled={locked} data-testid="mm-mover">
                <option value="">Choose…</option>
                {props.present.map((l) => (
                  <option key={l} value={l}>
                    {lotLabel(l)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Seconded by</span>
              <select value={m.sec} onChange={(e) => setMotion({ sec: e.target.value })} disabled={locked} data-testid="mm-seconder">
                <option value="">Choose…</option>
                {props.present
                  .filter((l) => l !== m.mover)
                  .map((l) => (
                    <option key={l} value={l}>
                      {lotLabel(l)}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <div className="mm-tally">
            {(["for", "against", "abstain"] as const).map((k) => (
              <div className="mm-tally__box" key={k}>
                <span className="mm-tally__label">{k === "for" ? "In favour" : k === "against" ? "Opposed" : "Abstain"}</span>
                <div className="mm-tally__controls">
                  <button type="button" className="icon-button" aria-label={`One fewer ${k}`} onClick={() => setMotion({ [k]: Math.max(0, m[k] - 1) })} disabled={locked}>
                    &minus;
                  </button>
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={m[k]}
                    onChange={(e) => setMotion({ [k]: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                    disabled={locked}
                    aria-label={k === "for" ? "Votes in favour" : k === "against" ? "Votes opposed" : "Abstentions"}
                    data-testid={`mm-votes-${k}`}
                  />
                  <button type="button" className="icon-button" aria-label={`One more ${k}`} onClick={() => setMotion({ [k]: m[k] + 1 })} disabled={locked}>
                    +
                  </button>
                </div>
              </div>
            ))}
          </div>
          <p className="mm-threshold" data-state={it.done ? m.outcome?.toLowerCase() : vote && vote.cast > 0 ? (vote.passing ? "passing" : "failing") : "pending"}>
            {it.done
              ? m.outcome
              : vote && vote.cast > 0
                ? `Need ${vote.needed} of ${vote.cast} cast${m.abstain ? ` (${m.abstain} abstaining)` : ""}: ${vote.passing ? "passing" : "failing"}`
                : "No votes recorded yet"}
          </p>
        </div>
      )}

      {!it.done && props.called && (
        <div className="mm-actions">
          {it.deferred && (
            <button type="button" className="button button-secondary" onClick={props.onTakeUp}>
              Take it up now
            </button>
          )}
          {m ? (
            <>
              <button type="button" className="button button-secondary" onClick={props.onDefer} data-testid="mm-defer">
                Defer
              </button>
              {(it.type === "FOR_DIRECTION" || it.type === "FOR_DISCUSSION") && (
                <button type="button" className="button button-secondary" onClick={props.onConsensus}>
                  Consensus
                </button>
              )}
              <button type="button" className="button button-secondary" onClick={props.onUnanimous} data-testid="mm-unanimous">
                Unanimous
              </button>
              <button type="button" className="button button-primary" onClick={props.onConfirm} data-testid="mm-confirm-decision">
                Confirm decision
              </button>
            </>
          ) : (
            <>
              <button type="button" className="button button-secondary" onClick={props.onSkip}>
                Skip for now
              </button>
              {it.type === "FOR_DISCUSSION" && (
                <button type="button" className="button button-secondary" onClick={props.onConsensus}>
                  Consensus
                </button>
              )}
              <button type="button" className="button button-primary" onClick={props.onReceived} data-testid="mm-next">
                {it.type === "FOR_INFORMATION" ? "Received, next item" : "Done, next item"}
              </button>
            </>
          )}
        </div>
      )}

      {!isAdjournment(it) && (
        <label className="field">
          <span>Minutes summary</span>
          <textarea
            rows={3}
            value={it.minutesSummary}
            onChange={(e) => onPatch({ minutesSummary: e.target.value })}
            placeholder="What was done (not what was said). Filled in for you when the item is decided; edit as needed."
            data-testid="mm-minutes-summary"
          />
        </label>
      )}

      <details className="mm-private">
        <summary>Private notes</summary>
        <textarea
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => note !== props.note && props.onNote(note)}
          placeholder="Only you see this. Not in the minutes, never sent to Stratasphere, deleted when the minutes are finalized."
          aria-label="Private notes"
          data-testid="mm-private-note"
        />
      </details>
    </section>
  );
}

function Detail({ title, body }: { title: string; body: string }) {
  return (
    <details className="mm-detail">
      <summary>{title}</summary>
      <p>{body}</p>
    </details>
  );
}

function Assistant(props: {
  corpId: string;
  meetingId: string;
  item: AgendaItem | null;
  agenda: AgendaItem[];
  aiAvailable: boolean;
  isTrial: boolean;
}) {
  // One conversation per item, for this session only (doc02 §4b).
  const [log, setLog] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [log, busy]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const q = text.trim();
    if (!q || !props.item || busy) return;
    setText("");
    const history = log.filter((t) => !t.error).map(({ role, content }) => ({ role, content }));
    setLog((l) => [...l, { role: "user", content: q }]);
    setBusy(true);
    const result = await askMeetingAssistant(props.corpId, props.meetingId, props.item.id, props.agenda, history, q).catch(() => ({
      ok: false as const,
      error: "Stratasphere couldn't answer right now. Please try again.",
    }));
    setBusy(false);
    setLog((l) => [...l, result.ok ? { role: "assistant", content: result.text } : { role: "assistant", content: result.error, error: true }]);
  }

  return (
    <div className="mm-ai">
      <div className="mm-ai__head">
        <strong>Stratasphere&trade;</strong>
        <span className="card__meta">
          {props.item?.atts.length ? `${props.item.atts.length} attachment${props.item.atts.length === 1 ? "" : "s"} in context · ` : ""}
          Names removed before sending
        </span>
      </div>
      <div className="mm-ai__log" ref={listRef} aria-live="polite">
        {log.length === 0 && (
          <p className="card__meta">
            {props.aiAvailable
              ? `Ask about this item, your bylaws, past decisions, or meeting procedure.${props.isTrial ? " Your free meeting includes ten questions." : ""}`
              : "The assistant needs a Stratasphere subscription."}
          </p>
        )}
        {log.map((t, i) => (
          <div key={i} className="mm-ai__msg" data-role={t.role} data-error={t.error || undefined}>
            {t.content}
          </div>
        ))}
        {busy && (
          <div className="mm-ai__msg" data-role="assistant">
            Thinking…
          </div>
        )}
      </div>
      <form className="mm-ai__form" onSubmit={send}>
        <textarea
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              (e.currentTarget.form as HTMLFormElement).requestSubmit();
            }
          }}
          placeholder={props.item ? "Ask Stratasphere…" : "Open an agenda item to ask about it"}
          disabled={!props.aiAvailable || !props.item}
          aria-label="Ask Stratasphere"
          data-testid="mm-ai-input"
        />
        <button type="submit" className="button button-primary button-small" disabled={!props.aiAvailable || !props.item || busy || !text.trim()}>
          Ask
        </button>
      </form>
    </div>
  );
}

function ConfirmDialog(props: NonNullable<Confirm> & { busy: boolean; onCancel: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const cancel = useRef(props.onCancel);
  cancel.current = props.onCancel;
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && cancel.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="modal-backdrop" onClick={props.onCancel}>
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="mm-confirm-title" onClick={(e) => e.stopPropagation()} data-testid="mm-confirm">
        <h2 id="mm-confirm-title">{props.title}</h2>
        {props.body}
        <div className="role-editor__actions">
          <button ref={ref} type="button" className="button button-secondary" onClick={props.onCancel} disabled={props.busy}>
            Cancel
          </button>
          <button type="button" className={`button ${props.danger ? "button-danger" : "button-primary"}`} onClick={props.onConfirm} disabled={props.busy} data-testid="mm-confirm-ok">
            {props.busy ? "Working…" : props.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function Tick() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12l5 5 9-10" />
    </svg>
  );
}
