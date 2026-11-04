"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  decisionTypeLabels,
  electChairMotion,
  groupByCategory,
  isAdjournment,
  isApproveAgenda,
  isCallToOrder,
  isElectChair,
  isNextMeeting,
  makeItem,
  meetingTypeLabels,
  newCategoryId,
  newMotion,
  renumber,
  resolutionTypeLabels,
  type AgendaItem,
  type MeetingType,
} from "@/lib/meetings/agenda";
import {
  attendanceRoll,
  effectiveDecisionType,
  evaluateVote,
  isGeneralMeeting,
  isTie,
  minutesSummary,
  quorum,
  thresholdText,
  tieBreakAllowed,
  unresolvedItems,
  type AttendanceStatus,
  type VoteContext,
} from "@/lib/meetings/rules";
import { callToOrderScript, zonedInstant } from "@/lib/meetings/scripts";
import { currentStep, itemSteps, usesLiveVoting, type Step } from "@/lib/meetings/steps";
import { adjournMeeting, askMeetingAssistant, callToOrder, saveMeetingState } from "@/app/strata/[corpId]/meetings/[meetingId]/run/actions";
import { saveItemNote } from "@/app/strata/[corpId]/meetings/actions";
import { getDocumentDownloadUrl } from "@/app/strata/[corpId]/documents/actions";
import { openInNewTab } from "@/lib/open-in-tab";
import { ItemEditor } from "@/components/meetings/ItemEditor";
import { MeetingSide, MeetingUser, SharedViewer, TypedConfirm, useLeaveWarning } from "@/components/meetings/MeetingChrome";
import { DEMO_LIMITS, DEMO_LIMIT_MESSAGE, SIGNUP_URL } from "@/lib/demo";
import { isDemoLimit, showDemoLimit } from "@/lib/demo-client";
import { ConflictsPanel, RunnerVotePanel } from "@/components/meetings/LiveVote";
import { applyPresence, isJoin, presentForItem, type Presenting, takesConflicts, type Choice, type ClosedVote, type LiveConflict, type LiveState, type OpenVote } from "@/lib/meetings/live";
import {
  cancelVote,
  closeVote,
  declareConflict,
  getLiveState,
  joinMeeting,
  markJoined,
  markLeft,
  openVote,
  recordAllInFavour,
  recordVote,
  showToEveryone,
  withdrawConflict,
} from "@/app/strata/[corpId]/meetings/[meetingId]/live/actions";

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
  /** The demo site: questions left for Meeting Mode's Stratasphere. Null elsewhere. */
  demoLeft?: number | null;
  /** Live votes and conflicts as loaded with the page (0073). */
  initialLive?: LiveState | null;
  /** Whoever is running it, shown top right. */
  me: { name: string; avatarUrl: string | null };
}) {
  const { corpId, meetingId, type, timezone } = props;
  const [demoLeft, setDemoLeft] = useState(props.demoLeft ?? null);
  const router = useRouter();
  const general = isGeneralMeeting(type);

  const [agenda, setAgenda] = useState<AgendaItem[]>(props.initialAgenda);
  const [attendance, setAttendance] = useState<Record<string, AttendanceStatus>>(props.initialAttendance);
  const [agendaApproved, setAgendaApproved] = useState(props.initialAgendaApproved);
  const [chair, setChair] = useState(props.chairName);
  const [startedAt, setStartedAtState] = useState<string | null>(props.actualStartAt);
  const setStartedAt = (at: string | null) => {
    startedRef.current = at;
    setStartedAtState(at);
  };
  const [current, setCurrent] = useState<string>(() => {
    if (!props.actualStartAt) return ATTENDANCE_VIEW;
    return props.initialAgenda.find((i) => !i.done && !i.deferred)?.id ?? props.initialAgenda[0]?.id ?? ATTENDANCE_VIEW;
  });
  const [notes, setNotes] = useState(props.initialNotes);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  // Why Confirm decision didn't go ahead, shown beside it.
  const [actionError, setActionError] = useState<{ itemId: string; message: string } | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [editing, setEditing] = useState<AgendaItem | null>(null);
  const [panel, setPanel] = useState<"none" | "agenda" | "assistant">("none");
  // The shared attachment, hidden on this screen (by when it was shown).
  const [hiddenShow, setHiddenShow] = useState<string | null>(null);
  // A lot the runner is marking as having left (typed confirmation).
  const [marking, setMarking] = useState<string | null>(null);
  const [markError, setMarkError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Coarse clock for the quorum deadline; the visible timer ticks on its own.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);

  // Closing the window by accident would leave the meeting without whoever runs it.
  useLeaveWarning(true);

  // ── Autosave ─────────────────────────────────────────────────────────
  const firstRender = useRef(true);
  const currentItemId = current === ATTENDANCE_VIEW ? null : current;
  const latest = useRef({ agenda, attendance, agendaApproved, currentItemId });
  latest.current = { agenda, attendance, agendaApproved, currentItemId };
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
  }, [agenda, attendance, agendaApproved, currentItemId, corpId, meetingId]);

  /** Saves now, for steps that need the saved agenda (opening a vote). */
  async function saveNow() {
    const result = await saveMeetingState(corpId, meetingId, latest.current).catch(() => ({ ok: false as const, error: "Couldn't save." }));
    setSaveState(result.ok ? "saved" : "error");
    return result.ok;
  }

  // ── Live votes and conflicts (0073) ─────────────────────────────────
  const [live, setLive] = useState<LiveState | null>(props.initialLive ?? null);
  const [liveNow, setLiveNow] = useState(() => Date.now());
  const [liveBusy, setLiveBusy] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  // Joins and leaves (0074) are written to attendance by the database; the
  // ones this screen hasn't seen yet are applied here, so its autosave
  // keeps them rather than writing over them.
  const presenceSeen = useRef((props.initialLive?.presence ?? []).reduce((n, p) => Math.max(n, p.id), 0));
  const startedRef = useRef<string | null>(props.actualStartAt);
  const refreshLive = useCallback(async () => {
    const s = await getLiveState(meetingId).catch(() => null);
    if (s) {
      setLive(s);
      const r = applyPresence(latest.current.attendance, s.presence, presenceSeen.current, startedRef.current);
      presenceSeen.current = r.lastId;
      if (r.changed) setAttendance(r.attendance as Record<string, AttendanceStatus>);
    }
    setLiveNow(Date.now());
  }, [meetingId]);
  // Whoever runs the meeting is in it too.
  useEffect(() => {
    void joinMeeting(meetingId).then(() => refreshLive());
  }, [meetingId, refreshLive]);
  const voteOpen = Boolean(live?.openVote);
  useEffect(() => {
    void refreshLive();
    // Faster while a vote is open, so ballots appear as they're cast.
    const t = setInterval(() => void refreshLive(), voteOpen ? 2000 : 6000);
    return () => clearInterval(t);
  }, [refreshLive, voteOpen]);
  const conflicts: LiveConflict[] = live?.conflicts ?? [];

  // ── Roll, quorum ─────────────────────────────────────────────────────
  const councilLots = props.lots.filter((l) => l.isCouncil).map((l) => l.lot);
  const roll = attendanceRoll(type, props.lots.map((l) => l.lot), councilLots);
  const names = useMemo(() => Object.fromEntries(props.lots.map((l) => [l.lot, l.name])), [props.lots]);
  const q = quorum(type, { lotCount: props.lots.length, councilCount: roll.length, attendance });
  const present = roll.filter((l) => attendance[l] === "present");
  const voters = present.length + (general ? q.proxies : 0);
  // Who the thresholds count: members present (council), votes cast or every lot's vote (general).
  const voteCtx: VoteContext = { type, present: voters, eligible: props.lots.length, lotCount: props.lots.length };
  // Council: anyone with a declared conflict on an item isn't present for its votes (SPA s.32).
  const votersFor = (it: AgendaItem) => (general ? voters : presentForItem(present, conflicts, it.id).length);
  const ctxFor = (it: AgendaItem): VoteContext => ({ ...voteCtx, present: votersFor(it) });
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
      // Someone who left comes back as present.
    const next = cycle[(Math.max(0, cycle.indexOf(a[lot] ?? "")) + 1) % cycle.length];
      const out = { ...a };
      if (next) out[lot] = next;
      else delete out[lot];
      return out;
    });
  }
  function markAll(status: AttendanceStatus) {
    setAttendance(status ? Object.fromEntries(roll.map((l) => [l, status])) : {});
  }

  // Council meetings (0075): marking someone present records the time, as
  // joining online does; taking someone out is always Mark as left.
  async function markPresent(lots: string[]) {
    if (!lots.length) return;
    setAttendance((a) => ({ ...a, ...Object.fromEntries(lots.map((l) => [l, "present" as AttendanceStatus])) }));
    setBusy(true);
    const results = await Promise.all(lots.map((l) => markJoined(meetingId, l).catch(() => ({ ok: false as const, error: "Couldn't reach the server. Try again." }))));
    setBusy(false);
    const failed = results.find((r) => !r.ok);
    if (failed && !failed.ok) setSaveError(failed.error);
    await refreshLive();
  }
  function toggleRegrets(lot: string) {
    setAttendance((a) => {
      const out = { ...a };
      if (out[lot] === "regrets") delete out[lot];
      else out[lot] = "regrets";
      return out;
    });
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
  function blockAction(it: AgendaItem, message: string) {
    setActionError({ itemId: it.id, message });
  }

  function confirmDecision(it: AgendaItem) {
    const m = it.motion!;
    const voters = votersFor(it);
    const voteCtx = ctxFor(it);
    if (live?.openVote?.itemId === it.id) return blockAction(it, "Close the vote first.");
    // People leave: no decision is made once quorum is lost.
    if (!q.met) return blockAction(it, `No quorum: ${q.counted} present, ${q.required} needed. No decisions can be made until quorum is restored.`);
    if (isElectChair(it) && !it.nominee?.trim()) return blockAction(it, "Enter the nominee first.");
    if (!m.mover || !m.sec) return blockAction(it, "Choose a mover and a seconder first.");
    if (m.mover === m.sec) return blockAction(it, "The mover and seconder must be different lots.");
    const v = evaluateVote(m, voteCtx);
    if (v.total === 0) return blockAction(it, "Record the votes first.");
    if (v.total > voters) {
      return blockAction(it, `${v.total} votes recorded, but only ${voters} ${voters === 1 ? "voter is" : "voters are"} present. Check the count.`);
    }
    const outcome = v.passing ? "CARRIED" : "DEFEATED";
    setActionError(null);
    setConfirm({
      title: outcome === "CARRIED" ? "Motion carried" : "Motion defeated",
      confirmLabel: `Record as ${outcome}`,
      danger: outcome === "DEFEATED",
      body: (
        <>
          <p>&ldquo;{it.text}&rdquo;</p>
          <p>
            Moved by {m.mover}, seconded by {m.sec}.<br />
            {decisionTypeLabels[v.dt]}: {m.for} in favour, {m.against} opposed{m.abstain ? `, ${m.abstain} abstaining` : ""}.
            {v.tieBroken ? ` The president cast a deciding vote ${m.tieBreak === "for" ? "in favour" : "against"}.` : ""}
          </p>
          <p className="card__meta">
            {general
              ? v.dt === "EIGHTY_PERCENT" || v.dt === "UNANIMOUS"
                ? `This counts against the votes of all ${props.lots.length} strata lots, present or not (SPA s.1).`
                : "Abstentions aren't votes cast and don't count toward the threshold (SPA s.1)."
              : `Council decisions need a majority of the ${voters} council members present (Standard Bylaws 18(1)), so an abstention counts like a vote against.`}
          </p>
          {general && m.dt !== "MAJORITY" && (
            <p className="form-error">Confirm the exact wording of this resolution was included with the meeting notice (SPA s.45).</p>
          )}
          {general && m.dt === "THREE_QUARTER" && outcome === "CARRIED" && (
            <p className="card__meta">A 3/4 vote resolution takes effect after a one-week delay unless immediate action is needed for safety.</p>
          )}
          <p className="card__meta">This can&rsquo;t be undone.</p>
        </>
      ),
      onConfirm: () => recordOutcome(it, outcome),
    });
  }

  function recordOutcome(it: AgendaItem, outcome: "CARRIED" | "DEFEATED", motionPatch: Partial<NonNullable<AgendaItem["motion"]>> = {}) {
    const voteCtx = ctxFor(it);
    const motion = { ...it.motion!, ...motionPatch, outcome };
    // What the minutes and the decision ledger record is the threshold that applied.
    motion.dt = effectiveDecisionType(type, motion.dt);
    if (!(motion.tieBreak && tieBreakAllowed(motion, voteCtx))) motion.tieBreak = null;
    const decided: AgendaItem = { ...it, done: true, deferred: false, motion };
    decided.minutesSummary = it.minutesSummary || minutesSummary(decided);
    const next = renumber(agenda.map((i) => (i.id === it.id ? decided : i)));
    setAgenda(next);
    if (isApproveAgenda(it) && outcome === "CARRIED") setAgendaApproved(true);
    if (isElectChair(it) && outcome === "CARRIED" && it.nominee?.trim()) setChair(it.nominee.trim());
    setConfirm(null);
    if (isAdjournment(it) && outcome === "CARRIED") return startAdjournment(next);
    goNext(it.id, next);
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

  // ── Live vote handlers ──────────────────────────────────────────────
  async function liveStep(run: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setLiveBusy(true);
    setLiveError(null);
    const result = await run().catch(() => ({ ok: false as const, error: "Couldn't reach the server. Try again." }));
    setLiveBusy(false);
    if (!result.ok) setLiveError(result.error);
    await refreshLive();
    return result.ok;
  }
  async function show(it: AgendaItem | null, attId: string | null) {
    setLiveBusy(true);
    setLiveError(null);
    // What's shown is read from the saved agenda.
    if (it && !(await saveNow())) {
      setLiveBusy(false);
      return setLiveError("Couldn't save the agenda. Try again.");
    }
    const r = await showToEveryone(meetingId, it?.id ?? null, attId).catch(() => ({ ok: false as const, error: "Couldn't reach the server. Try again." }));
    setLiveBusy(false);
    if (!r.ok) return setLiveError(r.error);
    setHiddenShow(null);
    await refreshLive();
  }

  async function startVote(it: AgendaItem) {
    const m = it.motion;
    if (!m?.text.trim()) return setLiveError("Write the motion before opening the vote.");
    await liveStep(async () => {
      if (!(await saveNow())) return { ok: false as const, error: "Couldn't save the agenda. Check your connection and try again." };
      return openVote(meetingId, it.id, m.text, effectiveDecisionType(type, m.dt));
    });
  }
  function finishVote(it: AgendaItem, vote: OpenVote) {
    const ballots = vote.ballots?.length ?? 0;
    const missing = vote.eligibleLots.length - ballots;
    const close = () =>
      liveStep(async () => {
        const r = await closeVote(vote.id);
        if (!r.ok) return r;
        // The counts come from the database; the motion keeps them (and its link to the vote).
        patchItem(it.id, { motion: { ...it.motion!, ...r.counts, voteId: vote.id } });
        return { ok: true as const };
      }).then(() => setConfirm(null));
    if (missing > 0) {
      setConfirm({
        title: "Close the vote?",
        confirmLabel: "Close vote",
        body: (
          <p>
            {missing} of {vote.eligibleLots.length} council {vote.eligibleLots.length === 1 ? "member hasn't" : "members haven't"} voted. They&rsquo;ll be recorded as abstaining, which for a council vote has the same effect as voting against (Standard Bylaws 18(1)).
          </p>
        ),
        onConfirm: () => void close(),
      });
    } else void close();
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

  /** Add an Elect Chairperson item right after Call to Order and go to it. */
  function electChair() {
    guardApproved(() => {
      const it = makeItem("Elect Chairperson", "Chair", {
        type: "FOR_APPROVAL",
        motion: newMotion("MAJORITY", electChairMotion("")),
        addedDuringMeeting: agendaApproved || undefined,
      });
      const at = agenda.findIndex(isCallToOrder) + 1;
      const next = [...agenda];
      next.splice(at, 0, it);
      update(() => next);
      setCurrent(it.id);
      setPanel("none");
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
          In the meeting
        </button>
        <MeetingUser name={props.me.name} avatarUrl={props.me.avatarUrl} />
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

      {live?.presenting && hiddenShow === live.presenting.at && (
        <div className="mm__alert mm__alert--showing" role="status" data-testid="mm-showing-bar">
          Sharing on screen: <strong>{live.presenting.title || "an attachment"}</strong>{" "}
          <button type="button" className="link-button" onClick={() => setHiddenShow(null)}>
            View
          </button>{" "}
          <button type="button" className="link-button" onClick={() => void show(null, null)} disabled={liveBusy}>
            Stop sharing
          </button>
        </div>
      )}
      {called && !q.met && (
        <div className="mm__alert mm__alert--quorum" role="alert" data-testid="mm-quorum-lost">
          <strong>Quorum lost:</strong> {q.counted} present, {q.required} needed. No decisions can be made until quorum is back. Wait for members to
          return{item?.motion && !item.done ? ", defer this item," : ""} or adjourn.{" "}
          {item?.motion && !item.done && (
            <button type="button" className="link-button" onClick={() => defer(item)}>
              Defer this item
            </button>
          )}{" "}
          <button type="button" className="link-button" onClick={adjournWithoutQuorum}>
            Adjourn the meeting
          </button>
        </div>
      )}

      <div className="mm__body" data-panel={panel}>
        <nav className="mm__nav" aria-label="Agenda">
          <div className="mm-nav__chair mm-nav__chair--top card__meta">
            Chair: {chair || "not set"}
            {!agenda.some((i) => isElectChair(i) && !i.done) && (
              <button type="button" className="link-button" onClick={electChair} data-testid="mm-elect-chair">
                Elect a chair
              </button>
            )}
          </div>
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
                  : "Council members. Joining the meeting marks them present. Tap anyone who isn\u2019t (on the phone, in the room) to mark them present; the time is recorded. Someone who has left no longer counts for quorum or votes."}
              </p>
              <QuorumBar q={q} general={general} />
              {general ? (
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
              ) : (
                <div className="mm-roll__bulk">
                  <button
                    type="button"
                    className="button button-secondary button-small"
                    disabled={busy}
                    onClick={() => void markPresent(roll.filter((l) => attendance[l] !== "present"))}
                    data-testid="mm-all-present"
                  >
                    Everyone else present
                  </button>
                  <button
                    type="button"
                    className="button button-secondary button-small"
                    onClick={() => setAttendance((a) => ({ ...a, ...Object.fromEntries(roll.filter((l) => !a[l]).map((l) => [l, "regrets" as AttendanceStatus])) }))}
                  >
                    Regrets for the rest
                  </button>
                </div>
              )}
              {roll.length === 0 ? (
                <p className="roster-notice">
                  {general ? (
                    "No lots on the lot roster yet."
                  ) : (
                    <>
                      No council members are tied to a strata lot yet. Set each council member&rsquo;s lot on{" "}
                      <Link href={`/strata/${corpId}/council`}>Council</Link>.
                    </>
                  )}
                </p>
              ) : (
                <div className="mm-roll">
                  {roll.map((lot) => {
                    const moves = (live?.presence ?? []).filter((p) => p.lot === lot);
                    const last = moves[moves.length - 1];
                    return (
                      <div key={lot} className="mm-roll__cell">
                        <button
                          type="button"
                          className="mm-roll__lot"
                          data-status={attendance[lot] || "none"}
                          onClick={() => (general ? cycleLot(lot) : attendance[lot] !== "present" && void markPresent([lot]))}
                          aria-disabled={!general && attendance[lot] === "present" ? true : undefined}
                          title={!general && attendance[lot] === "present" ? "Present. Use Mark as left if they leave." : undefined}
                          data-testid={`att-${lot}`}
                        >
                          <strong>{lot}</strong>
                          {!general && names[lot] && <span>{names[lot]}</span>}
                          <em>{statusLabel(attendance[lot] ?? "")}</em>
                          {last && (
                            <small className="mm-roll__time">
                              {last.event === "marked_joined" ? "Marked present" : isJoin(last.event) ? "Joined" : "Left"} {clockAt(last.at, timezone)}
                            </small>
                          )}
                        </button>
                        {!general && attendance[lot] === "present" && (
                          <button
                            type="button"
                            className="link-button mm-roll__left"
                            onClick={() => {
                              setMarkError(null);
                              setMarking(lot);
                            }}
                            data-testid={`mark-left-${lot}`}
                          >
                            Mark as left
                          </button>
                        )}
                        {!general && attendance[lot] !== "present" && attendance[lot] !== "left" && (
                          <button type="button" className="link-button mm-roll__left" onClick={() => toggleRegrets(lot)} data-testid={`regrets-${lot}`}>
                            {attendance[lot] === "regrets" ? "Clear regrets" : "Regrets"}
                          </button>
                        )}
                      </div>
                    );
                  })}
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
              script={callToOrderScript({ type, planNumber: props.planNumber, chair, quorumMet: q.met, counted: q.counted, required: q.required, timezone })}
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
              present={general ? present : presentForItem(present, conflicts, item.id)}
              voters={votersFor(item)}
              voteCtx={ctxFor(item)}
              quorumMet={q.met}
              presenting={live?.presenting ?? null}
              onShow={(attId) => void show(attId ? item : null, attId)}
              live={
                general
                  ? null
                  : {
                      vote: live?.openVote?.itemId === item.id ? live.openVote : null,
                      otherOpenItem:
                        live?.openVote && live.openVote.itemId !== item.id ? (agenda.find((i) => i.id === live.openVote!.itemId)?.num ?? 0) : null,
                      closed: item.motion?.voteId ? (live?.closedVotes.find((v) => v.id === item.motion!.voteId) ?? null) : null,
                      conflicts: conflicts.filter((c) => c.itemId === item.id),
                      allPresent: present,
                      ownLot: live?.myLot ?? null,
                      busy: liveBusy,
                      error: liveError,
                      now: liveNow,
                      onOpen: () => void startVote(item),
                      onRecord: (lot: string, choice: Choice) => void liveStep(() => recordVote(live!.openVote!.id, lot, choice)),
                      onAllInFavour: () => live?.openVote && void liveStep(() => recordAllInFavour(live.openVote!.id)),
                      onClose: () => live?.openVote && finishVote(item, live.openVote),
                      onCancel: () => live?.openVote && void liveStep(() => cancelVote(live.openVote!.id)),
                      onDeclare: (lot: string, note: string) => void liveStep(() => declareConflict(meetingId, item.id, lot, note)),
                      onWithdraw: (lot: string) => void liveStep(() => withdrawConflict(meetingId, item.id, lot)),
                    }
              }
              names={names}
              note={notes[item.id] ?? ""}
              onNote={(body) => {
                setNotes((n) => ({ ...n, [item.id]: body }));
                void saveItemNote(corpId, meetingId, item.id, body);
              }}
              onPatch={(patch) => {
                patchItem(item.id, patch);
                if (actionError?.itemId === item.id) setActionError(null);
              }}
              actionError={actionError?.itemId === item.id ? actionError.message : null}
              onConfirm={() => confirmDecision(item)}
              onDefer={() => defer(item)}
              onConsensus={() => consensus(item)}
              onReceived={() => markReceived(item)}
              onSkip={() => goNext(item.id)}
              onEdit={() => guardApproved(() => setEditing(item))}
              onTakeUp={() => patchItem(item.id, { deferred: false })}
            />
          )}
        </main>

        <MeetingSide
          presence={live?.presence ?? []}
          names={names}
          assistant={
            <Assistant
              key={item?.id ?? "none"}
              corpId={corpId}
              meetingId={meetingId}
              item={item}
              agenda={agenda}
              aiAvailable={props.aiAvailable}
              isTrial={props.isTrial}
              demoLeft={demoLeft}
              setDemoLeft={setDemoLeft}
            />
          }
        />
      </div>

      {editing && (
        <ItemEditor
          corpId={corpId}
          meetingId={meetingId}
          item={editing}
          note={notes[editing.id] ?? ""}
          categories={[...new Set(agenda.map((i) => i.cat))]}
          general={general}
          onSave={saveEdited}
          onClose={() => setEditing(null)}
        />
      )}
      {confirm && <ConfirmDialog {...confirm} busy={busy} onCancel={() => setConfirm(null)} />}
      {live?.presenting && hiddenShow !== live.presenting.at && (
        <SharedViewer
          corpId={corpId}
          presenting={live.presenting}
          runner
          busy={liveBusy}
          onStop={() => void show(null, null)}
          onHide={() => setHiddenShow(live.presenting!.at)}
        />
      )}
      {marking && (
        <TypedConfirm
          title={`${marking}${names[marking] ? ` (${names[marking]})` : ""} left the meeting?`}
          body={<p>They&rsquo;re recorded as having left at this time, and no longer count for quorum or votes. They can rejoin any time.</p>}
          phrase="Left meeting"
          confirmLabel="Mark as left"
          busy={busy}
          error={markError}
          onCancel={() => setMarking(null)}
          onConfirm={async () => {
            setBusy(true);
            const r = await markLeft(meetingId, marking, "Left meeting").catch(() => ({ ok: false as const, error: "Couldn't reach the server. Try again." }));
            setBusy(false);
            if (!r.ok) return setMarkError(r.error);
            setMarking(null);
            await refreshLive();
          }}
        />
      )}
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
  return s === "present" ? "Present" : s === "regrets" ? "Regrets" : s === "proxy" ? "Proxy" : s === "left" ? "Left" : "—";
}

function clockAt(iso: string, timeZone: string) {
  return new Date(iso).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit", timeZone });
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

/** The Runner's steps for the item, in order: a list to follow. Each opens to what to do and what to say. */
function StepList({ steps }: { steps: Step[] }) {
  const cur = currentStep(steps);
  return (
    <ol className="mm-steps" data-testid="mm-steps" aria-label="Steps for this item">
      {steps.map((st, i) => (
        <li key={st.id} className="mm-steps__step" data-state={st.done ? "done" : i === cur ? "current" : "todo"} data-testid={`mm-step-${st.id}`}>
          <span className="mm-steps__mark" aria-hidden="true">
            {st.done ? <Tick /> : i + 1}
          </span>
          <details className="mm-steps__body">
            <summary>
              {st.label}
              <span className="visually-hidden">{st.done ? " (done)" : ""}</span>
            </summary>
            <p className="mm-steps__hint">{st.hint}</p>
            {st.say && <p className="mm-steps__say">{st.say}</p>}
          </details>
        </li>
      ))}
    </ol>
  );
}

function ItemPanel(props: {
  corpId: string;
  item: AgendaItem;
  general: boolean;
  called: boolean;
  present: string[];
  /** Everyone who can vote: those present, plus proxies at a general meeting. */
  voters: number;
  voteCtx: VoteContext;
  quorumMet: boolean;
  /** What's being shown to everyone (0076). */
  presenting: Presenting | null;
  /** Show an attachment to everyone, or stop (null). */
  onShow: (attId: string | null) => void;
  /** Live voting and conflicts (0073); council meetings only. */
  live: null | {
    vote: OpenVote | null;
    otherOpenItem: number | null;
    closed: ClosedVote | null;
    conflicts: LiveConflict[];
    /** Every council lot present, conflicts included (who could declare one). */
    allPresent: string[];
    ownLot: string | null;
    busy: boolean;
    error: string | null;
    now: number;
    onOpen: () => void;
    onRecord: (lot: string, choice: Choice) => void;
    onAllInFavour: () => void;
    onClose: () => void;
    onCancel: () => void;
    onDeclare: (lot: string, note: string) => void;
    onWithdraw: (lot: string) => void;
  };
  names: Record<string, string>;
  note: string;
  onNote: (body: string) => void;
  onPatch: (patch: Partial<AgendaItem>) => void;
  /** Why the last Confirm decision didn't go ahead. */
  actionError: string | null;
  onConfirm: () => void;
  onDefer: () => void;
  onConsensus: () => void;
  onReceived: () => void;
  onSkip: () => void;
  onEdit: () => void;
  onTakeUp: () => void;
}) {
  const { item: it, onPatch } = props;
  const m = it.motion;
  const vote = m ? evaluateVote(m, props.voteCtx) : null;
  const [note, setNote] = useState(props.note);
  const live = props.live;
  const liveVoting = usesLiveVoting(it, props.general);
  const steps = itemSteps(it, {
    general: props.general,
    voteOpen: Boolean(live?.vote),
    voteClosed: Boolean(m?.voteId),
  });
  // What has to happen first; buttons stay off until it has.
  const openBlocked = !m
    ? null
    : !m.text.trim()
      ? "Write the motion first."
      : !m.mover || !m.sec
        ? "Record who moved and seconded the motion first."
        : !props.quorumMet
          ? "No quorum: no vote can open."
          : null;
  const confirmBlocked = !m
    ? null
    : !props.quorumMet
      ? "No quorum: no decisions can be made."
      : live?.vote
        ? "Close the vote first."
        : !m.mover || !m.sec
          ? "Record who moved and seconded the motion first."
          : liveVoting && !m.voteId
            ? "Open the vote and close it first."
            : !liveVoting && m.for + m.against + m.abstain === 0
              ? "Count the vote first."
              : null;
  const locked = it.done || !props.called;
  // While a live vote is open, or once one counted this motion, the counts aren't typed by hand.
  const countsLocked = locked || Boolean(live?.vote) || Boolean(m?.voteId);
  const setMotion = (patch: Partial<NonNullable<AgendaItem["motion"]>>) => onPatch({ motion: { ...m!, ...patch } });
  const lotLabel = (lot: string) => (!props.general && props.names[lot] ? `${lot} — ${props.names[lot]}` : lot);

  async function openAttachment(documentId: string | null, url?: string) {
    if (!documentId && url) return window.open(url, "_blank", "noopener,noreferrer");
    if (!documentId) return;
    // Opens in its own tab (not a download) so it can be screen-shared on a call.
    await openInNewTab(() => getDocumentDownloadUrl(props.corpId, documentId, { view: true }));
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
            {m && <span className="rtag">{props.general ? decisionTypeLabels[m.dt] : "Majority of council members present"}</span>}
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

      <StepList steps={steps} />

      {m && isElectChair(it) && (
        <label className="field">
          <span>Nominee for chair</span>
          <input
            value={it.nominee ?? ""}
            onChange={(e) => onPatch({ nominee: e.target.value, motion: { ...m, text: electChairMotion(e.target.value) } })}
            disabled={it.done}
            maxLength={200}
            placeholder="Who has been nominated"
            list="mm-chair-nominees"
            data-testid="mm-chair-nominee"
          />
          <datalist id="mm-chair-nominees">
            {props.present
              .map((l) => props.names[l])
              .filter(Boolean)
              .map((n) => (
                <option key={n} value={n} />
              ))}
          </datalist>
          <span className="field__hint">Once the motion carries, this person chairs the meeting and is named in the minutes.</span>
        </label>
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
          {live && props.called && !it.done && !isElectChair(it) && (
            <RunnerVotePanel
              vote={live.vote}
              otherOpenItem={live.otherOpenItem}
              closed={live.closed}
              present={props.present}
              names={props.names}
              ownLot={live.ownLot}
              busy={live.busy}
              error={live.error}
              now={live.now}
              openBlocked={openBlocked}
              onOpen={live.onOpen}
              onRecord={live.onRecord}
              onAllInFavour={live.onAllInFavour}
              onClose={live.onClose}
              onCancel={live.onCancel}
            />
          )}
          {(!liveVoting || it.done) && (
            <>
          <div className="mm-tally">
            {(["for", "against", "abstain"] as const).map((k) => {
              // Nobody votes twice: the three counts together can't exceed the voters present.
              const others = m.for + m.against + m.abstain - m[k];
              const max = Math.max(0, props.voters - others);
              return (
              <div className="mm-tally__box" key={k}>
                <span className="mm-tally__label">{k === "for" ? "In favour" : k === "against" ? "Opposed" : "Abstain"}</span>
                <div className="mm-tally__controls">
                  <button type="button" className="icon-button" aria-label={`One fewer ${k}`} onClick={() => setMotion({ [k]: Math.max(0, m[k] - 1) })} disabled={countsLocked}>
                    &minus;
                  </button>
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={m[k]}
                    max={max}
                    onChange={(e) => setMotion({ [k]: Math.min(max, Math.max(0, Math.floor(Number(e.target.value) || 0))) })}
                    disabled={countsLocked}
                    aria-label={k === "for" ? "Votes in favour" : k === "against" ? "Votes opposed" : "Abstentions"}
                    data-testid={`mm-votes-${k}`}
                  />
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`One more ${k}`}
                    onClick={() => setMotion({ [k]: Math.min(max, m[k] + 1) })}
                    disabled={countsLocked || m[k] >= max}
                  >
                    +
                  </button>
                </div>
              </div>
              );
            })}
          </div>
          {!it.done && (
            <p className="card__meta mm-tally__count" data-testid="mm-votes-counted">
              {m.for + m.against + m.abstain} of {props.voters} {props.voters === 1 ? "voter" : "voters"} counted
              {props.voters - (m.for + m.against + m.abstain) > 0
                ? ` · ${props.voters - (m.for + m.against + m.abstain)} not yet counted`
                : ""}
            </p>
          )}
          <p className="mm-threshold" data-state={it.done ? m.outcome?.toLowerCase() : vote && vote.total > 0 ? (vote.passing ? "passing" : "failing") : "pending"}>
            {it.done
              ? m.outcome
              : vote && vote.total > 0
                ? `${thresholdText(vote)}: ${vote.passing ? "passing" : "failing"}`
                : "No votes recorded yet"}
          </p>
            </>
          )}
          {!it.done && isTie(m) && (
            tieBreakAllowed(m, props.voteCtx) ? (
              <label className="field" data-testid="mm-tie-break">
                <span>Tied vote: president&rsquo;s deciding vote</span>
                <select
                  value={m.tieBreak ?? ""}
                  onChange={(e) => setMotion({ tieBreak: e.target.value === "for" || e.target.value === "against" ? e.target.value : null })}
                  disabled={locked}
                >
                  <option value="">None cast (the tie stands)</option>
                  <option value="for">In favour</option>
                  <option value="against">Against</option>
                </select>
                <span className="field__hint">
                  The president may break a tie with a second, deciding vote ({props.general ? "Standard Bylaws 27(5)" : "Standard Bylaws 18(2)"}), if your bylaws allow it.
                </span>
              </label>
            ) : (
              <p className="card__meta">Tied vote. With only 2 strata lots there is no deciding vote, so the tie stands.</p>
            )
          )}
        </div>
      )}

      {live && props.called && !it.done && takesConflicts(it.text) && (
        <ConflictsPanel
          conflicts={live.conflicts}
          present={live.allPresent}
          names={props.names}
          canEdit
          busy={live.busy}
          onDeclare={live.onDeclare}
          onWithdraw={live.onWithdraw}
        />
      )}
      {live && it.done && live.conflicts.length > 0 && (
        <ConflictsPanel conflicts={live.conflicts} present={[]} names={props.names} canEdit={false} busy onDeclare={() => {}} onWithdraw={() => {}} />
      )}

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
                {props.called &&
                  (props.presenting?.itemId === it.id && props.presenting.attId === a.id ? (
                    <button type="button" className="button button-primary button-small" onClick={() => props.onShow(null)} data-testid={`mm-stop-showing-${a.id}`}>
                      Stop sharing
                    </button>
                  ) : (
                    <button type="button" className="button button-secondary button-small" onClick={() => props.onShow(a.id)} data-testid={`mm-show-${a.id}`}>
                      Share on screen
                    </button>
                  ))}
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

      {!it.done && props.called && m && confirmBlocked && !props.actionError && (
        <p className="card__meta mm-actions__why" data-testid="mm-confirm-why">
          {confirmBlocked}
        </p>
      )}
      {!it.done && props.called && props.actionError && (
        <p className="mm-action-error" role="alert" data-testid="mm-action-error">
          {props.actionError}
        </p>
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
              <button
                type="button"
                className="button button-primary"
                onClick={props.onConfirm}
                disabled={Boolean(confirmBlocked)}
                title={confirmBlocked ?? undefined}
                data-testid="mm-confirm-decision"
              >
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

export function Assistant(props: {
  corpId: string;
  meetingId: string;
  item: AgendaItem | null;
  agenda: AgendaItem[];
  aiAvailable: boolean;
  isTrial: boolean;
  demoLeft: number | null;
  setDemoLeft: (n: number) => void;
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
    if (props.demoLeft === 0) return showDemoLimit("Meeting Mode questions");
    setText("");
    const history = log.filter((t) => !t.error).map(({ role, content }) => ({ role, content }));
    setLog((l) => [...l, { role: "user", content: q }]);
    setBusy(true);
    const result = await askMeetingAssistant(props.corpId, props.meetingId, props.item.id, props.agenda, history, q).catch(() => ({
      ok: false as const,
      error: "Stratasphere couldn't answer right now. Please try again.",
    }));
    setBusy(false);
    if (isDemoLimit(result)) {
      props.setDemoLeft(0);
      setLog((l) => l.slice(0, -1));
      setText(q);
      return showDemoLimit("Meeting Mode questions");
    }
    if (result.ok && props.demoLeft != null) props.setDemoLeft(Math.max(props.demoLeft - 1, 0));
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
              ? `Ask about this item, your bylaws, past decisions, or meeting procedure.${
                  props.demoLeft != null
                    ? ` The demo includes ${DEMO_LIMITS.meeting} questions in Meeting Mode. ${props.demoLeft} left.`
                    : props.isTrial
                      ? " Your free meeting includes ten questions."
                      : ""
                }`
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
      {props.demoLeft === 0 ? (
        <div className="demo-limit-inline" data-testid="mm-ai-demo-limit">
          <p>{DEMO_LIMIT_MESSAGE}</p>
          <a href={SIGNUP_URL} className="button button-primary button-small">
            Create your free account
          </a>
        </div>
      ) : (
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
      )}
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
