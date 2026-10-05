"use client";

import { useEffect, useRef, useState } from "react";
import {
  createProject,
  deleteConversation,
  deleteProject,
  getConversationMessages,
  moveConversationToProject,
  renameConversation,
  renameProject,
  setConversationPinned,
} from "@/app/strata/[corpId]/assistant/actions";
import { getDocumentDownloadUrl } from "@/app/strata/[corpId]/documents/actions";
import { openInNewTab } from "@/lib/open-in-tab";
import type { StratasphereSource } from "@/lib/ai/stratasphere";
import type { ConversationMessage, ConversationProject, ConversationSummary } from "@/lib/data/conversations";

/**
 * The standalone Stratasphere assistant (doc02 §4b). Shaped like the chat
 * products people already know: past conversations in a sidebar (Pinned,
 * Projects, Recents by date), one transcript, a composer. Answers stream in
 * as they're written, and each one lists what it drew on underneath.
 *
 * Conversations are the account holder's alone (0019): not the council's,
 * not the admin's.
 */

type Msg = Omit<ConversationMessage, "createdAt"> & { pending?: boolean };

const SUGGESTIONS = [
  "What do our bylaws say about pets?",
  "What has council decided about the roof in the last two years?",
  "When is the AGM notice due under the Strata Property Act?",
  "Summarize the most recent financial statements.",
];

function dateGroup(iso: string, now: Date): string {
  const d = new Date(iso);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff <= 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return "Previous 7 days";
  if (diff < 30) return "Previous 30 days";
  return d.toLocaleDateString("en-CA", { month: "long", year: "numeric" });
}

function sourceLabel(s: StratasphereSource): string {
  if (s.kind === "document") return s.title;
  if (s.kind === "legislation") return s.title;
  if (s.kind === "decisions") return "Decision ledger";
  return "Cross-platform precedent";
}

function Sources({ corpId, sources }: { corpId: string; sources: StratasphereSource[] }) {
  const [error, setError] = useState("");
  if (!sources.length) return null;

  async function open(documentId: string) {
    setError("");
    const res = await openInNewTab(() => getDocumentDownloadUrl(corpId, documentId, { view: true }));
    if (!res.ok) setError(res.error);
  }

  return (
    <div className="chat-message__sources" data-testid="chat-sources">
      <span className="chat-message__sources-label">Sources</span>
      {sources.map((s, i) =>
        s.kind === "document" ? (
          <button
            type="button"
            key={i}
            className="chat-source"
            data-kind={s.kind}
            onClick={() => open(s.documentId)}
            title="Open this document"
          >
            {s.title}
          </button>
        ) : (
          <span key={i} className="chat-source" data-kind={s.kind}>
            {sourceLabel(s)}
          </span>
        )
      )}
      {error && <span className="chat-message__sources-error">{error}</span>}
    </div>
  );
}

