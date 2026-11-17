"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { StratasphereSource } from "@/lib/ai/stratasphere";
import { askStream } from "@/lib/stratasphere-stream";
import { DEMO_LIMIT_MESSAGE } from "@/lib/demo";
import { showDemoLimit } from "@/lib/demo-client";
import { sameFocus, suggestionsFor, type FocusRef } from "@/lib/stratasphere-focus";
import { Sources } from "@/components/StratasphereChat";
import { RequestSubscriptionButton } from "@/components/RequestSubscriptionButton";
import { useStrata } from "@/components/StrataContext";
import { FloatingWindow } from "@/components/FloatingWindow";

/**
 * One Stratasphere assistant (PR 4a, docs/learn-decide-remember.md §5): a
 * button, bottom right, on every Your Strata and Stratasphere page, opening
 * a floating window (components/FloatingWindow.tsx) that can be moved and
 * resized, and remembers where it was left; on a phone it fills the screen. The page says what it's showing with <LookingAt>; the panel sends
 * that as a reference, the server reads the record with the person's own
 * access, and the question is saved to their own conversations.
 *
 * Who sees it: council, managers, and admins. Subscribed, it's Stratasphere;
 * not subscribed, it explains Stratasphere at no cost (no AI call).
 *
 * Not shown on Ask (that's the full page), or in Meeting Mode and the
 * members' live page, which float their own meeting assistant the same way
 * (components/meetings/MeetingStratasphere.tsx, about the agenda item).
 */

export type PageFocus = { ref: FocusRef; label: string; title: string };

type FocusApi = {
  /** The page's record (null when the page is about nothing in particular). */
  setPageFocus: (f: PageFocus | null) => void;
  /** Open the panel about a record ("Ask about this"). */
  askAbout: (f: PageFocus) => void;
};

const FocusContext = createContext<FocusApi | null>(null);

