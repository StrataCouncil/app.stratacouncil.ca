"use client";

import { tz } from "@/lib/time-zone";
import { useEffect, useState } from "react";
import { MemberAvatar } from "@/components/MemberAvatar";
import { inMeeting, type PresenceEvent, type Presenting } from "@/lib/meetings/live";
import { getDocumentDownloadUrl } from "@/app/strata/[corpId]/documents/actions";

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

const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-CA", { timeZone: tz("America/Vancouver", iso), hour: "numeric", minute: "2-digit" });

/**
 * The right-hand column: the meeting's video, who's in the meeting, and
 * below them the Stratasphere assistant, collapsed until opened.
 */
export function MeetingSide(props: {
  presence: PresenceEvent[];
  names: Record<string, string>;
  /** The assistant, rendered only while it's open. */
  assistant: React.ReactNode;
  /** The meeting's video (0080), above who's in the meeting. */
  video?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const here = inMeeting(props.presence);
  return (
    <aside className="mm-side" aria-label="In the meeting and Stratasphere">
      {props.video}
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

// Shown in the page (PDFs, pictures, text); anything else opens in its own tab.
const INLINE = /\.(pdf|png|jpe?g|gif|webp|txt)$/i;

/**
 * Share on screen (0076): the attachment the runner is sharing, over the
 * agenda on every screen. Members can hide it on their own screen; the
 * runner has one button, Stop sharing.
 */
export function SharedViewer(props: {
  corpId: string;
  presenting: Presenting;
  runner?: boolean;
  busy?: boolean;
  onStop?: () => void;
  /** Members only: hide it on this screen. The runner just stops sharing. */
  onHide?: () => void;
}) {
  const { presenting: p } = props;
  const [src, setSrc] = useState<string | null>(p.url);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setError(null);
    if (!p.documentId) {
      setSrc(p.url);
      return;
    }
    setSrc(null);
    getDocumentDownloadUrl(props.corpId, p.documentId, { view: true })
      .then((r) => {
        if (!live) return;
        if (r.ok) setSrc(r.url);
        else setError(r.error);
      })
      .catch(() => live && setError("Couldn't open it. Try again."));
    return () => {
      live = false;
    };
  }, [props.corpId, p.documentId, p.url, p.at]);

  let inline = false;
  try {
    inline = Boolean(src) && (p.documentId ? INLINE.test(new URL(src!).pathname) : true);
  } catch {}

  return (
    <div className="viewer-backdrop" role="presentation">
      <div className="viewer" role="dialog" aria-modal="true" aria-labelledby="viewer-title" data-testid="shared-viewer">
        <div className="viewer__head">
          <div>
            <span className="card__meta">{props.runner ? "You're sharing this on screen" : "Shared on screen"}</span>
            <h2 id="viewer-title">{p.title || "Attachment"}</h2>
          </div>
          <span className="viewer__actions">
            {src && (
              <a className="button button-secondary button-small" href={src} target="_blank" rel="noopener noreferrer">
                Open in a new tab
              </a>
            )}
            {props.runner && props.onStop && (
              <button type="button" className="button button-primary button-small" onClick={props.onStop} disabled={props.busy} data-testid="viewer-stop">
                Stop sharing
              </button>
            )}
            {!props.runner && (
              <button type="button" className="button button-secondary button-small" onClick={props.onHide} data-testid="viewer-hide">
                Hide
              </button>
            )}
          </span>
        </div>
        <div className="viewer__body">
          {error ? (
            <p className="form-error" role="alert">{error}</p>
          ) : !src ? (
            <p className="card__meta">Opening&hellip;</p>
          ) : inline ? (
            <iframe src={src} title={p.title || "Attachment"} className="viewer__frame" referrerPolicy="no-referrer" sandbox={p.documentId ? undefined : "allow-scripts allow-same-origin allow-popups"} />
          ) : (
            <p className="card__meta">This kind of file can&rsquo;t be shown here. Open it in a new tab.</p>
          )}
        </div>
      </div>
    </div>
  );
}
