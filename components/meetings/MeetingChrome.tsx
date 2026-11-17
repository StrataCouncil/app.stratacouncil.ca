"use client";

import { tz } from "@/lib/time-zone";
import { useEffect, useRef, useState } from "react";
import { useVideoRoom, VideoRoomProvider, type RoomPerson } from "@/components/meetings/VideoRoom";
import { chatPieces, MAX_CHAT_LENGTH } from "@/lib/meetings/video-room";
import { videoIdentity } from "@/lib/zoom/video-identity";
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
 * The right-hand column: the meeting's video, then two tabs, one open at a
 * time (either can be closed, leaving the video):
 *
 *   People: for whoever runs it and their co-hosts, three sections, all
 *     collapsed to start and one open at a time: Raised hands (in order,
 *     with Ask to unmute and Lower), Meeting controls (mute everyone, chat
 *     on or off), and In the meeting (replacing "In attendance"), with a
 *     menu on each person (mute, ask to unmute, spotlight, co-host, remove
 *     from the video).
 *   Chat: to everyone, never privately. Nothing is saved: it lives in the
 *     browser while the video does, and goes when the meeting adjourns.
 *
 * Stratasphere isn't here any more: it floats (components/FloatingWindow.tsx).
 */
export function MeetingSide(props: {
  presence: PresenceEvent[];
  names: Record<string, string>;
  /** The meeting's video, above the tabs. */
  video?: React.ReactNode;
  /**
   * Who's in the meeting: for the person running it. Members' screens leave
   * it out unless they're a co-host.
   */
  showHere?: boolean;
  /** Roles under each name: "lot:SL005" or "user:<id>" to "President", "Manager". */
  roles?: Record<string, string>;
}) {
  return (
    <VideoRoomProvider>
      <SideTabs {...props} />
    </VideoRoomProvider>
  );
}

function SideTabs(props: { presence: PresenceEvent[]; names: Record<string, string>; video?: React.ReactNode; showHere?: boolean; roles?: Record<string, string> }) {
  const { state: room } = useVideoRoom();
  const chair = room.amHost || room.amManager;
  const showPeople = (props.showHere ?? true) || room.amManager;
  const [tab, setTab] = useState<"people" | "chat" | null>((props.showHere ?? true) ? "people" : null);
  // A co-host's People tab appears when they're made one; it goes if they stop being one.
  useEffect(() => {
    if (!showPeople && tab === "people") setTab(null);
  }, [showPeople, tab]);
  // Messages that arrived while Chat was closed.
  const [seen, setSeen] = useState(0);
  useEffect(() => {
    if (tab === "chat" || room.chat.length < seen) setSeen(room.chat.length);
  }, [tab, room.chat.length, seen]);
  const unread = tab === "chat" ? 0 : Math.max(0, room.chat.length - seen);
  const here = inMeeting(props.presence);
  const hands = room.queue.length;

  return (
    <aside className="mm-side" aria-label="People and chat">
      {props.video}
      <div className="mm-side__tabs" role="tablist" aria-label="People and chat">
        {showPeople && (
          <button
            type="button"
            role="tab"
            className="mm-side__tab"
            aria-selected={tab === "people"}
            onClick={() => setTab(tab === "people" ? null : "people")}
            data-testid="here-toggle"
          >
            People ({here.length})
            {chair && hands > 0 && (
              <span className="mm-side__badge" data-testid="hands-count">
                {hands} {hands === 1 ? "hand" : "hands"}
              </span>
            )}
          </button>
        )}
        <button type="button" role="tab" className="mm-side__tab" aria-selected={tab === "chat"} onClick={() => setTab(tab === "chat" ? null : "chat")} data-testid="chat-toggle">
          Chat
          {unread > 0 && (
            <span className="mm-side__badge" data-testid="chat-unread">
              {unread}
            </span>
          )}
        </button>
      </div>
      {tab === "people" && showPeople && <PeoplePanel presence={props.presence} names={props.names} roles={props.roles} />}
      {tab === "chat" && <ChatPanel />}
    </aside>
  );
}