/** Put on a page to tell Stratasphere what it shows. Renders nothing. */
export function LookingAt({ focus }: { focus: PageFocus | null }) {
  const api = useContext(FocusContext);
  const key = focus ? JSON.stringify(focus) : "";
  useEffect(() => {
    if (!api) return;
    api.setPageFocus(focus);
    return () => api.setPageFocus(null);
    // The focus is compared by value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, key]);
  return null;
}

/** A small "Ask Stratasphere" link beside a record; nothing if the person can't use Stratasphere. */
export function AskAboutButton({ focus, className }: { focus: PageFocus; className?: string }) {
  const api = useContext(FocusContext);
  if (!api) return null;
  return (
    <button type="button" className={className ?? "button button-secondary button-small"} onClick={() => api.askAbout(focus)} data-testid="ask-about">
      {className ? "Ask" : "Ask Stratasphere\u2122"}
    </button>
  );
}

type Msg = { id: string; role: "user" | "assistant"; content: string; sources: StratasphereSource[]; pending?: boolean; error?: boolean };

const HIDDEN = [/\/assistant(\/|$)/, /\/meetings\/[^/]+\/(run|live)(\/|$)/];

export function StratasphereDock({ mode, children }: { mode: "chat" | "pitch" | "none"; children: React.ReactNode }) {
  const { corpId, canBill, pending } = useStrata();
  const pathname = usePathname() ?? "";
  const hidden = mode === "none" || HIDDEN.some((r) => r.test(pathname));

  const [open, setOpen] = useState(false);
  const [pageFocus, setPageFocusState] = useState<PageFocus | null>(null);
  const [focus, setFocus] = useState<PageFocus | null>(null);
  const [cleared, setCleared] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");
  const streamingNow = useRef(false);
  useEffect(() => {
    streamingNow.current = streaming;
  }, [streaming]);
  // One conversation per record looked at, for this visit: coming back to a
  // page continues its conversation (docs §5 "Conversations").
  const threads = useRef(new Map<string, { id: string | null; messages: Msg[] }>());
  const keyOf = (f: PageFocus | null) => (f ? JSON.stringify(f.ref) : "general");
  const transcript = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  // The thread on screen, kept in refs so switching records reads the latest.
  const focusNow = useRef<PageFocus | null>(null);
  const thread = useRef<{ id: string | null; messages: Msg[] }>({ id: null, messages: [] });
  useEffect(() => {
    thread.current = { id: conversationId, messages };
  }, [conversationId, messages]);

  const switchTo = useCallback((next: PageFocus | null) => {
    const prev = focusNow.current;
    focusNow.current = next;
    setFocus(next);
    setCleared(false);
    if (sameFocus(prev?.ref ?? null, next?.ref ?? null)) return;
    // Park this record's conversation; pick up the next one's.
    threads.current.set(keyOf(prev), thread.current);
    const t = threads.current.get(keyOf(next));
    thread.current = t ?? { id: null, messages: [] };
    setConversationId(thread.current.id);
    setMessages(thread.current.messages);
    setError("");
  }, []);

  const api = useMemo<FocusApi>(
    () => ({
      setPageFocus: (f) => setPageFocusState(f),
      askAbout: (f) => {
        if (streamingNow.current) return;
        switchTo(f);
        setOpen(true);
        requestAnimationFrame(() => input.current?.focus());
      },
    }),
    [switchTo]
  );

  // The page's record becomes the panel's focus, unless a question is being answered.
  useEffect(() => {
    if (!streaming) switchTo(pageFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageFocus, streaming]);

  useEffect(() => {
    const el = transcript.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const active = cleared ? null : focus;

  function newConversation() {
    if (streaming) return;
    threads.current.delete(keyOf(focus));
    setConversationId(null);
    setMessages([]);
    setError("");
  }

  async function ask(text?: string) {
    const question = (text ?? draft).trim();
    if (!question || streaming) return;
    setError("");
    setDraft("");
    setStreaming(true);
    setMessages((prev) => [
      ...prev,
      { id: `q-${Date.now()}`, role: "user", content: question, sources: [] },
      { id: "pending", role: "assistant", content: "", sources: [], pending: true },
    ]);
    const settle = (patch: Partial<Msg> | null) =>
      setMessages((prev) =>
        patch === null ? prev.filter((m) => m.id !== "pending") : prev.map((m) => (m.id === "pending" ? { ...m, ...patch, pending: false } : m))
      );
    const result = await askStream(
      { corpId, conversationId, question, focus: active?.ref ?? null },
      {
        start: (id) => setConversationId(id),
        text: (soFar) => setMessages((prev) => prev.map((m) => (m.id === "pending" ? { ...m, content: soFar } : m))),
      }
    );
    setStreaming(false);
    if (result.ok) {
      settle({ id: result.messageId ?? `a-${Date.now()}`, content: result.text, sources: result.sources });
      return;
    }
    settle(null);
    if (result.demoLimit) {
      setDraft(question);
      showDemoLimit("Stratasphere questions");
      setError(DEMO_LIMIT_MESSAGE);
      return;
    }
    setError(result.error);
  }

  const suggestions = suggestionsFor(active ? { kind: active.ref.kind, title: active.title } : { kind: "none" });
  const fullPage = `/strata/${encodeURIComponent(corpId)}/assistant${conversationId ? `?c=${conversationId}` : ""}`;

  return (
    <FocusContext.Provider value={mode === "chat" && !hidden ? api : null}>
      <div className="dock-shell">
        {children}
      </div>
      {!hidden && !open && (
        <button type="button" className="dock-fab" onClick={() => setOpen(true)} aria-label="Ask Stratasphere" data-testid="dock-fab">
          <span aria-hidden="true">&#10022;</span> Ask Stratasphere&trade;
        </button>
      )}
      {!hidden && open && (
        <FloatingWindow
          storageKey="stratasphere-window"
          label="Stratasphere"
          title={<>Stratasphere&trade;</>}
          onClose={() => setOpen(false)}
          testId="dock-panel"
          actions={
            mode === "chat" ? (
              <>
                <button type="button" className="dock-panel__link" onClick={newConversation} disabled={streaming} aria-label="New conversation" data-testid="dock-new">
                  New
                </button>
                <Link href={fullPage} className="dock-panel__link" aria-label="Open Stratasphere full page" data-testid="dock-full">
                  Full page
                </Link>
              </>
            ) : null
          }
        >

          {mode === "pitch" ? (
            <div className="dock-panel__body dock-pitch" data-testid="dock-pitch">
              <p>
                Stratasphere answers from your strata&rsquo;s bylaws, minutes, documents, and decisions, and from BC strata
                legislation, with its sources. It comes with a subscription.
              </p>
              <figure className="dock-pitch__example" aria-label="An example answer">
                <p className="dock-pitch__q">Have we approved a pet policy before?</p>
                <p className="dock-pitch__a">
                  Yes. Council approved the Pet Policy at its March 4 meeting (carried 5 for, 0 against), allowing one dog
                  or cat per lot. Bylaw 3(4) limits pets to two.
                </p>
                <p className="dock-pitch__sources">Sources: Council minutes, March 4 &middot; Bylaws</p>
                <figcaption>An example. Answers come from your own records.</figcaption>
              </figure>
              {pending ? (
                <p className="card__meta">Your subscription is being set up.</p>
              ) : canBill ? (
                <Link href={`/strata/${encodeURIComponent(corpId)}/billing?step=plan`} className="button button-primary" data-testid="dock-subscribe">
                  Subscribe
                </Link>
              ) : (
                <RequestSubscriptionButton corpId={corpId} />
              )}
            </div>
          ) : (
            <>
              {active && (
                <div className="dock-panel__focus" data-testid="dock-focus">
                  <span>
                    Looking at: <strong>{active.label}</strong>
                  </span>
                  <button type="button" onClick={() => setCleared(true)} aria-label="Ask a general question instead" title="Ask a general question instead">
                    &times;
                  </button>
                </div>
              )}
              <div className="dock-panel__body" ref={transcript}>
                {messages.length === 0 ? (
                  <div className="dock-suggest" data-testid="dock-suggestions">
                    <p className="card__meta">{active ? "Ask about this, or anything in your strata's records." : "Ask anything about your strata's records."}</p>
                    {suggestions.map((q) => (
                      <button type="button" key={q} className="dock-suggest__q" onClick={() => ask(q)} disabled={streaming}>
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
              <form
                className="dock-panel__compose"
                onSubmit={(e) => {
                  e.preventDefault();
                  void ask();
                }}
              >
                <textarea
                  ref={input}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void ask();
                    }
                  }}
                  rows={2}
                  maxLength={4000}
                  placeholder="Ask Stratasphere…"
                  aria-label="Your question"
                  data-testid="dock-input"
                />
                <button type="submit" className="button button-primary button-small" disabled={streaming || !draft.trim()}>
                  {streaming ? "Answering…" : "Ask"}
                </button>
              </form>
            </>
          )}
        </FloatingWindow>
      )}
    </FocusContext.Provider>
  );
}
