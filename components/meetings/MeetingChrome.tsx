"use client";

import { useEffect, useState } from "react";
import { MemberAvatar } from "@/components/MemberAvatar";
import { inMeeting, type PresenceEvent } from "@/lib/meetings/live";

/**
 * Pieces shared by Meeting Mode and the members' live page (0073, 0074):
 * who's signed in, who's in the meeting, the right-hand column, and the
 * confirmation boxes that guard against accidents.
 */

/**
 * Asks before the window or tab closes, or the page reloads, while someone is
 * in a meeting. Browsers show their own wording ("Leave site?"), and only once
 * the person has clicked or typed on the page. Moving around inside the app,
 * including Leave meeting and Exit, doesn't ask.
 */
export function useLeaveWarning(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Older browsers need returnValue set to show the prompt.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [active]);
}

/** The signed-in person, top right. */
export function MeetingUser({ name, avatarUrl }: { name: string; avatarUrl: string | null }) {
  return (
    <span className="mm-user" data-testid="meeting-user">
      <MemberAvatar name={name} url={avatarUrl} />
      <span className="mm-user__name">{name}</span>
    </span>
  );
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" });

/**
 * The right-hand column: who's in the meeting (where the Zoom video will
 * go), and below it the Stratasphere assistant, collapsed until opened.
 */
export function MeetingSide(props: {
  presence: PresenceEvent[];
  names: Record<string, string>;
  /** The assistant, rendered only while it's open. */
  assistant: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const here = inMeeting(props.presence);
  return (
    <aside className="mm-side" aria-label="In the meeting and Stratasphere">
      <div className="mm-side__here" data-testid="meeting-here">
        <h3 className="mm-subhead">In the meeting ({here.length})</h3>
        {here.length === 0 ? (
          <p className="card__meta">Nobody has joined yet. Members join from the Meetings tab.</p>
        ) : (
          <ul className="mm-here">
            {here.map((p) => (
              <li key={p.userId ?? p.lot ?? p.id}>
                <span>
                  {p.lot ? `${p.lot} · ${props.names[p.lot] || p.name}` : `${p.name} (no vote)`}
                  {p.event === "marked_joined" && <span className="card__meta"> (added by runner)</span>}
                </span>
                <span className="card__meta">since {clock(p.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="mm-side__assistant" data-open={open || undefined}>
        <button type="button" className="mm-side__toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open} data-testid="assistant-toggle">
          <span aria-hidden="true">{open ? "−" : "+"}</span> Stratasphere&trade;
        </button>
        {open && <div className="mm-side__panel">{props.assistant}</div>}
      </div>
    </aside>
  );
}

/** A confirmation that only goes ahead once `phrase` is typed. */
export function TypedConfirm(props: {
  title: string;
  body: React.ReactNode;
  phrase: string;
  confirmLabel: string;
  busy: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState("");
  const ok = typed.trim().toLowerCase() === props.phrase.toLowerCase();
  return (
    <div className="modal-backdrop" role="presentation" onClick={props.onCancel}>
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="typed-confirm-title" onClick={(e) => e.stopPropagation()} data-testid="typed-confirm">
        <h2 id="typed-confirm-title">{props.title}</h2>
        {props.body}
        <label className="field">
          <span>Type &ldquo;{props.phrase}&rdquo; to confirm</span>
          <input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus data-testid="typed-confirm-input" />
        </label>
        {props.error && <p className="form-alert" role="alert">{props.error}</p>}
        <div className="modal__actions">
          <button type="button" className="button button-secondary" onClick={props.onCancel}>
            Cancel
          </button>
          <button type="button" className="button button-primary" onClick={props.onConfirm} disabled={!ok || props.busy} data-testid="typed-confirm-ok">
            {props.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Declaring a conflict of interest (SPA s.32): its nature is required, since
 * it's what the member discloses and what the minutes record.
 */
export function ConflictDialog(props: {
  who: string;
  itemTitle: string;
  busy: boolean;
  error?: string | null;
  onDeclare: (note: string) => void;
  onCancel: () => void;
}) {
  const [note, setNote] = useState("");
  return (
    <div className="modal-backdrop" role="presentation" onClick={props.onCancel}>
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="conflict-title" onClick={(e) => e.stopPropagation()} data-testid="conflict-dialog">
        <h2 id="conflict-title">Declare a conflict of interest</h2>
        <p>
          {props.who} on &ldquo;{props.itemTitle}&rdquo;. They leave the meeting while it&rsquo;s discussed and voted on, and don&rsquo;t vote
          (Strata Property Act s.32).
        </p>
        <label className="field">
          <span>The nature of the conflict (goes in the minutes)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} autoFocus placeholder="e.g. A family member owns the contractor" data-testid="conflict-note" />
        </label>
        {props.error && <p className="form-alert" role="alert">{props.error}</p>}
        <div className="modal__actions">
          <button type="button" className="button button-secondary" onClick={props.onCancel}>
            Cancel
          </button>
          <button type="button" className="button button-primary" onClick={() => props.onDeclare(note)} disabled={note.trim().length < 3 || props.busy} data-testid="conflict-declare">
            Declare conflict
          </button>
        </div>
      </div>
    </div>
  );
}
