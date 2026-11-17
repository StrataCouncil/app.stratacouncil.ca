"use client";

import { useEffect, useRef, useState } from "react";
import type { AgendaItem } from "@/lib/meetings/agenda";
import type { StratasphereSource } from "@/lib/ai/stratasphere";
import { suggestionsFor } from "@/lib/stratasphere-focus";
import { askStream } from "@/lib/stratasphere-stream";
import { DEMO_LIMITS, DEMO_LIMIT_MESSAGE, SIGNUP_URL } from "@/lib/demo";
import { showDemoLimit } from "@/lib/demo-client";
import { Sources } from "@/components/StratasphereChat";
import { meetingConversation } from "@/app/strata/[corpId]/meetings/[meetingId]/run/actions";
import { FloatingWindow } from "@/components/FloatingWindow";

/**
 * Stratasphere in Meeting Mode and on the members' live page (PR 4b,
 * docs/learn-decide-remember.md §5): the same assistant as the floating
 * window elsewhere, looking at the open agenda item. It floats the same way
 * (MeetingAssistant below): a button, bottom right, opening a window that
 * moves and resizes; closing it keeps the conversation going.
 *
 * - The meeting is one saved conversation per person ("Strata Council
 *   Meeting, Nov 12, 2026"), on the full Ask page afterwards. Each question
 *   is saved with its agenda item, and each item shows its own questions.
 * - The server reads the saved agenda (the runner saves first), keeps the
 *   fast meeting setting, and answers only build on the same item's
 *   questions (app/api/stratasphere/chat/route.ts).
 * - Sources open in a new tab, so the meeting and its video stay open.
 *
 * Nothing else in Meeting Mode changes.
 */

type Msg = { id: string; role: "user" | "assistant"; content: string; sources: StratasphereSource[]; pending?: boolean };

