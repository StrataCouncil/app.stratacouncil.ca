"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { StratasphereSource } from "@/lib/ai/stratasphere";
import { DEMO_LIMIT_MESSAGE } from "@/lib/demo";
import { showDemoLimit } from "@/lib/demo-client";
import { sameFocus, suggestionsFor, type FocusRef } from "@/lib/stratasphere-focus";
import { Sources } from "@/components/StratasphereChat";
import { RequestSubscriptionButton } from "@/components/RequestSubscriptionButton";
import { useStrata } from "@/components/StrataContext";

/**
 * One Stratasphere assistant (PR 4a, docs/learn-decide-remember.md §5): a
 * button, bottom right, on every Your Strata and Stratasphere page, opening
 * a panel docked on the right (the page narrows; on a phone it's a full
 * sheet). The page says what it's showing with <LookingAt>; the panel sends
 * that as a reference, the server reads the record with the person's own
 * access, and the question is saved to their own conversations.
 *
 * Who sees it: council, managers, and admins. Subscribed, it's Stratasphere;
 * not subscribed, it explains Stratasphere at no cost (no AI call).
 *
 * Not shown on Ask (that's the full page), or in Meeting Mode and the
 * members' live page, whose own assistant stays until PR 4b.
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
    try {
      const res = await fetch("/api/stratasphere/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ corpId, conversationId, question, focus: active?.ref ?? null }),
      });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => null)) as { error?: string; demoLimit?: boolean } | null;
        settle(null);
        if (body?.demoLimit) {
          setDraft(question);
          showDemoLimit("Stratasphere questions");
          setError(DEMO_LIMIT_MESSAGE);
          return;
        }
        setError(body?.error ?? "Stratasphere couldn't answer right now. Please try again.");
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let answer = "";
      let finished = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const raw = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!raw) continue;
          const ev = JSON.parse(raw) as
            | { type: "start"; conversationId: string }
            | { type: "delta"; text: string }
            | { type: "done"; messageId: string | null; sources: StratasphereSource[] }
            | { type: "error"; error: string };
          if (ev.type === "start") setConversationId(ev.conversationId);
          else if (ev.type === "delta") {
            answer += ev.text;
            setMessages((prev) => prev.map((m) => (m.id === "pending" ? { ...m, content: answer } : m)));
          } else if (ev.type === "done") {
            finished = true;
            settle({ id: ev.messageId ?? `a-${Date.now()}`, content: answer, sources: ev.sources });
          } else if (ev.type === "error") {
            finished = true;
            settle(null);
            setError(ev.error);
          }
        }
      }
      if (!finished) {
        settle(null);
        setError("The answer was interrupted. Please try again.");
      }
    } catch {
      settle(null);
      setError("Stratasphere couldn't answer right now. Please check your connection and try again.");
    } finally {
      setStreaming(false);
    }
  }

  const suggestions = suggestionsFor(active ? { kind: active.ref.kind, title: active.title } : { kind: "none" });
  const fullPage = `/strata/${encodeURIComponent(corpId)}/assistant${conversationId ? `?c=${conversationId}` : ""}`;

  return (
    <FocusContext.Provider value={mode === "chat" && !hidden ? api : null}>
      <div className="dock-shell" data-open={open && !hidden ? "true" : undefined}>
        {children}
      </div>
      {!hidden && !open && (
        <button type="button" className="dock-fab" onClick={() => setOpen(true)} aria-label="Ask Stratasphere" data-testid="dock-fab">
          <span aria-hidden="true">&#10022;</span> Ask Stratasphere&trade;
        </button>
      )}
      {!hidden && open && (
        <aside className="dock-panel" role="complementary" aria-label="Stratasphere" data-testid="dock-panel">
          <header className="dock-panel__head">
            <strong>Stratasphere&trade;</strong>
            <div className="dock-panel__actions">
              {mode === "chat" && (
                <>
                  <button type="button" className="dock-panel__link" onClick={newConversation} disabled={streaming} aria-label="New conversation" data-testid="dock-new">
                    New
                  </button>
                  <Link href={fullPage} className="dock-panel__link" aria-label="Open Stratasphere full page" data-testid="dock-full">
                    Full page
                  </Link>
                </>
              )}
              <button type="button" className="dock-panel__close" onClick={() => setOpen(false)} aria-label="Close Stratasphere">
                &times;
              </button>
            </div>
          </header>

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
        </aside>
      )}
    </FocusContext.Provider>
  );
}
