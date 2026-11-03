"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { groupByCategory, normalizeAgenda, resolutionTypeLabels, type AgendaItem } from "@/lib/meetings/agenda";
import { choiceLabels, conflictedLots, type Choice, type LiveState } from "@/lib/meetings/live";
import { castVote, declareConflict, getLiveState } from "@/app/strata/[corpId]/meetings/[meetingId]/live/actions";
import { getDocumentDownloadUrl } from "@/app/strata/[corpId]/documents/actions";
import { openInNewTab } from "@/lib/open-in-tab";
import { MemberVote } from "@/components/meetings/LiveVote";
import { Assistant } from "@/components/meetings/MeetingMode";

/**
 * A council member following a meeting live (0073). Read-only: the agenda
 * follows the person running it (a member can look back at an earlier
 * item), each item's background, financial implications, risks and
 * attachments, the motion, and while a vote is open, their own vote. The
 * result shows once the vote closes. Stratasphere is there, collapsed.
 */
export function LiveMeeting(props: {
  corpId: string;
  meetingId: string;
  title: string;
  planNumber: string;
  corpName: string;
  runnerName: string | null;
  names: Record<string, string>;
  initial: LiveState;
  isTrial: boolean;
  aiAvailable: boolean;
  demoLeft: number | null;
}) {
  const { corpId, meetingId } = props;
  const [state, setState] = useState<LiveState>(props.initial);
  const [viewing, setViewing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [demoLeft, setDemoLeft] = useState(props.demoLeft);
  const [declaring, setDeclaring] = useState(false);
  const [note, setNote] = useState("");

  const refresh = useCallback(async () => {
    const s = await getLiveState(meetingId).catch(() => null);
    if (s) setState(s);
  }, [meetingId]);
  const voteOpen = Boolean(state.openVote);
  useEffect(() => {
    const t = setInterval(() => void refresh(), voteOpen ? 2000 : 4000);
    return () => clearInterval(t);
  }, [refresh, voteOpen]);

  const agenda = useMemo(() => normalizeAgenda(state.agenda), [state.agenda]);
  const followingId = state.currentItemId;
  const shownId = viewing ?? followingId;
  const item = agenda.find((i) => i.id === shownId) ?? null;
  const who = (lot: string) => (props.names[lot] ? `${lot} · ${props.names[lot]}` : lot);

  if (state.status === "ADJOURNED") {
    return (
      <div className="live-ended card">
        <h2>The meeting has adjourned</h2>
        <p className="card__meta">The draft minutes go to council for review.</p>
        <Link href={`/strata/${corpId}/meetings/${meetingId}`} className="button button-primary">
          Back to the meeting
        </Link>
      </div>
    );
  }

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

  async function declare() {
    if (!item || !state.myLot) return;
    setBusy(true);
    const r = await declareConflict(meetingId, item.id, state.myLot, note).catch(() => ({ ok: false as const, error: "Couldn't record the conflict. Try again." }));
    setBusy(false);
    setDeclaring(false);
    setNote("");
    if (!r.ok) setError(r.error);
    await refresh();
  }

  async function openAttachment(documentId: string | null, url?: string) {
    if (!documentId && url) return window.open(url, "_blank", "noopener,noreferrer");
    if (!documentId) return;
    await openInNewTab(() => getDocumentDownloadUrl(corpId, documentId, { view: true }));
  }

  const conflicted = item ? conflictedLots(state.conflicts, item.id) : [];
  const iAmConflicted = Boolean(item && state.myLot && conflicted.includes(state.myLot));
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
            {props.runnerName ? ` · run by ${props.runnerName}` : ""}
          </span>
        </div>
        <span className="mm__spacer" />
        <button type="button" className="button button-secondary button-small" onClick={() => setAssistantOpen((o) => !o)} aria-expanded={assistantOpen}>
          {assistantOpen ? "Hide Stratasphere" : "Stratasphere"}
        </button>
        <Link href={`/strata/${corpId}/meetings/${meetingId}`} className="button button-secondary button-small">
          Leave
        </Link>
      </header>

      <div className="mm__body live__body" data-assistant={assistantOpen || undefined}>
        <nav className="mm__nav" aria-label="Agenda">
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
          {state.chair && <div className="mm-nav__chair card__meta">Chair: {state.chair}</div>}
        </nav>

        <main className="mm__main">
          {!state.calledToOrderAt && <p className="mm__alert">The meeting hasn&rsquo;t been called to order yet.</p>}
          {!item ? (
            <section className="mm-panel">
              <h2>Attendance</h2>
              <p className="card__meta">The meeting is starting. The agenda follows along once it&rsquo;s called to order.</p>
            </section>
          ) : (
            <ItemView
              item={item}
              names={props.names}
              conflicted={conflicted}
              voteOpen={state.openVote?.itemId === item.id}
              onOpenAttachment={openAttachment}
            />
          )}

          {item && m && (
            <section className="mm-panel live__vote">
              {openHere ? (
                canVote ? (
                  <>
                    <h3 className="mm-subhead">Your vote</h3>
                    <MemberVote vote={openHere} runnerName={props.runnerName} busy={busy} error={error} onCast={cast} />
                  </>
                ) : iAmConflicted ? (
                  <p className="live-info">You declared a conflict of interest on this item, so you don&rsquo;t vote on it.</p>
                ) : (
                  <p className="live-info">A vote is open. Council members present vote on their own screens.</p>
                )
              ) : lastClosed ? (
                <p className="live-info" data-testid="live-result">
                  <b>
                    {item.done && m.outcome ? (m.outcome === "CARRIED" ? "Carried" : "Defeated") : "Vote closed"}:
                  </b>{" "}
                  {lastClosed.for} {choiceLabels.for.toLowerCase()}, {lastClosed.against} {choiceLabels.against.toLowerCase()}, {lastClosed.abstain + lastClosed.missing} abstaining
                  {" "}({lastClosed.present} present).
                </p>
              ) : item.done && m.outcome ? (
                <p className="live-info">
                  <b>{m.outcome === "CARRIED" ? "Carried" : "Defeated"}</b>: {m.for} in favour, {m.against} opposed{m.abstain ? `, ${m.abstain} abstaining` : ""}.
                </p>
              ) : null}

              {state.myLot && state.calledToOrderAt && !item.done && !iAmConflicted && (
                declaring ? (
                  <div className="mm-conflicts__add">
                    <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="The nature of the conflict (for the minutes)" maxLength={500} aria-label="The nature of the conflict" />
                    <button type="button" className="button button-primary button-small" onClick={declare} disabled={busy} data-testid="live-declare-confirm">
                      Declare
                    </button>
                    <button type="button" className="link-button" onClick={() => setDeclaring(false)}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <p className="card__meta live__conflict">
                    <button type="button" className="link-button" onClick={() => setDeclaring(true)} data-testid="live-declare">
                      I have a conflict of interest on this item
                    </button>{" "}
                    · you won&rsquo;t vote on it, and it goes in the minutes (SPA s.32)
                  </p>
                )
              )}
            </section>
          )}
        </main>

        <aside className="mm__assistant live__assistant" aria-label="Stratasphere assistant" hidden={!assistantOpen}>
          {assistantOpen && (
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
          )}
        </aside>
      </div>
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
    </section>
  );
}
