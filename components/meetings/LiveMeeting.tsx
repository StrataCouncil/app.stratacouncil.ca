"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { groupByCategory, normalizeAgenda, resolutionTypeLabels, type AgendaItem } from "@/lib/meetings/agenda";
import { choiceLabels, conflictedLots, inMeeting, runnerAway, takesConflicts, type Choice, type LiveState } from "@/lib/meetings/live";
import { councilQuorum } from "@/lib/meetings/rules";
import { castVote, declareConflict, getLiveState, joinMeeting, leaveMeeting, takeOverMeeting } from "@/app/strata/[corpId]/meetings/[meetingId]/live/actions";
import { getDocumentDownloadUrl } from "@/app/strata/[corpId]/documents/actions";
import { openInNewTab } from "@/lib/open-in-tab";
import { MemberVote } from "@/components/meetings/LiveVote";
import { Assistant } from "@/components/meetings/MeetingMode";
import { ConflictDialog, MeetingSide, MeetingUser, SharedViewer, TypedConfirm, useLeaveWarning } from "@/components/meetings/MeetingChrome";

/**
 * A council member (or the manager) in a meeting (0073, 0074). Opening this
 * page joins the meeting, which records their attendance; Leave records
 * that they left, and they can come back any time. Read-only: the agenda
 * follows the person running it (they can look back at an earlier item),
 * with each item's background, financial implications, risks, attachments
 * and motion, and while a vote is open, their own vote; the result shows
 * once it closes. Declaring a conflict takes them out of that item until
 * it's done. On the right: who's in the meeting (where the Zoom video will
 * go) and Stratasphere, collapsed.
 */