/** Who's in the meeting, with the raised hands and the runner's controls. */
function PeoplePanel(props: { presence: PresenceEvent[]; names: Record<string, string>; roles?: Record<string, string> }) {
  const { state: room, actions } = useVideoRoom();
  const chair = room.amHost || room.amManager;
  const here = inMeeting(props.presence);
  const byIdentity = new Map(room.people.filter((p) => p.identity).map((p) => [p.identity, p]));
  const matched = new Set<number>();
  const rows = here.map((p) => {
    // By who they are; failing that, by the name the video shows ("Name, SL012", or the name alone).
    let v = p.userId ? byIdentity.get(videoIdentity(p.userId)) : undefined;
    if (!v) {
      const shown = p.lot ? `${props.names[p.lot] || p.name}, ${p.lot}` : p.name;
      v = room.people.find((x) => !matched.has(x.userId) && (x.name === shown || (p.lot ? x.name.endsWith(`, ${p.lot}`) : false)));
    }
    if (v) matched.add(v.userId);
    return { p, v };
  });
  // In the video but not signed in to the meeting page (rare): still listed, so the runner can see them.
  const videoOnly = room.people.filter((v) => !matched.has(v.userId));
  const nameOf = (userId: number) => {
    const v = room.people.find((x) => x.userId === userId);
    return v?.name ?? "Someone";
  };
  const [menu, setMenu] = useState<number | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);
  // One section open at a time (raised hands, meeting controls, who's here), all closed to start;
  // opening one closes the others. The counts in their headings show what's waiting.
  const [showing, setShowing] = useState<"hands" | "controls" | "list" | null>(null);
  const toggle = (s: "hands" | "controls" | "list") => setShowing((cur) => (cur === s ? null : s));

  const controls = (v: RoomPerson) =>
    chair && v.userId !== room.me && menu === v.userId ? (
      <div className="mm-here__menu" data-testid={`person-menu-${v.userId}`}>
        {v.muted ? (
          <button type="button" className="button button-secondary button-small" onClick={() => actions.askUnmute(v.userId)}>
            Ask to unmute
          </button>
        ) : (
          <button type="button" className="button button-secondary button-small" onClick={() => actions.mute(v.userId)}>
            Mute
          </button>
        )}
        <button type="button" className="button button-secondary button-small" onClick={() => actions.spotlight(v.spotlit ? null : v.userId)}>
          {v.spotlit ? "Remove spotlight" : "Spotlight for everyone"}
        </button>
        {room.amHost && v.canCoHost && (
          <button type="button" className="button button-secondary button-small" onClick={() => actions.setCoHost(v.userId, !v.isManager)} data-testid={`person-cohost-${v.userId}`}>
            {v.isManager ? "Remove co-host" : "Make co-host"}
          </button>
        )}
        {room.amHost &&
          (removing === v.userId ? (
            <span className="mm-here__confirm">
              Remove from the video? They can rejoin.{" "}
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  actions.remove(v.userId);
                  setRemoving(null);
                  setMenu(null);
                }}
              >
                Remove
              </button>{" "}
              <button type="button" className="link-button" onClick={() => setRemoving(null)}>
                Keep
              </button>
            </span>
          ) : (
            <button type="button" className="button button-secondary button-small" onClick={() => setRemoving(v.userId)}>
              Remove from video
            </button>
          ))}
      </div>
    ) : null;

  const videoState = (v: RoomPerson | undefined) =>
    !room.joined ? null : !v ? "Not in the video" : [v.isHost ? "Running the meeting" : v.isManager ? "Co-host" : "", !v.audio ? "Sound not on" : v.muted ? "Muted" : "Unmuted", v.spotlit ? "Spotlit" : ""].filter(Boolean).join(" · ");

  const menuButton = (v: RoomPerson | undefined) =>
    chair && v && v.userId !== room.me ? (
      <button
        type="button"
        className="mm-here__more"
        aria-expanded={menu === v.userId}
        aria-label={`Controls for ${v.name}`}
        onClick={() => {
          setMenu(menu === v.userId ? null : v.userId);
          setRemoving(null);
        }}
        data-testid={`person-more-${v.userId}`}
      >
        &hellip;
      </button>
    ) : null;

  return (
    <div className="mm-side__here" data-testid="meeting-here" data-open="true">
      {chair && room.joined && (
        <section className="mm-hands mm-fold" aria-label="Raised hands" data-testid="hands-queue" data-open={showing === "hands" || undefined}>
          <button type="button" className="mm-fold__head" aria-expanded={showing === "hands"} onClick={() => toggle("hands")} data-testid="fold-hands">
            <span aria-hidden="true">{showing === "hands" ? "−" : "+"}</span> Raised hands ({room.queue.length})
          </button>
          {showing !== "hands" ? null : room.queue.length === 0 ? (
            <p className="card__meta">No hands raised.</p>
          ) : (
            <ol>
              {room.queue.map((id) => {
                const v = room.people.find((x) => x.userId === id);
                return (
                  <li key={id} data-testid={`hand-${id}`}>
                    <span>{nameOf(id)}</span>
                    <span className="mm-hands__actions">
                      {v?.muted !== false && (
                        <button type="button" className="button button-primary button-small" onClick={() => actions.askUnmute(id)} data-testid={`hand-unmute-${id}`}>
                          Ask to unmute
                        </button>
                      )}
                      <button type="button" className="button button-secondary button-small" onClick={() => actions.lowerHand(id)} data-testid={`hand-lower-${id}`}>
                        Lower
                      </button>
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      )}
      {chair && room.joined && (
        <section className="mm-chair mm-fold" data-open={showing === "controls" || undefined}>
          <button type="button" className="mm-fold__head" aria-expanded={showing === "controls"} onClick={() => toggle("controls")} data-testid="fold-controls">
            <span aria-hidden="true">{showing === "controls" ? "−" : "+"}</span> Meeting controls
          </button>
          {showing === "controls" && (
          <div className="mm-chair__body">
            <button type="button" className="button button-secondary button-small" onClick={() => actions.muteAll()} data-testid="mute-all">
              Mute everyone
            </button>
            {room.amHost && (
              <label className="mm-chair__toggle">
                <input type="checkbox" checked={room.chatOpen} onChange={(e) => actions.setChatOpen(e.target.checked)} data-testid="chat-open" /> Chat on
              </label>
            )}
            <p className="card__meta">Zoom doesn&rsquo;t let anyone unmute someone else: Ask to unmute sends them a prompt.</p>
          </div>
          )}
        </section>
      )}
      <section className="mm-fold" data-open={showing === "list" || undefined}>
      <button type="button" className="mm-fold__head" aria-expanded={showing === "list"} onClick={() => toggle("list")} data-testid="fold-list">
        <span aria-hidden="true">{showing === "list" ? "−" : "+"}</span> In the meeting ({here.length + videoOnly.length})
      </button>
      {showing !== "list" ? null : here.length === 0 && videoOnly.length === 0 ? (
        <p className="card__meta mm-here__empty">Nobody has joined yet. Members join from the Meetings tab.</p>
      ) : (
        <>
          <ul className="mm-here">
            {rows.map(({ p, v }) => {
              const role = (p.lot ? props.roles?.[`lot:${p.lot}`] : undefined) ?? (p.userId ? props.roles?.[`user:${p.userId}`] : undefined);
              const state = videoState(v);
              return (
                <li key={p.userId ?? p.lot ?? p.id} data-speaking={v?.speaking || undefined}>
                  <div className="mm-here__row">
                    <span className="mm-here__who">
                      <span>
                        {p.lot ? `${p.lot} · ${props.names[p.lot] || p.name}` : p.name}
                        {p.event === "marked_joined" && <span title="Marked present by the person running the meeting">*</span>}
                      </span>
                      <span className="card__meta">{role ?? (p.lot ? "Council member" : "No vote")}</span>
                      {state && <span className="card__meta mm-here__video">{state}</span>}
                    </span>
                    <span className="mm-here__side">
                      <span className="card__meta">{clock(p.at)}</span>
                      {menuButton(v)}
                    </span>
                  </div>
                  {v && controls(v)}
                </li>
              );
            })}
            {videoOnly.map((v) => (
              <li key={`v${v.userId}`} data-speaking={v.speaking || undefined}>
                <div className="mm-here__row">
                  <span className="mm-here__who">
                    <span>{v.name}</span>
                    <span className="card__meta mm-here__video">{videoState(v)}</span>
                  </span>
                  <span className="mm-here__side">{menuButton(v)}</span>
                </div>
                {controls(v)}
              </li>
            ))}
          </ul>
          {here.some((p) => p.event === "marked_joined") && <p className="card__meta mm-here__note">* Marked present by the person running the meeting</p>}
        </>
      )}
      </section>
    </div>
  );
}

const chatTime = (ms: number) => new Date(ms).toLocaleTimeString("en-CA", { timeZone: tz("America/Vancouver", ms), hour: "numeric", minute: "2-digit" });

/** Chat to everyone: never saved, gone when the meeting adjourns. */
function ChatPanel() {
  const { state: room, actions } = useVideoRoom();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const log = useRef<HTMLOListElement>(null);
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [room.chat.length]);
  const canSend = room.joined && (room.chatOpen || room.amHost);

  async function send() {
    if (!draft.trim() || sending) return;
    setSending(true);
    setError(null);
    const err = await actions.sendChat(draft);
    setSending(false);
    if (err) setError(err);
    else setDraft("");
  }

  return (
    <div className="mm-chat" data-testid="chat-panel">
      {!room.joined ? (
        <p className="card__meta mm-chat__empty">Join the video to chat. Messages go to everyone in the meeting.</p>
      ) : (
        <>
          <ol className="mm-chat__log" ref={log} aria-live="polite">
            {room.chat.length === 0 && <li className="card__meta mm-chat__empty">No messages yet.</li>}
            {room.chat.map((m) => (
              <li key={m.id} data-mine={m.fromId === room.me || undefined}>
                <span className="mm-chat__who">
                  {m.fromId === room.me ? "You" : m.fromName} <span className="card__meta">{chatTime(m.at)}</span>
                </span>
                <span className="mm-chat__text">
                  {chatPieces(m.text).map((piece, i) =>
                    piece.href ? (
                      <a key={i} href={piece.href} target="_blank" rel="noopener noreferrer nofollow">
                        {piece.text}
                      </a>
                    ) : (
                      piece.text
                    )
                  )}
                </span>
              </li>
            ))}
          </ol>
          {!room.chatOpen && <p className="card__meta mm-chat__off">{room.amHost ? "Chat is off for everyone but you." : "The person running the meeting has turned chat off."}</p>}
          <form
            className="mm-chat__form"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <textarea
              rows={2}
              value={draft}
              maxLength={MAX_CHAT_LENGTH}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder={canSend ? "Message everyone" : "Chat is off"}
              disabled={!canSend}
              aria-label="Message everyone"
              data-testid="chat-input"
            />
            <button type="submit" className="button button-primary button-small" disabled={!canSend || sending || !draft.trim()} data-testid="chat-send">
              Send
            </button>
          </form>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </>
      )}
      <p className="card__meta mm-chat__note">Chat goes to everyone. It isn&rsquo;t saved, it&rsquo;s gone when the meeting adjourns, and it isn&rsquo;t part of the minutes.</p>
    </div>
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