export function MeetingStratasphere(props: {
  corpId: string;
  meetingId: string;
  item: AgendaItem | null;
  aiAvailable: boolean;
  demoLeft: number | null;
  setDemoLeft: (n: number) => void;
  /** The runner saves the meeting first, so the server reads what's on screen. */
  beforeAsk?: () => Promise<boolean>;
}) {
  const { corpId, meetingId, item, aiAvailable } = props;
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [byItem, setByItem] = useState<Record<string, Msg[]>>({});
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const log = useRef<HTMLDivElement>(null);

  // Earlier questions from this meeting (after a reload, or coming back).
  useEffect(() => {
    if (!aiAvailable) return;
    let gone = false;
    meetingConversation(corpId, meetingId)
      .then((c) => {
        if (gone || !c.id) return;
        setConversationId((id) => id ?? c.id);
        setByItem((now) => {
          const loaded: Record<string, Msg[]> = {};
          for (const t of c.turns) (loaded[t.itemId] ??= []).push({ id: t.id, role: t.role, content: t.content, sources: t.sources });
          return { ...loaded, ...now };
        });
      })
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, [corpId, meetingId, aiAvailable]);

  const messages = item ? (byItem[item.id] ?? []) : [];

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [messages, busy]);

  useEffect(() => setError(""), [item?.id]);

  async function ask(text?: string) {
    const question = (text ?? draft).trim();
    if (!question || !item || busy || !aiAvailable) return;
    if (props.demoLeft === 0) return showDemoLimit("Meeting Mode questions");
    const itemId = item.id;
    const update = (fn: (list: Msg[]) => Msg[]) => setByItem((all) => ({ ...all, [itemId]: fn(all[itemId] ?? []) }));
    setError("");
    setDraft("");
    setBusy(true);
    update((l) => [
      ...l,
      { id: `q-${Date.now()}`, role: "user", content: question, sources: [] },
      { id: "pending", role: "assistant", content: "", sources: [], pending: true },
    ]);
    const drop = () => update((l) => l.filter((m) => m.id !== "pending").slice(0, -1));

    if (props.beforeAsk && !(await props.beforeAsk())) {
      drop();
      setBusy(false);
      setDraft(question);
      setError("Couldn't save the meeting first. Check your connection, then ask again.");
      return;
    }

    const result = await askStream(
      { corpId, conversationId, question, focus: { kind: "agenda_item", meetingId, itemId }, live: true },
      {
        start: (id) => setConversationId(id),
        text: (soFar) => update((l) => l.map((m) => (m.id === "pending" ? { ...m, content: soFar } : m))),
      }
    );
    setBusy(false);
    if (result.ok) {
      update((l) =>
        l.map((m) => (m.id === "pending" ? { id: result.messageId ?? `a-${Date.now()}`, role: "assistant", content: result.text, sources: result.sources } : m))
      );
      if (props.demoLeft != null) props.setDemoLeft(Math.max(props.demoLeft - 1, 0));
      return;
    }
    drop();
    setDraft(question);
    if (result.demoLimit) {
      props.setDemoLeft(0);
      return showDemoLimit("Meeting Mode questions");
    }
    setError(result.error);
  }

  const suggestions = item
    ? suggestionsFor({ kind: "agenda_item", title: item.text }).filter((q) => item.atts.length > 0 || !/attachments/i.test(q))
    : [];

  return (
    <div className="mm-ai" data-testid="mm-ai">
      {item && aiAvailable && (
        <div className="dock-panel__focus mm-ai__focus" data-testid="mm-ai-focus">
          <span>
            Looking at: <strong>{item.text}</strong>
            {item.atts.length > 0 && (
              <span className="card__meta">
                {" "}
                &middot; {item.atts.length} attachment{item.atts.length === 1 ? "" : "s"}
              </span>
            )}
          </span>
        </div>
      )}
      <div className="mm-ai__log" ref={log} aria-live="polite">
        {!aiAvailable ? (
          <p className="card__meta" data-testid="mm-ai-unsubscribed">
            Purchase a subscription to access the Stratasphere assistant.
          </p>
        ) : !item ? (
          <p className="card__meta">Open an agenda item to ask about it.</p>
        ) : messages.length === 0 ? (
          <div className="dock-suggest" data-testid="mm-ai-suggestions">
            <p className="card__meta">
              Ask about this item, your bylaws, past decisions, or meeting procedure.
              {props.demoLeft != null && ` The demo includes ${DEMO_LIMITS.meeting} questions in Meeting Mode. ${props.demoLeft} left.`}
            </p>
            {suggestions.map((q) => (
              <button type="button" key={q} className="dock-suggest__q" onClick={() => ask(q)} disabled={busy || props.demoLeft === 0}>
                {q}
              </button>
            ))}
          </div>
        ) : (
          messages.map((m) => (
            <div className="dock-msg" data-role={m.role} key={m.id}>
              <div className="dock-msg__bubble">
                {m.pending && !m.content ? <span className="chat-thinking">Searching your records&hellip;</span> : m.content}
              </div>
              {m.role === "assistant" && !m.pending && (
                <>
                  <Sources corpId={corpId} sources={m.sources} />
                  <p className="dock-msg__note">Research only, not part of the minutes.</p>
                </>
              )}
            </div>
          ))
        )}
        {error && (
          <p className="dock-panel__error" role="alert">
            {error}
          </p>
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
        <form
          className="mm-ai__form"
          onSubmit={(e) => {
            e.preventDefault();
            void ask();
          }}
        >
          <textarea
            rows={2}
            value={draft}
            maxLength={4000}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void ask();
              }
            }}
            placeholder={item ? "Ask Stratasphere…" : "Open an agenda item to ask about it"}
            disabled={!aiAvailable || !item}
            aria-label="Ask Stratasphere"
            data-testid="mm-ai-input"
          />
          <button type="submit" className="button button-primary button-small" disabled={!aiAvailable || !item || busy || !draft.trim()}>
            {busy ? "Answering…" : "Ask"}
          </button>
        </form>
      )}
    </div>
  );
}

/**
 * The meeting's Stratasphere, floating: a button, bottom right, and a window
 * that can be moved and resized (components/FloatingWindow.tsx), opening
 * where it was left (the first time, left of the People and Chat column). Closed, it stays on the page, so an answer being
 * written isn't lost. For council, the manager, and runners only, as the
 * meeting screens are; owners never see Stratasphere.
 */
export function MeetingAssistant(props: React.ComponentProps<typeof MeetingStratasphere>) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {!open && (
        <button type="button" className="dock-fab" onClick={() => setOpen(true)} aria-label="Ask Stratasphere" data-testid="assistant-toggle">
          <span aria-hidden="true">&#10022;</span> Ask Stratasphere&trade;
        </button>
      )}
      {/* Its own place in meetings: first to the left of the People and Chat column, so it never covers the runner's controls. */}
      <FloatingWindow storageKey="stratasphere-window-meeting" rightGap={400} label="Stratasphere" title={<>Stratasphere&trade;</>} onClose={() => setOpen(false)} hidden={!open} testId="mm-ai-window">
        <MeetingStratasphere {...props} />
      </FloatingWindow>
    </>
  );
}
