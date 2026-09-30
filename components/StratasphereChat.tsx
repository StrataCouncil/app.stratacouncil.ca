"use client";

import { useState } from "react";
import { documents, type Conversation, type Project } from "@/lib/placeholder-data";

/**
 * The standalone Stratasphere™ assistant — deliberately shaped like a
 * familiar chat product (sidebar of past threads, one active transcript,
 * a message composer) because that's the interaction model people
 * already know, not a novel one worth inventing here. Two things that
 * model has to actually deliver on for this to be honest, both real
 * design commitments from doc02, not just UI chrome:
 *
 * 1. Cognition of the full KB, every time — legislation, cross-platform
 *    precedent, and this corporation's own indexed documents + decision
 *    ledger (doc02 §0a/§3), not just whatever's in the current thread.
 *    The banner under the header and the citations under each reply are
 *    both here to make that concrete rather than asserted.
 * 2. Persistent conversation history across sessions, the same way
 *    ChatGPT's sidebar works — doc02 §6 open question 5 names "one log
 *    per session" as the working assumption for the standalone reset
 *    boundary, which is exactly what this thread list is.
 *
 * No backend yet, so switching threads and starting a new one is real
 * (client-side) but sending a message is not — the composer is honest
 * about that rather than pretending to respond.
 *
 * Sidebar is grouped the way ChatGPT's is, not a flat list: Pinned first,
 * then Projects (each a named container a conversation can belong to),
 * then Recents grouped by the same relative-date labels a conversation's
 * `updatedAt` already carries (Today / Yesterday / Previous 7 Days). A
 * pinned conversation shows under Pinned only, even if it also belongs to
 * a project, so it isn't listed twice.
 *
 * Pin/unpin is a real (client-side) toggle, not just a filter the seed
 * data happens to satisfy — the data always had a `pinned` flag, but
 * nothing in the UI could change it, which is its own kind of dishonest
 * mock (a control that looks like state but is actually just fixture
 * data). The toggle itself sits inside each row rather than as a
 * separate menu: "Pin"/"Unpin" shows on hover for an unpinned thread,
 * and stays visible for a pinned one so it's discoverable without
 * hovering into the Pinned section specifically.
 *
 * Projects are the same story — creating one and moving a conversation
 * in or out of one are both real (client-side) actions now, not just
 * seed data with no control surface. "+ New" sits in the Projects
 * section header (always rendered, even with zero projects, so there's
 * somewhere to create the first one). Moving a conversation is a small
 * popover ("Move") rather than a dropdown `<select>`, matching the
 * lightweight-popover pattern already used for `RosterTable`'s role
 * editor — "No project" is always the first option, so removing a
 * conversation from a project is the same action as assigning one.
 * A project with no conversations in it yet still renders (with a
 * one-line "No conversations yet"), rather than disappearing the moment
 * it's created.
 */