function ConversationRow({
  c,
  active,
  projects,
  onSelect,
  onPin,
  onRename,
  onMove,
  onDelete,
}: {
  c: ConversationSummary;
  active: boolean;
  projects: ConversationProject[];
  onSelect: () => void;
  onPin: () => void;
  onRename: (title: string) => void;
  onMove: (projectId: string | null) => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(c.title);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  if (renaming) {
    return (
      <form
        className="chat-sidebar__rename"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim() && name.trim() !== c.title) onRename(name.trim());
          setRenaming(false);
        }}
      >
        <input
          value={name}
          maxLength={200}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            if (name.trim() && name.trim() !== c.title) onRename(name.trim());
            setRenaming(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setName(c.title);
              setRenaming(false);
            }
          }}
          aria-label="Conversation name"
        />
      </form>
    );
  }

  return (
    <div className="chat-sidebar__item" data-active={active} data-testid={`conversation-${c.id}`}>
      <button className="chat-sidebar__item-main" onClick={onSelect} title={c.title}>
        <span className="chat-sidebar__item-title">{c.title}</span>
      </button>
      <div className="chat-sidebar__move-wrap" ref={wrap}>
        <button
          type="button"
          className="chat-sidebar__pin"
          data-open={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Conversation options"
          data-testid={`conversation-menu-${c.id}`}
        >
          Options
        </button>
        {menuOpen && (
          <div className="chat-sidebar__move-menu" role="menu">
            <button
              type="button"
              className="chat-sidebar__move-option"
              onClick={() => {
                setMenuOpen(false);
                onPin();
              }}
            >
              {c.pinned ? "Unpin" : "Pin"}
            </button>
            <button
              type="button"
              className="chat-sidebar__move-option"
              onClick={() => {
                setMenuOpen(false);
                setName(c.title);
                setRenaming(true);
              }}
            >
              Rename
            </button>
            <div className="chat-sidebar__menu-label">Move to</div>
            <button
              type="button"
              className="chat-sidebar__move-option"
              data-selected={!c.projectId}
              onClick={() => {
                setMenuOpen(false);
                onMove(null);
              }}
            >
              No project
            </button>
            {projects.map((p) => (
              <button
                type="button"
                key={p.id}
                className="chat-sidebar__move-option"
                data-selected={c.projectId === p.id}
                onClick={() => {
                  setMenuOpen(false);
                  onMove(p.id);
                }}
              >
                {p.name}
              </button>
            ))}
            <div className="chat-sidebar__menu-rule" />
            <button
              type="button"
              className="chat-sidebar__move-option"
              data-danger="true"
              onClick={() => {
                setMenuOpen(false);
                onDelete();
              }}
            >
              Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function StratasphereChat({
  corpId,
  corpName,
  indexedDocuments,
  initialConversations,
  initialProjects,
}: {
  corpId: string;
  corpName: string;
  indexedDocuments: number;
  initialConversations: ConversationSummary[];
  initialProjects: ConversationProject[];
}) {
  const [conversations, setConversations] = useState(initialConversations);
  const [projects, setProjects] = useState(initialProjects);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [editingProject, setEditingProject] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("");
  const transcript = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const selectSeq = useRef(0);
  // Phones: the conversation list is a drawer over the chat (CSS decides;
  // on a desktop the list is always beside it and this does nothing).
  const [listOpen, setListOpen] = useState(false);

  // Follow the answer as it streams, unless the reader has scrolled up.
  useEffect(() => {
    const el = transcript.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [draft]);

  async function select(id: string) {
    setListOpen(false);
    if (streaming || id === activeId) return;
    const seq = ++selectSeq.current;
    setActiveId(id);
    setMessages([]);
    setError("");
    setLoading(true);
    const res = await getConversationMessages(corpId, id);
    if (seq !== selectSeq.current) return;
    setLoading(false);
    if (res.ok) {
      setMessages(res.messages);
      requestAnimationFrame(() => {
        if (transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight;
      });
    } else {
      setError(res.error);
    }
  }

  function newChat() {
    setListOpen(false);
    if (streaming) return;
    selectSeq.current++;
    setActiveId(null);
    setMessages([]);
    setError("");
    setLoading(false);
    input.current?.focus();
  }

  function patchConversation(id: string, patch: Partial<ConversationSummary>) {
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  async function optimistic(id: string, patch: Partial<ConversationSummary>, run: () => Promise<{ ok: boolean; error?: string }>) {
    const before = conversations.find((c) => c.id === id);
    patchConversation(id, patch);
    const res = await run();
    if (!res.ok && before) {
      patchConversation(id, before);
      setError(res.error ?? "Couldn't save that change.");
    }
  }

  async function remove(c: ConversationSummary) {
    if (!window.confirm(`Delete "${c.title}"? This can't be undone.`)) return;
    const res = await deleteConversation(corpId, c.id);
    if (!res.ok) return setError(res.error);
    setConversations((prev) => prev.filter((x) => x.id !== c.id));
    if (activeId === c.id) newChat();
  }

  async function addProject(e: React.FormEvent) {
    e.preventDefault();
    const res = await createProject(corpId, newProjectName);
    if (!res.ok) return setError(res.error);
    setProjects((prev) => [...prev, res.project]);
    setNewProjectName("");
    setNewProjectOpen(false);
  }

  async function saveProjectName(p: ConversationProject) {
    setEditingProject(null);
    const n = projectName.trim();
    if (!n || n === p.name) return;
    setProjects((prev) => prev.map((x) => (x.id === p.id ? { ...x, name: n } : x)));
    const res = await renameProject(corpId, p.id, n);
    if (!res.ok) {
      setProjects((prev) => prev.map((x) => (x.id === p.id ? p : x)));
      setError(res.error);
    }
  }

  async function removeProject(p: ConversationProject) {
    if (!window.confirm(`Delete the project "${p.name}"? Its conversations move back to Recents.`)) return;
    const res = await deleteProject(corpId, p.id);
    if (!res.ok) return setError(res.error);
    setProjects((prev) => prev.filter((x) => x.id !== p.id));
    setConversations((prev) => prev.map((c) => (c.projectId === p.id ? { ...c, projectId: null } : c)));
  }

  async function send(text?: string) {
    const question = (text ?? draft).trim();
    if (!question || streaming) return;
    setError("");
    setDraft("");
    setStreaming(true);
    const conversationId = activeId;
    setMessages((prev) => [
      ...prev,
      { id: `q-${Date.now()}`, role: "user", content: question, sources: [] },
      { id: "pending", role: "assistant", content: "", sources: [], pending: true },
    ]);
    const settle = (patch: Partial<Msg> | null) =>
      setMessages((prev) =>
        patch === null
          ? prev.filter((m) => m.id !== "pending")
          : prev.map((m) => (m.id === "pending" ? { ...m, ...patch, pending: false } : m))
      );

    try {
      const res = await fetch("/api/stratasphere/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ corpId, conversationId, question }),
      });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        settle(null);
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
            | { type: "start"; conversationId: string; title: string }
            | { type: "delta"; text: string }
            | { type: "done"; messageId: string | null; sources: StratasphereSource[] }
            | { type: "error"; error: string };
          if (ev.type === "start") {
            const now = new Date().toISOString();
            setActiveId(ev.conversationId);
            setConversations((prev) => {
              const existing = prev.find((c) => c.id === ev.conversationId);
              const row: ConversationSummary = existing
                ? { ...existing, updatedAt: now }
                : { id: ev.conversationId, title: ev.title, pinned: false, projectId: null, updatedAt: now };
              return [row, ...prev.filter((c) => c.id !== ev.conversationId)];
            });
          } else if (ev.type === "delta") {
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
      input.current?.focus();
    }
  }

  const now = new Date();
  const pinned = conversations.filter((c) => c.pinned);
  const unpinned = conversations.filter((c) => !c.pinned);
  const recents = unpinned.filter((c) => !c.projectId || !projects.some((p) => p.id === c.projectId));
  const recentGroups: { label: string; items: ConversationSummary[] }[] = [];
  for (const c of recents) {
    const label = dateGroup(c.updatedAt, now);
    const group = recentGroups.find((g) => g.label === label);
    if (group) group.items.push(c);
    else recentGroups.push({ label, items: [c] });
  }

  const row = (c: ConversationSummary) => (
    <ConversationRow
      key={c.id}
      c={c}
      active={c.id === activeId}
      projects={projects}
      onSelect={() => select(c.id)}
      onPin={() => optimistic(c.id, { pinned: !c.pinned }, () => setConversationPinned(corpId, c.id, !c.pinned))}
      onRename={(title) => optimistic(c.id, { title }, () => renameConversation(corpId, c.id, title))}
      onMove={(projectId) => optimistic(c.id, { projectId }, () => moveConversationToProject(corpId, c.id, projectId))}
      onDelete={() => remove(c)}
    />
  );

  const activeTitle = conversations.find((c) => c.id === activeId)?.title;

  return (
    <div className="chat-shell" data-list-open={listOpen} data-testid="stratasphere-chat">
      {listOpen && <button type="button" className="chat-drawer-backdrop" aria-label="Close conversations" onClick={() => setListOpen(false)} />}
      <aside className="chat-sidebar" id="chat-conversations">
        <button className="button button-secondary chat-sidebar__new" data-testid="new-chat" onClick={newChat} disabled={streaming}>
          New conversation
        </button>
        <div className="chat-sidebar__list">
          {pinned.length > 0 && (
            <div className="chat-sidebar__section">
              <div className="chat-sidebar__section-title">Pinned</div>
              {pinned.map(row)}
            </div>
          )}

          <div className="chat-sidebar__section">
            <div className="chat-sidebar__section-title-row">
              <div className="chat-sidebar__section-title">Projects</div>
              <button
                type="button"
                className="chat-sidebar__section-action"
                onClick={() => setNewProjectOpen((v) => !v)}
                data-testid="new-project-trigger"
              >
                New
              </button>
            </div>
            {newProjectOpen && (
              <form className="chat-sidebar__new-project-form" onSubmit={addProject} data-testid="new-project-form">
                <input
                  type="text"
                  placeholder="Project name"
                  value={newProjectName}
                  maxLength={120}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  data-testid="new-project-input"
                  autoFocus
                />
                <div className="chat-sidebar__new-project-actions">
                  <button
                    type="button"
                    className="button button-secondary button-small"
                    onClick={() => {
                      setNewProjectOpen(false);
                      setNewProjectName("");
                    }}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="button button-primary button-small" disabled={!newProjectName.trim()}>
                    Create
                  </button>
                </div>
              </form>
            )}
            {projects.length === 0 && !newProjectOpen && (
              <div className="chat-sidebar__project-empty">Group related conversations, like a renewal or a dispute.</div>
            )}
            {projects.map((p) => {
              const items = unpinned.filter((c) => c.projectId === p.id);
              return (
                <div className="chat-sidebar__project" key={p.id} data-testid={`project-${p.id}`}>
                  {editingProject === p.id ? (
                    <form
                      className="chat-sidebar__rename"
                      onSubmit={(e) => {
                        e.preventDefault();
                        saveProjectName(p);
                      }}
                    >
                      <input
                        value={projectName}
                        maxLength={120}
                        autoFocus
                        onChange={(e) => setProjectName(e.target.value)}
                        onBlur={() => saveProjectName(p)}
                        onKeyDown={(e) => e.key === "Escape" && setEditingProject(null)}
                        aria-label="Project name"
                      />
                    </form>
                  ) : (
                    <div className="chat-sidebar__project-row">
                      <div className="chat-sidebar__project-name">{p.name}</div>
                      <div className="chat-sidebar__project-actions">
                        <button
                          type="button"
                          onClick={() => {
                            setProjectName(p.name);
                            setEditingProject(p.id);
                          }}
                        >
                          Rename
                        </button>
                        <button type="button" onClick={() => removeProject(p)}>
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                  {items.length === 0 ? <div className="chat-sidebar__project-empty">No conversations yet</div> : items.map(row)}
                </div>
              );
            })}
          </div>

          {recentGroups.length > 0 && (
            <div className="chat-sidebar__section">
              <div className="chat-sidebar__section-title">Recents</div>
              {recentGroups.map((g) => (
                <div key={g.label}>
                  <div className="chat-sidebar__date-label">{g.label}</div>
                  {g.items.map(row)}
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>

      <div className="chat-main">
        <div className="chat-mobile-bar">
          <button
            type="button"
            className="button button-secondary button-small"
            aria-expanded={listOpen}
            aria-controls="chat-conversations"
            onClick={() => setListOpen(true)}
            data-testid="chat-open-list"
          >
            Conversations
          </button>
          <span className="chat-mobile-bar__title">{activeTitle ?? "New conversation"}</span>
          <button type="button" className="button button-secondary button-small" onClick={newChat} disabled={streaming}>
            New
          </button>
        </div>
        <div className="chat-kb-banner" data-testid="kb-banner">
          {activeTitle ? <strong className="chat-kb-banner__title">{activeTitle}</strong> : null}
          <span>
            Draws on {corpName}&rsquo;s document repository ({indexedDocuments} indexed{" "}
            {indexedDocuments === 1 ? "document" : "documents"}, minutes included), the decision ledger, BC strata
            legislation and anonymized precedent from other strata corporations.
          </span>
        </div>

        {messages.length > 0 || loading ? (
          <div className="chat-transcript" ref={transcript} data-testid="chat-transcript">
            {loading && <p className="chat-loading">Loading conversation&hellip;</p>}
            {messages.map((m) => (
              <div className="chat-message" data-role={m.role} key={m.id}>
                <div className="chat-message__bubble" data-pending={m.pending && !m.content ? "true" : undefined}>
                  {m.pending && !m.content ? (
                    <span className="chat-thinking" role="status">
                      Searching your records
                      <span className="chat-dots" aria-hidden="true">
                        <span />
                        <span />
                        <span />
                      </span>
                    </span>
                  ) : (
                    m.content
                  )}
                  {m.pending && m.content ? (
                    <span className="chat-dots chat-dots--inline" aria-label="Still writing">
                      <span />
                      <span />
                      <span />
                    </span>
                  ) : null}
                </div>
                {m.role === "assistant" && !m.pending && <Sources corpId={corpId} sources={m.sources} />}
              </div>
            ))}
          </div>
        ) : (
          <div className="chat-empty">
            <h3>Ask Stratasphere</h3>
            <p>
              Questions about your bylaws, minutes, past decisions, finances and BC strata legislation. Every answer names
              its sources.
            </p>
            <div className="chat-suggestions">
              {SUGGESTIONS.map((s) => (
                <button type="button" key={s} className="chat-suggestion" onClick={() => send(s)} disabled={streaming}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div className="chat-error" role="alert" data-testid="chat-error">
            {error}
          </div>
        )}

        <form
          className="chat-composer"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          data-testid="chat-composer"
        >
          <textarea
            ref={input}
            rows={1}
            placeholder="Ask Stratasphere a question"
            value={draft}
            maxLength={4000}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            data-testid="chat-input"
          />
          <button
            type="submit"
            className="button button-primary button-small"
            disabled={streaming || !draft.trim()}
            data-testid="chat-send"
          >
            {streaming ? "Answering" : "Send"}
          </button>
        </form>
        <p className="chat-disclaimer">
          Stratasphere explains your records and the law in general terms. It isn&rsquo;t legal advice, and it can be
          wrong: check the sources it names.
        </p>
      </div>
    </div>
  );
}