export function LiveMeeting(props: {
  corpId: string;
  meetingId: string;
  title: string;
  planNumber: string;
  corpName: string;
  runnerName: string | null;
  names: Record<string, string>;
  /** Council seats with a lot, for quorum. */
  councilCount: number;
  me: { name: string; avatarUrl: string | null };
  initial: LiveState;
  isTrial: boolean;
  aiAvailable: boolean;
  demoLeft: number | null;
  /** Can run this strata's meetings: offered Take over if the Runner loses connection (0079). */
  canRunMeetings: boolean;
}) {
  const { corpId, meetingId } = props;
  const router = useRouter();
  const [state, setState] = useState<LiveState>(props.initial);
  const [viewing, setViewing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [demoLeft, setDemoLeft] = useState(props.demoLeft);
  const [declaring, setDeclaring] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  // The shared attachment, hidden on this screen (by when it was shown).
  const [hiddenShow, setHiddenShow] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  const [now, setNow] = useState(() => Date.now());
  const refresh = useCallback(async () => {
    const s = await getLiveState(meetingId).catch(() => null);
    if (s) setState(s);
    setNow(Date.now());
  }, [meetingId]);

  // Opening the page joins the meeting (once per visit).
  const joined = useRef(false);
  useEffect(() => {
    if (joined.current) return;
    joined.current = true;
    void joinMeeting(meetingId).then((r) => {
      if (!r.ok) setJoinError(r.error);
      void refresh();
    });
  }, [meetingId, refresh]);

  // Closing the window by accident would drop them out of the vote.
  useLeaveWarning(state.status !== "ADJOURNED");

  const voteOpen = Boolean(state.openVote);
  useEffect(() => {
    const t = setInterval(() => void refresh(), voteOpen ? 2000 : 4000);
    return () => clearInterval(t);
  }, [refresh, voteOpen]);

  const agenda = useMemo(() => normalizeAgenda(state.agenda), [state.agenda]);
  const followingId = state.currentItemId;
  const shownId = viewing ?? followingId;
  const item = agenda.find((i) => i.id === shownId) ?? null;

  async function leave() {
    setBusy(true);
    await leaveMeeting(meetingId).catch(() => undefined);
    router.push(`/strata/${corpId}/meetings/${meetingId}`);
  }

  const adjourned = state.status === "ADJOURNED";
  // Who runs it now (0079): handed over or taken over since the page loaded.
  const runnerName = state.lastHandover?.toName ?? props.runnerName;
  const handedToMe = state.isRunner && !adjourned;
  const paused = !state.isRunner && runnerAway(state, now);
  async function takeOver() {
    setBusy(true);
    setError(null);
    const r = await takeOverMeeting(meetingId).catch(() => ({ ok: false as const, error: "Couldn't reach the server. Try again." }));
    if (!r.ok) {
      setBusy(false);
      setError(r.error);
      return refresh();
    }
    router.push(`/strata/${corpId}/meetings/${meetingId}/run`);
  }
  // Quorum from who's in the meeting now (council lots), once it's called to order.
  const hereLots = new Set(inMeeting(state.presence).map((p) => p.lot).filter(Boolean)).size;
  const quorumNeeded = councilQuorum(props.councilCount);
  const quorumLost = Boolean(state.calledToOrderAt) && props.councilCount > 0 && hereLots < quorumNeeded;

  async function cast(choice: Choice) {
    if (!state.openVote) return;
    setBusy(true);
    setError(null);
    // Shown at once; the next refresh confirms it.
    setState((s) => (s.openVote ? { ...s, openVote: { ...s.openVote, myBallot: choice } } : s));
    const r = await castVote(state.openVote.id, choice).catch(() => ({ ok: false as const, error: "Your vote didn't go through. Try again." }));
    setBusy(false);
    if (!r.ok) setError(r.error);
    await refresh();
  }

  async function declare(note: string) {
    if (!item || !state.myLot) return;
    setBusy(true);
    const r = await declareConflict(meetingId, item.id, state.myLot, note).catch(() => ({ ok: false as const, error: "Couldn't record the conflict. Try again." }));
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setDeclaring(false);
    setError(null);
    await refresh();
  }

  async function openAttachment(documentId: string | null, url?: string) {
    if (!documentId && url) return window.open(url, "_blank", "noopener,noreferrer");
    if (!documentId) return;
    await openInNewTab(() => getDocumentDownloadUrl(corpId, documentId, { view: true }));
  }

  const conflicted = item ? conflictedLots(state.conflicts, item.id) : [];
  const iAmConflicted = Boolean(item && state.myLot && conflicted.includes(state.myLot));
  // Stepped out for the item the meeting is on: nothing shared reaches them meanwhile.
  const steppedOut = Boolean(followingId && state.myLot && conflictedLots(state.conflicts, followingId).includes(state.myLot));
  const openHere = item && state.openVote?.itemId === item.id ? state.openVote : null;
  const canVote = Boolean(openHere && state.myLot && openHere.eligibleLots.includes(state.myLot));
  const closedHere = item ? state.closedVotes.filter((v) => v.itemId === item.id) : [];
  const lastClosed = closedHere[closedHere.length - 1] ?? null;
  const m = item?.motion ?? null;

  return (
    <div className="mm live" data-testid="live-meeting">
      <header className="mm__top">
        <div className="mm__title">
          <strong>{props.title}</strong>
          <span>
            {props.planNumber} &middot; {props.corpName}
            {runnerName ? ` · run by ${runnerName}` : ""}
          </span>
        </div>
        <span className="mm__spacer" />
        <MeetingUser name={props.me.name} avatarUrl={props.me.avatarUrl} />
        <button type="button" className="button button-secondary button-small" onClick={() => setLeaving(true)} disabled={busy} data-testid="leave-meeting">
          Leave meeting
        </button>
      </header>
      {joinError && <div className="mm__alert" role="alert">{joinError}</div>}
      {handedToMe && (
        <div className="modal-backdrop" role="presentation">
          <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="live-handed-title" data-testid="live-handed-to-me">
            <h2 id="live-handed-title">You&rsquo;re running the meeting</h2>
            <p>
              {state.lastHandover?.kind === "handed_over" ? `${state.lastHandover.fromName} handed you the meeting.` : "You are now running this meeting."} Votes,
              attendance and the agenda are as they left them.
            </p>
            <div className="modal__actions">
              <Link href={`/strata/${corpId}/meetings/${meetingId}/run`} className="button button-primary" data-testid="live-open-meeting-mode">
                Open Meeting Mode
              </Link>
            </div>
          </div>
        </div>
      )}
      {paused && !adjourned && (
        <div className="mm__alert mm__alert--quorum" role="alert" data-testid="live-runner-away">
          <strong>Meeting paused:</strong> The person running the meeting has lost connection. The meeting is paused.
          {props.canRunMeetings && (
            <>
              {" "}
              <button type="button" className="button button-primary button-small" onClick={() => void takeOver()} disabled={busy} data-testid="live-take-over">
                Take over the meeting
              </button>
            </>
          )}
          {error && props.canRunMeetings && <span className="form-error"> {error}</span>}
        </div>
      )}
      {quorumLost && !adjourned && (
        <div className="mm__alert mm__alert--quorum" role="alert" data-testid="live-quorum-lost">
          <strong>Quorum lost:</strong> {hereLots} of {props.councilCount} council members are in the meeting, {quorumNeeded} needed. No decisions can be
          made until enough members are back.
        </div>
      )}
      {state.presenting && hiddenShow === state.presenting.at && !adjourned && !steppedOut && (
        <div className="mm__alert mm__alert--showing" role="status">
          Shared on screen: <strong>{state.presenting.title || "an attachment"}</strong>{" "}
          <button type="button" className="link-button" onClick={() => setHiddenShow(null)} data-testid="live-show-again">
            View
          </button>
        </div>
      )}

      <div className="mm__body live__body">
        <nav className="mm__nav" aria-label="Agenda">
          {state.chair && <div className="mm-nav__chair mm-nav__chair--top card__meta">Chair: {state.chair}</div>}
          <p className="live__follow card__meta">
            {viewing && viewing !== followingId ? (
              <button type="button" className="link-button" onClick={() => setViewing(null)} data-testid="live-back-to-current">
                Back to the current item
              </button>
            ) : (
              "Following the meeting. Click an item to look back."
            )}
          </p>
          {groupByCategory(agenda).map((cat) => (
            <div key={cat.id}>
              <div className="mm-nav__cat">{cat.name}</div>
              {cat.items.map((it) => (
                <button
                  type="button"
                  key={it.id}
                  className="mm-nav__item"
                  data-active={it.id === shownId}
                  data-done={it.done}
                  onClick={() => setViewing(it.id === followingId ? null : it.id)}
                >
                  <span className="mm-nav__check" aria-hidden="true">{it.done ? "✓" : null}</span>
                  <span>
                    {it.num}. {it.text}
                    {it.id === followingId && <span className="card__meta"> · now</span>}
                    {it.done && it.motion?.outcome && <span className="card__meta"> · {it.motion.outcome === "CARRIED" ? "Carried" : "Defeated"}</span>}
                    {it.deferred && !it.done && <span className="card__meta"> · deferred</span>}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </nav>

        <main className="mm__main">
          {!state.calledToOrderAt && <p className="mm__alert">The meeting hasn&rsquo;t been called to order yet. You&rsquo;re in, and counted present.</p>}
          {!item ? (
            <section className="mm-panel">
              <h2>Waiting to start</h2>
              <p className="card__meta">The agenda follows along once the person running the meeting opens the first item. Click any item on the left to read it now.</p>
            </section>
          ) : iAmConflicted ? (
            <section className="mm-panel live-out" data-testid="live-stepped-out">
              <h2>You&rsquo;ve stepped out for item {item.num}</h2>
              <p>
                You declared a conflict of interest on &ldquo;{item.text}&rdquo;, so you take no part while it&rsquo;s discussed and voted on (Strata
                Property Act s.32). You&rsquo;re back in when the meeting moves on.
              </p>
            </section>
          ) : (
            <ItemView
              item={item}
              names={props.names}
              conflicted={conflicted}
              voteOpen={state.openVote?.itemId === item.id}
              onOpenAttachment={openAttachment}
              afterMotion={
                <>
          {item && m && !iAmConflicted && (
            <section className="mm-panel live__vote">
              {openHere ? (
                canVote ? (
                  <>
                    <h3 className="mm-subhead">Your vote</h3>
                    <MemberVote vote={openHere} runnerName={props.runnerName} busy={busy} error={error} onCast={cast} />
                  </>
                ) : (
                  <p className="live-info">A vote is open. Council members present vote on their own screens.</p>
                )
              ) : lastClosed ? (
                <p className="live-info" data-testid="live-result">
                  <b>{item.done && m.outcome ? (m.outcome === "CARRIED" ? "Carried" : "Defeated") : "Vote closed"}:</b>{" "}
                  {lastClosed.against === 0 && lastClosed.abstain + lastClosed.missing === 0 && lastClosed.for > 0
                    ? `unanimous, ${lastClosed.for} in favour`
                    : `${lastClosed.for} ${choiceLabels.for.toLowerCase()}, ${lastClosed.against} ${choiceLabels.against.toLowerCase()}, ${lastClosed.abstain + lastClosed.missing} abstaining`}{" "}
                  ({lastClosed.present} present).
                </p>
              ) : item.done && m.outcome ? (
                <p className="live-info">
                  <b>{m.outcome === "CARRIED" ? "Carried" : "Defeated"}</b>: {m.for} in favour, {m.against} opposed{m.abstain ? `, ${m.abstain} abstaining` : ""}.
                </p>
              ) : null}
            </section>
          )}

          {item && state.myLot && !item.done && !iAmConflicted && takesConflicts(item.text) && (
            <p className="card__meta live__conflict">
              <button type="button" className="link-button" onClick={() => setDeclaring(true)} data-testid="live-declare">
                I have a conflict of interest on this item
              </button>{" "}
              · you&rsquo;ll step out of the meeting for this item and won&rsquo;t vote on it (SPA s.32)
            </p>
          )}
                </>
              }
            />
          )}

        </main>

        <MeetingSide
          presence={state.presence}
          names={props.names}
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

      {leaving && (
        <TypedConfirm
          title="Leave the meeting?"
          body={<p>You&rsquo;re recorded as having left at this time and no longer count for quorum or votes. You can rejoin any time from the Meetings tab.</p>}
          phrase="Leave meeting"
          confirmLabel="Leave meeting"
          busy={busy}
          onCancel={() => setLeaving(false)}
          onConfirm={() => void leave()}
        />
      )}
      {state.presenting && hiddenShow !== state.presenting.at && !adjourned && !steppedOut && (
        <SharedViewer corpId={corpId} presenting={state.presenting} onHide={() => setHiddenShow(state.presenting!.at)} />
      )}
      {adjourned && (
        <div className="modal-backdrop" role="presentation">
          <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="adjourned-title" data-testid="live-adjourned">
            <h2 id="adjourned-title">Meeting adjourned</h2>
            <p>The draft minutes go to council for review. You&rsquo;ll find them in the Meetings tab.</p>
            <div className="modal__actions">
              <Link href={`/strata/${corpId}/meetings`} className="button button-primary" data-testid="live-exit">
                Exit meeting
              </Link>
            </div>
          </div>
        </div>
      )}
      {declaring && item && (
        <ConflictDialog
          who={`You (${state.myLot})`}
          itemTitle={item.text}
          busy={busy}
          error={error}
          onDeclare={declare}
          onCancel={() => {
            setDeclaring(false);
            setError(null);
          }}
        />
      )}
    </div>
  );
}

/** An agenda item, read-only. Outside LiveMeeting so its open sections survive each refresh. */
function ItemView(p: {
  item: AgendaItem;
  names: Record<string, string>;
  conflicted: string[];
  voteOpen: boolean;
  onOpenAttachment: (id: string | null, url?: string) => void;
  /** The vote and the conflict link, right under the motion. */
  afterMotion?: React.ReactNode;
}) {
  const who = (lot: string) => (p.names[lot] ? `${lot} · ${p.names[lot]}` : lot);
  const it = p.item;
  return (
    <section className="mm-panel" data-testid="live-item">
      <div className="mm-item__head">
        <div>
          <div className="card__meta">{it.cat}</div>
          <h2>
            {it.num}. {it.text}
          </h2>
          <div className="mm-item__tags">
            <span className={`rtag rtag--${it.type.toLowerCase()}`}>{resolutionTypeLabels[it.type]}</span>
            {it.motion && <span className="rtag">Majority of council members present</span>}
            {p.voteOpen && <span className="live-badge">Vote open</span>}
          </div>
        </div>
      </div>
      {it.motion && (
        <>
          <h3 className="mm-subhead">Motion</h3>
          <div className="live__motion">{it.motion.text || <span className="card__meta">The motion will appear here.</span>}</div>
          {(it.motion.mover || it.motion.sec) && (
            <p className="card__meta">
              {it.motion.mover && <>Moved by {who(it.motion.mover)}</>}
              {it.motion.mover && it.motion.sec && " · "}
              {it.motion.sec && <>Seconded by {who(it.motion.sec)}</>}
            </p>
          )}
        </>
      )}
      {p.afterMotion}
      {(it.background || it.financial || it.risks) && (
        <div className="mm-details">
          {it.background && (
            <details className="mm-detail" open>
              <summary>Background / rationale</summary>
              <p>{it.background}</p>
            </details>
          )}
          {it.financial && (
            <details className="mm-detail">
              <summary>Financial implications</summary>
              <p>{it.financial}</p>
            </details>
          )}
          {it.risks && (
            <details className="mm-detail">
              <summary>Risks / compliance</summary>
              <p>{it.risks}</p>
            </details>
          )}
        </div>
      )}
      {it.atts.length > 0 && (
        <div className="mm-details">
          <h3 className="mm-subhead">Attachments</h3>
          <ul className="attachment-list">
            {it.atts.map((a) => (
              <li key={a.id}>
                <span className="pill">{a.kind === "link" ? "Link" : "File"}</span>
                <button type="button" className="link-button" onClick={() => p.onOpenAttachment(a.documentId, a.kind === "link" ? a.url : undefined)}>
                  {a.title}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {p.conflicted.length > 0 && (
        <div className="mm-conflicts">
          {p.conflicted.map((l) => (
            <p key={l} className="mm-conflicts__row">
              <strong>{who(l)}</strong> declared a conflict of interest and takes no part in this item.
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