function ThreadButton({
  c,
  active,
  onSelect,
  onTogglePin,
  onMove,
  projects,
}: {
  c: Conversation;
  active: boolean;
  onSelect: () => void;
  onTogglePin: () => void;
  onMove: (projectId: string | null) => void;
  projects: Project[];
}) {
  const [moveOpen, setMoveOpen] = useState(false);

  return (
    <div
      className="chat-sidebar__item"
      data-active={active}
      data-testid={`conversation-${c.id}`}
    >
      <button className="chat-sidebar__item-main" onClick={onSelect}>
        <span className="chat-sidebar__item-title">{c.title}</span>
        <span className="chat-sidebar__item-meta">{c.updatedAt}</span>
      </button>

      <div className="chat-sidebar__item-actions">
        <div className="chat-sidebar__move-wrap">
          <button
            type="button"
            className="chat-sidebar__pin"
            onClick={(e) => {
              e.stopPropagation();
              setMoveOpen((v) => !v);
            }}
            title="Move to project"
            data-testid={`move-trigger-${c.id}`}
          >
            Move
          </button>
          {moveOpen && (
            <div className="chat-sidebar__move-menu" data-testid={`move-menu-${c.id}`}>
              <button
                type="button"
                className="chat-sidebar__move-option"
                data-selected={!c.projectId}
                onClick={(e) => {
                  e.stopPropagation();
                  onMove(null);
                  setMoveOpen(false);
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
                  onClick={(e) => {
                    e.stopPropagation();
                    onMove(p.id);
                    setMoveOpen(false);
                  }}
                >
                  {p.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          type="button"
          className="chat-sidebar__pin"
          data-pinned={!!c.pinned}
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin();
          }}
          title={c.pinned ? "Unpin conversation" : "Pin conversation"}
          data-testid={`pin-toggle-${c.id}`}
        >
          {c.pinned ? "Unpin" : "Pin"}
        </button>
      </div>
    </div>
  );
}

export function StratasphereChat({
  conversations: initialConversations,
  projects: initialProjects,
}: {
  conversations: Conversation[];
  projects: Project[];
}) {
  const [conversations, setConversations] = useState(initialConversations);
  const [projects, setProjects] = useState(initialProjects);
  const [activeId, setActiveId] = useState(conversations[0]?.id);
  const active = conversations.find((c) => c.id === activeId) ?? conversations[0];
  const [draft, setDraft] = useState("");
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");

  const docCount = documents.length;

  function togglePin(id: string) {
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, pinned: !c.pinned } : c))
    );
  }

  function moveConversation(id: string, projectId: string | null) {
    setConversations((prev) =>
      prev.map((c) =>
        c.id === id ? { ...c, projectId: projectId ?? undefined } : c
      )
    );
  }

  function createProject(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = newProjectName.trim();
    if (!trimmed) return;
    setProjects((prev) => [...prev, { id: `proj-${Date.now()}`, name: trimmed }]);
    setNewProjectName("");
    setNewProjectOpen(false);
  }

  const pinned = conversations.filter((c) => c.pinned);
  const unpinned = conversations.filter((c) => !c.pinned);
  // Every project renders, even with zero conversations — otherwise a
  // freshly created project has nowhere to appear until something's
  // moved into it.
  const byProject = projects.map((p) => ({
    project: p,
    items: unpinned.filter((c) => c.projectId === p.id),
  }));
  const recents = unpinned.filter((c) => !c.projectId);
  const recentGroups: { label: string; items: Conversation[] }[] = [];
  for (const c of recents) {
    const group = recentGroups.find((g) => g.label === c.updatedAt);
    if (group) group.items.push(c);
    else recentGroups.push({ label: c.updatedAt, items: [c] });
  }

  return (
    <div className="chat-shell" data-testid="stratasphere-chat">
      <aside className="chat-sidebar">
        <button
          className="button button-secondary chat-sidebar__new"
          data-testid="new-chat"
          onClick={() => setActiveId(undefined)}
        >
          + New chat
        </button>
        <div className="chat-sidebar__list">
          {pinned.length > 0 && (
            <div className="chat-sidebar__section">
              <div className="chat-sidebar__section-title">Pinned</div>
              {pinned.map((c) => (
                <ThreadButton
                  key={c.id}
                  c={c}
                  active={c.id === active?.id}
                  onSelect={() => setActiveId(c.id)}
                  onTogglePin={() => togglePin(c.id)}
                  onMove={(pid) => moveConversation(c.id, pid)}
                  projects={projects}
                />
              ))}
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
                + New
              </button>
            </div>

            {newProjectOpen && (
              <form
                className="chat-sidebar__new-project-form"
                onSubmit={createProject}
                data-testid="new-project-form"
              >
                <input
                  type="text"
                  placeholder="Project name"
                  value={newProjectName}
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
                  <button
                    type="submit"
                    className="button button-primary button-small"
                    disabled={!newProjectName.trim()}
                    data-testid="new-project-submit"
                  >
                    Create
                  </button>
                </div>
              </form>
            )}

            {byProject.map(({ project, items }) => (
              <div className="chat-sidebar__project" key={project.id} data-testid={`project-${project.id}`}>
                <div className="chat-sidebar__project-name">{project.name}</div>
                {items.length === 0 ? (
                  <div className="chat-sidebar__project-empty">No conversations yet</div>
                ) : (
                  items.map((c) => (
                    <ThreadButton
                      key={c.id}
                      c={c}
                      active={c.id === active?.id}
                      onSelect={() => setActiveId(c.id)}
                      onTogglePin={() => togglePin(c.id)}
                      onMove={(pid) => moveConversation(c.id, pid)}
                      projects={projects}
                    />
                  ))
                )}
              </div>
            ))}
          </div>

          {recentGroups.length > 0 && (
            <div className="chat-sidebar__section">
              <div className="chat-sidebar__section-title">Recents</div>
              {recentGroups.map((g) => (
                <div key={g.label}>
                  <div className="chat-sidebar__date-label">{g.label}</div>
                  {g.items.map((c) => (
                    <ThreadButton
                      key={c.id}
                      c={c}
                      active={c.id === active?.id}
                      onSelect={() => setActiveId(c.id)}
                      onTogglePin={() => togglePin(c.id)}
                      onMove={(pid) => moveConversation(c.id, pid)}
                      projects={projects}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>

      <div className="chat-main">
        <div className="chat-kb-banner" data-testid="kb-banner">
          Knows your full knowledge base: {docCount} indexed documents, the
          decision ledger, BC strata legislation, and cross-platform
          precedent &mdash; plus every past conversation in the sidebar.
        </div>

        {active ? (
          <div className="chat-transcript">
            {active.messages.map((m, i) => (
              <div className="chat-message" data-role={m.role} key={i}>
                <div className="chat-message__bubble">{m.content}</div>
                {m.citations && (
                  <div className="chat-message__citations">
                    Sources: {m.citations.join(" · ")}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="chat-empty">
            <h3>New conversation</h3>
            <p>
              Ask about bylaws, financials, past decisions, or anything else
              in {docCount} indexed documents &mdash; local precedent and BC
              legislation are always included.
            </p>
          </div>
        )}

        <form
          className="chat-composer"
          onSubmit={(e) => e.preventDefault()}
          data-testid="chat-composer"
        >
          <input
            type="text"
            placeholder={"Message Stratasphere™..."}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            data-testid="chat-input"
          />
          <button
            type="submit"
            className="button button-primary button-small"
            disabled
            title="Not wired up yet — UI preview only"
            data-testid="chat-send"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
