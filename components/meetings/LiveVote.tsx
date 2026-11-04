"use client";

import { useState } from "react";
import { choiceLabels, votedLine, type Choice, type ClosedVote, type LiveBallot, type LiveConflict, type OpenVote } from "@/lib/meetings/live";

/**
 * Live voting (0073): the runner's vote panel and conflicts panel in
 * Meeting Mode, and the member's vote buttons on the live page.
 */

const CHOICES: Choice[] = ["for", "against", "abstain"];

function elapsed(fromIso: string, now: number) {
  const s = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The runner's view of a vote on the current item: open it, watch it, enter votes for others, close it. */
export function RunnerVotePanel(props: {
  /** The vote open on this item, if any. */
  vote: OpenVote | null;
  /** A vote open on another item: its number. Nothing can be opened until it closes. */
  otherOpenItem: number | null;
  /** This motion's closed live vote, once counted. */
  closed: ClosedVote | null;
  /** Council lots present for this item (conflicts already left out). */
  present: string[];
  names: Record<string, string>;
  /** The runner's own council lot, if they have one. */
  ownLot: string | null;
  busy: boolean;
  error: string | null;
  now: number;
  /** Why the vote can't open yet (no motion, mover or seconder; no quorum). */
  openBlocked: string | null;
  onOpen: () => void;
  onDefer: () => void;
  onRecord: (lot: string, choice: Choice) => void;
  /** For, for everyone who hasn't voted themselves. */
  onAllInFavour: () => void;
  onClose: () => void;
  onCancel: () => void;
}) {
  const { vote } = props;
  const who = (lot: string) => (props.names[lot] ? `${props.names[lot]}, ${lot}` : lot);

  if (props.closed) {
    const c = props.closed;
    return (
      <div className="mm-live" data-testid="mm-live-closed">
        <div className="mm-live__head">
          <span className="pill">Counted in the app</span>
          <span className="card__meta">
            {c.for} for, {c.against} against, {c.abstain} abstaining
            {c.missing ? `, ${c.missing} not voting (recorded as abstaining)` : ""} · {c.present} present
          </span>
        </div>
      </div>
    );
  }

  if (!vote) {
    return (
      <div className="mm-live" data-testid="mm-live-idle">
        <div className="mm-live__head">
          {props.otherOpenItem !== null ? (
            <span className="card__meta">A vote is open on item {props.otherOpenItem}. Close it before opening another.</span>
          ) : (
            <>
              <button type="button" className="button button-primary button-small" onClick={props.onOpen} disabled={props.busy || Boolean(props.openBlocked)} data-testid="mm-open-vote">
                Open vote
              </button>
              <button type="button" className="button button-secondary button-small" onClick={props.onDefer} disabled={props.busy} data-testid="mm-defer">
                Defer
              </button>
              <span className="card__meta" data-testid="mm-open-vote-hint">
                {props.openBlocked ?? "Council members vote on their own screens; you can enter a vote for anyone on the phone or in the room."}
              </span>
            </>
          )}
        </div>
        {props.error && <p className="mm-action-error" role="alert">{props.error}</p>}
      </div>
    );
  }

  const ballots = new Map((vote.ballots ?? []).map((b) => [b.lot, b] as [string, LiveBallot]));
  const tally = { for: 0, against: 0, abstain: 0 } as Record<Choice, number>;
  for (const b of ballots.values()) tally[b.choice] += 1;
  const need = Math.floor(vote.eligibleLots.length / 2) + 1;
  // Close vote waits for a vote from everyone present for the item (Abstain counts).
  const waitingOn = vote.eligibleLots.filter((l) => !ballots.has(l));
  // All in favour isn't offered once a member has voted Against themselves.
  const selfAgainst = [...ballots.values()].some((b) => b.choice === "against" && !b.forOther && b.lot !== props.ownLot);

  return (
    <div className="mm-live" data-testid="mm-live-open">
      <div className="mm-live__head">
        <span className="live-badge">Vote open {elapsed(vote.openedAt, props.now)}</span>
        <span className="card__meta">{votedLine({ votedCount: ballots.size, eligibleLots: vote.eligibleLots })} · members see the result when you close it</span>
      </div>
      {vote.eligibleLots.map((lot) => {
        const b = ballots.get(lot);
        const own = lot === props.ownLot;
        // A member's own vote is theirs alone; the runner enters (and can correct) the rest.
        const editable = !b || b.forOther || own;
        return (
          <div className="mm-live__row" key={lot} data-testid={`mm-ballot-${lot}`}>
            <span className="mm-live__who">
              {who(lot)}
              {own ? " (you)" : ""}
            </span>
            <span className="mm-live__how">{b ? (b.forOther ? "entered by you" : own ? "your vote" : "voted themselves") : "not voted yet"}</span>
            <span className="mm-live__pick">
              {editable
                ? CHOICES.map((c) => (
                    <button
                      type="button"
                      key={c}
                      className={`ch ch--${c}`}
                      data-selected={b?.choice === c || undefined}
                      onClick={() => props.onRecord(lot, c)}
                      disabled={props.busy}
                    >
                      {choiceLabels[c]}
                    </button>
                  ))
                : b && <span className={`ch ch--${b.choice}`} data-selected>{choiceLabels[b.choice]}</span>}
            </span>
          </div>
        );
      })}
      <div className="mm-live__foot">
        <span>
          <b>{tally.for}</b> For
        </span>
        <span>
          <b>{tally.against}</b> Against
        </span>
        <span>
          <b>{tally.abstain}</b> Abstain
        </span>
        <span className="card__meta">
          Needs {need} For: a majority of the {vote.eligibleLots.length} council {vote.eligibleLots.length === 1 ? "member" : "members"} present for this item
        </span>
      </div>
      {props.error && <p className="mm-action-error" role="alert">{props.error}</p>}
      {waitingOn.length > 0 && (
        <p className="card__meta mm-live__waiting" data-testid="mm-close-waiting">
          Close vote unlocks once everyone has voted: waiting on {waitingOn.map(who).join("; ")}. Enter Abstain for anyone who won&rsquo;t vote.
        </p>
      )}
        <div className="mm-live__actions mm-live__actions--below">
        <button type="button" className="button button-secondary button-small" onClick={props.onCancel} disabled={props.busy}>
          Cancel vote
        </button>
        <button
          type="button"
          className="button button-secondary button-small"
          onClick={props.onAllInFavour}
          disabled={props.busy || selfAgainst}
          title={selfAgainst ? "Someone voted Against on their own screen." : "For, for everyone who hasn't voted on their own screen."}
          data-testid="mm-all-in-favour"
        >
          All in favour
        </button>
        <button
          type="button"
          className="button button-primary button-small"
          onClick={props.onClose}
          disabled={props.busy || waitingOn.length > 0}
          title={waitingOn.length ? "Everyone present needs a vote first." : undefined}
          data-testid="mm-close-vote"
        >
          Close vote
        </button>
      </div>
    </div>
  );
}

/** Conflicts of interest declared on an item (SPA s.32). */
export function ConflictsPanel(props: {
  conflicts: LiveConflict[];
  /** Council lots present who could declare one. */
  present: string[];
  names: Record<string, string>;
  /** The runner can record a conflict for anyone and remove one recorded by mistake. */
  canEdit: boolean;
  busy: boolean;
  onDeclare: (lot: string, note: string) => void;
  onWithdraw: (lot: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [lot, setLot] = useState("");
  const [note, setNote] = useState("");
  // Withdrawing a declaration asks first: it takes it off the record, not the person out of the meeting.
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  const who = (l: string) => (props.names[l] ? `${props.names[l]}, ${l}` : l);
  const declared = new Set(props.conflicts.map((c) => c.lot));
  const candidates = props.present.filter((l) => !declared.has(l));

  if (!props.conflicts.length && !props.canEdit) return null;
  return (
    <div className="mm-conflicts" data-testid="mm-conflicts">
      {props.conflicts.map((c) => (
        <p key={c.lot} className="mm-conflicts__row">
          <strong>{who(c.lot)}</strong> declared a conflict of interest{c.note ? `: ${c.note}` : ""}. They take no part in this item and aren&rsquo;t counted for its votes.
          {props.canEdit &&
            (withdrawing === c.lot ? (
              <span className="mm-conflicts__confirm">
                Withdraw {who(c.lot)}&rsquo;s declaration? It comes off the record and they&rsquo;re counted for this item again.{" "}
                <button
                  type="button"
                  className="link-button"
                  onClick={() => {
                    props.onWithdraw(c.lot);
                    setWithdrawing(null);
                  }}
                  disabled={props.busy}
                  data-testid={`mm-withdraw-confirm-${c.lot}`}
                >
                  Withdraw it
                </button>{" "}
                <button type="button" className="link-button" onClick={() => setWithdrawing(null)}>
                  Keep it
                </button>
              </span>
            ) : (
              <button type="button" className="link-button" onClick={() => setWithdrawing(c.lot)} disabled={props.busy} data-testid={`mm-withdraw-${c.lot}`}>
                Withdraw declaration
              </button>
            ))}
        </p>
      ))}
      {props.canEdit &&
        (adding ? (
          <div className="mm-conflicts__add">
            <select value={lot} onChange={(e) => setLot(e.target.value)} aria-label="Who has the conflict">
              <option value="">Who?</option>
              {candidates.map((l) => (
                <option key={l} value={l}>
                  {who(l)}
                </option>
              ))}
            </select>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="The nature of the conflict (required; goes in the minutes)" maxLength={500} aria-label="The nature of the conflict" />
            <button
              type="button"
              className="button button-primary button-small"
              disabled={!lot || note.trim().length < 3 || props.busy}
              onClick={() => {
                props.onDeclare(lot, note.trim());
                setAdding(false);
                setLot("");
                setNote("");
              }}
            >
              Record
            </button>
            <button type="button" className="link-button" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        ) : (
          candidates.length > 0 && (
            <button type="button" className="link-button" onClick={() => setAdding(true)} data-testid="mm-add-conflict">
              Record a conflict of interest
            </button>
          )
        ))}
    </div>
  );
}

/** A council member's own vote on the live page. */
export function MemberVote(props: {
  vote: OpenVote;
  runnerName: string | null;
  busy: boolean;
  error: string | null;
  onCast: (choice: Choice) => void;
}) {
  const mine = props.vote.myBallot;
  return (
    <div className="live-vote" data-testid="live-vote">
      <div className="live-vote__buttons">
        {CHOICES.map((c) => (
          <button
            type="button"
            key={c}
            className="live-vote__button"
            data-choice={c}
            data-selected={mine === c || undefined}
            onClick={() => props.onCast(c)}
            disabled={props.busy}
            data-testid={`live-vote-${c}`}
          >
            {mine === c ? "✓ " : ""}
            {choiceLabels[c]}
          </button>
        ))}
      </div>
      <p className="live-vote__note" role="status">
        {mine
          ? `You voted ${choiceLabels[mine]}. You can change it until ${props.runnerName ?? "the person running the meeting"} closes the vote. The result shows here when it closes.`
          : "Choose For, Against or Abstain. You can change your vote until the vote closes."}
      </p>
      {props.error && <p className="mm-action-error" role="alert">{props.error}</p>}
    </div>
  );
}
