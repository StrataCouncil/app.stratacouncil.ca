"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { addDirective, editDirective, setDirectiveStatus, suggestWording, type DirectiveInput } from "@/app/strata/[corpId]/discussions/directives/actions";
import type { Assignable, Directive, DirectiveChange } from "@/lib/data/directives";
import { assigneeLabel, dayLabel, filterDirectives, isOverdue, sortDirectives, type ListFilter } from "@/lib/directives/list";
import { meetingTypeLabels, type MeetingType } from "@/lib/meetings/agenda";
import { isDemoLimit, showDemoLimit } from "@/lib/demo-client";
import { tz } from "@/lib/time-zone";

/**
 * The Directives list (0097): open first, overdue flagged, with filters and
 * search. A row opens to show where it came from, its history, and what you
 * can do: edit, add, cancel, or reopen (those who run meetings), and mark
 * done (they and the manager).
 */

const FILTERS: { key: ListFilter; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "mine", label: "Assigned to me" },
  { key: "done", label: "Done or cancelled" },
  { key: "all", label: "All" },
];

const when = (iso: string) =>
  new Date(iso).toLocaleDateString("en-CA", { timeZone: tz("America/Vancouver", iso), year: "numeric", month: "short", day: "numeric" });

export function DirectivesBoard(props: {
  corpId: string;
  directives: Directive[];
  changes: DirectiveChange[];
  assignable: Assignable[];
  canEdit: boolean;
  isManager: boolean;
  seesDiscussions: boolean;
  suggestWording: boolean;
  userId: string;
  today: string;
}) {
  const [filter, setFilter] = useState<ListFilter>("open");
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const shown = useMemo(
    () => sortDirectives(filterDirectives(props.directives, filter, { userId: props.userId, isManager: props.isManager }, q)),
    [props.directives, filter, q, props.userId, props.isManager]
  );
  const counts = useMemo(
    () => ({
      open: props.directives.filter((d) => d.status === "open").length,
      overdue: props.directives.filter((d) => isOverdue(d, props.today)).length,
    }),
    [props.directives, props.today]
  );
  const historyOf = useMemo(() => {
    const m = new Map<string, DirectiveChange[]>();
    for (const c of props.changes) m.set(c.directiveId, [...(m.get(c.directiveId) ?? []), c]);
    return m;
  }, [props.changes]);

  return (
    <div className="directives" data-testid="directives">
      <div className="directives__tools">
        <div className="directives__filters" role="group" aria-label="Show">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className="button button-secondary button-small"
              data-active={filter === f.key}
              aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
              data-testid={`directives-filter-${f.key}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <input type="search" placeholder="Search directives" aria-label="Search directives" value={q} onChange={(e) => setQ(e.target.value)} data-testid="directives-search" />
        {props.canEdit && !adding && (
          <button type="button" className="button button-primary" onClick={() => setAdding(true)} data-testid="directive-add">
            Add a directive
          </button>
        )}
      </div>
      <p className="card__meta" data-testid="directives-summary">
        {counts.open} open{counts.overdue ? `, ${counts.overdue} overdue` : ""}
      </p>

      {adding && (
        <div className="directive-card directive-card--form">
          <h3>Add a directive</h3>
          <DirectiveForm
            corpId={props.corpId}
            assignable={props.assignable}
            suggest={props.suggestWording}
            onDone={() => setAdding(false)}
          />
        </div>
      )}

      {shown.length === 0 ? (
        <p className="card__meta" data-testid="directives-empty">
          {props.directives.length === 0
            ? props.canEdit
              ? "No directives yet. They appear here when a meeting carries a motion that needs follow-up, or when council supports a Discussion. You can also add one."
              : "No directives yet. They appear here when a meeting carries a motion that needs follow-up, or when council supports a Discussion."
            : filter === "mine"
              ? "Nothing open is assigned to you."
              : filter === "open"
                ? "Nothing open. Everything council asked for is done."
                : "None match."}
        </p>
      ) : (
        <ul className="directive-list" data-testid="directives-list">
          {shown.map((d) => (
            <DirectiveRow
              key={d.id}
              d={d}
              corpId={props.corpId}
              open={openId === d.id}
              onToggle={() => setOpenId(openId === d.id ? null : d.id)}
              history={historyOf.get(d.id) ?? []}
              canEdit={props.canEdit}
              canClose={props.canEdit || props.isManager}
              seesDiscussions={props.seesDiscussions}
              assignable={props.assignable}
              suggest={props.suggestWording}
              today={props.today}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function sourceLine(d: Directive, seesDiscussions: boolean, corpId: string) {
  if (d.source === "meeting" && d.meetingId) {
    const label = `${d.meetingType ? meetingTypeLabels[d.meetingType as MeetingType] ?? "Meeting" : "Meeting"}${d.meetingDate ? `, ${dayLabel(d.meetingDate)}` : ""}`;
    return (
      <>
        From a motion carried at the <Link href={`/strata/${corpId}/meetings/${d.meetingId}`}>{label}</Link>
      </>
    );
  }
  if (d.source === "discussion") {
    return d.discussionId && seesDiscussions ? (
      <>
        From the Discussion <Link href={`/strata/${corpId}/discussions/${d.discussionId}`}>{d.discussionTitle ?? "council supported"}</Link>
      </>
    ) : (
      <>From a Discussion council supported</>
    );
  }
  if (d.source === "meeting") return <>From a motion carried at a meeting</>;
  return <>Added by {d.createdByName || "someone who runs meetings"}</>;
}

const STATUS_LABELS = { open: "Open", done: "Done", cancelled: "Cancelled" } as const;

function DirectiveRow(props: {
  d: Directive;
  corpId: string;
  open: boolean;
  onToggle: () => void;
  history: DirectiveChange[];
  canEdit: boolean;
  canClose: boolean;
  seesDiscussions: boolean;
  assignable: Assignable[];
  suggest: boolean;
  today: string;
}) {
  const { d } = props;
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [closing, setClosing] = useState<null | "done" | "cancelled">(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const overdue = isOverdue(d, props.today);

  const change = (status: "open" | "done" | "cancelled", withNote?: string) =>
    start(async () => {
      setError(null);
      const res = await setDirectiveStatus(props.corpId, d.id, status, withNote);
      if (!res.ok) return setError(res.error);
      setClosing(null);
      setNote("");
      router.refresh();
    });

  return (
    <li className="directive-card" data-status={d.status} data-overdue={overdue || undefined} data-testid={`directive-${d.id}`}>
      <button type="button" className="directive-card__head" aria-expanded={props.open} onClick={props.onToggle} data-testid={`directive-toggle-${d.id}`}>
        <span className="directive-card__title">{d.title}</span>
        <span className="directive-card__meta">
          <span>{assigneeLabel(d)}</span>
          {d.dueDate && (
            <span data-tone={overdue ? "bad" : undefined} data-testid={`directive-due-${d.id}`}>
              {overdue ? "Overdue: " : "Due "}
              {dayLabel(d.dueDate)}
            </span>
          )}
          <span className="meeting-status directive-status" data-tone={d.status}>
            {STATUS_LABELS[d.status]}
          </span>
        </span>
      </button>

      {props.open && (
        <div className="directive-card__body">
          {editing ? (
            <DirectiveForm
              corpId={props.corpId}
              assignable={props.assignable}
              suggest={props.suggest}
              directive={d}
              onDone={() => setEditing(false)}
            />
          ) : (
            <>
              {d.detail && <p className="directive-card__detail">{d.detail}</p>}
              <p className="card__meta">{sourceLine(d, props.seesDiscussions, props.corpId)}.</p>
              {d.sourceText && (
                <blockquote className="directive-card__motion" data-testid={`directive-motion-${d.id}`}>
                  {d.sourceText}
                </blockquote>
              )}
              {d.status !== "open" && (
                <p className="card__meta">
                  {d.status === "done" ? "Marked done" : "Cancelled"}
                  {d.closedByName ? ` by ${d.closedByName}` : ""}
                  {d.closedAt ? ` on ${when(d.closedAt)}` : ""}.{d.closeNote ? ` ${d.closeNote}` : ""}
                </p>
              )}

              {closing ? (
                <div className="directive-card__close">
                  <label className="field field--wide">
                    <span>{closing === "done" ? "What was done (optional)" : "Why it's cancelled (optional)"}</span>
                    <textarea rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} data-testid={`directive-note-${d.id}`} />
                  </label>
                  <div className="role-editor__actions">
                    <button type="button" className="button button-secondary" onClick={() => setClosing(null)} disabled={pending}>
                      Back
                    </button>
                    <button type="button" className="button button-primary" onClick={() => change(closing, note)} disabled={pending} data-testid={`directive-confirm-${d.id}`}>
                      {pending ? "Saving…" : closing === "done" ? "Mark done" : "Cancel the directive"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="directive-card__actions">
                  {d.status === "open" && props.canClose && (
                    <button type="button" className="button button-primary button-small" onClick={() => setClosing("done")} data-testid={`directive-done-${d.id}`}>
                      Mark done
                    </button>
                  )}
                  {props.canEdit && (
                    <button type="button" className="button button-secondary button-small" onClick={() => setEditing(true)} data-testid={`directive-edit-${d.id}`}>
                      Edit
                    </button>
                  )}
                  {d.status === "open" && props.canEdit && (
                    <button type="button" className="button button-secondary button-small" onClick={() => setClosing("cancelled")} data-testid={`directive-cancel-${d.id}`}>
                      Cancel
                    </button>
                  )}
                  {d.status !== "open" && props.canEdit && (
                    <button type="button" className="button button-secondary button-small" onClick={() => change("open")} disabled={pending} data-testid={`directive-reopen-${d.id}`}>
                      Reopen
                    </button>
                  )}
                </div>
              )}
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}

              {props.history.length > 0 && (
                <details className="directive-card__history">
                  <summary>History</summary>
                  <ul>
                    {props.history.map((c, i) => (
                      <li key={i}>
                        {when(c.at)}: {historyLine(c, d)}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </div>
      )}
    </li>
  );
}

function historyLine(c: DirectiveChange, d: Directive): string {
  const by = c.byName ? ` by ${c.byName}` : "";
  switch (c.kind) {
    case "created":
      return c.byName ? `Added${by}` : d.source === "manual" ? "Added" : d.draftedBy === "ai" ? "Written by Stratasphere from the motion" : "Written from the motion";
    case "edited": {
      const parts = Object.keys(c.detail)
        .map((k) => ({ title: "the task", detail: "the detail", assignee: "who it's assigned to", due_date: "the due date" })[k])
        .filter(Boolean);
      return `Changed ${parts.length ? parts.join(", ") : "it"}${by}`;
    }
    case "done":
      return `Marked done${by}${typeof c.detail.note === "string" ? `: ${c.detail.note}` : ""}`;
    case "cancelled":
      return `Cancelled${by}${typeof c.detail.note === "string" ? `: ${c.detail.note}` : ""}`;
    case "reopened":
      return `Reopened${by}`;
  }
}

function DirectiveForm(props: { corpId: string; assignable: Assignable[]; suggest: boolean; directive?: Directive; onDone: () => void }) {
  const router = useRouter();
  const d = props.directive;
  const [fields, setFields] = useState<DirectiveInput>({
    title: d?.title ?? "",
    detail: d?.detail ?? "",
    assigneeKind: d?.assigneeKind ?? "none",
    assigneeUserId: d?.assigneeUserId ?? null,
    dueDate: d?.dueDate ?? null,
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [suggesting, setSuggesting] = useState(false);
  // The person it's assigned to now, even if they no longer appear in the list.
  const people = useMemo(() => {
    const list = [...props.assignable];
    if (d?.assigneeKind === "person" && d.assigneeUserId && !list.some((p) => p.userId === d.assigneeUserId)) {
      list.push({ userId: d.assigneeUserId, name: d.assigneeName });
    }
    return list;
  }, [props.assignable, d]);
  const assigneeValue = fields.assigneeKind === "person" ? `person:${fields.assigneeUserId}` : fields.assigneeKind;

  async function suggest() {
    setSuggesting(true);
    setError(null);
    const res = await suggestWording(props.corpId, { title: fields.title, detail: fields.detail }).catch(() => ({
      ok: false as const,
      error: "Couldn't suggest wording. Try again, or edit it by hand.",
    }));
    setSuggesting(false);
    if (isDemoLimit(res)) return showDemoLimit("directive wording");
    if (!res.ok) return setError(res.error);
    setFields((f) => ({ ...f, title: res.title, detail: res.detail || f.detail }));
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = d ? await editDirective(props.corpId, d.id, fields) : await addDirective(props.corpId, fields);
      if (!res.ok) return setError(res.error);
      props.onDone();
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} data-testid="directive-form">
      <div className="field-grid">
        <label className="field field--wide">
          <span>What needs to be done</span>
          <textarea
            rows={2}
            maxLength={300}
            required
            value={fields.title}
            onChange={(e) => setFields({ ...fields, title: e.target.value })}
            placeholder="Get three quotes for the roof membrane replacement"
            data-testid="directive-title"
          />
          {props.suggest && (
            <span className="field__hint item-editor__motion-tools">
              Stratasphere can tidy the wording so it says exactly what to do, by whom, and by when.
              <button
                type="button"
                className="button button-secondary button-small"
                onClick={() => void suggest()}
                disabled={suggesting || pending || !fields.title.trim()}
                data-testid="directive-suggest"
              >
                {suggesting ? "Suggesting…" : "Suggest wording"}
              </button>
            </span>
          )}
        </label>
        <label className="field field--wide">
          <span>Detail (optional)</span>
          <textarea rows={3} maxLength={4000} value={fields.detail} onChange={(e) => setFields({ ...fields, detail: e.target.value })} data-testid="directive-detail" />
        </label>
        <label className="field">
          <span>Assigned to</span>
          <select
            value={assigneeValue}
            onChange={(e) => {
              const v = e.target.value;
              if (v.startsWith("person:")) setFields({ ...fields, assigneeKind: "person", assigneeUserId: v.slice(7) });
              else setFields({ ...fields, assigneeKind: v as "none" | "manager", assigneeUserId: null });
            }}
            data-testid="directive-assignee"
          >
            <option value="none">Not assigned yet</option>
            <option value="manager">The manager</option>
            {people.map((p) => (
              <option key={p.userId} value={`person:${p.userId}`}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Due (optional)</span>
          <input type="date" value={fields.dueDate ?? ""} onChange={(e) => setFields({ ...fields, dueDate: e.target.value || null })} data-testid="directive-due" />
        </label>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="role-editor__actions">
        <button type="button" className="button button-secondary" onClick={props.onDone} disabled={pending}>
          Cancel
        </button>
        <button type="submit" className="button button-primary" disabled={pending} data-testid="directive-save">
          {pending ? "Saving…" : d ? "Save changes" : "Add the directive"}
        </button>
      </div>
    </form>
  );
}
