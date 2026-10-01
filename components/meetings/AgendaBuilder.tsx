"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  agendaFromTemplate,
  autoPopulate,
  ensureBookends,
  groupByCategory,
  makeItem,
  newCategoryId,
  renumber,
  resolutionTypeShort,
  type AgendaItem,
  type MeetingType,
} from "@/lib/meetings/agenda";
import { parseUploadedAgenda, saveAgenda, saveItemNote } from "@/app/strata/[corpId]/meetings/actions";
import { ItemEditor } from "@/components/meetings/ItemEditor";
import { LaunchMeetingButton } from "@/components/meetings/MeetingActions";

/**
 * The agenda builder (doc01 §4): start from the meeting type's template,
 * empty, or an uploaded agenda; then categories and items, each with an
 * editor. Changes are local until "Save agenda" — leaving with unsaved
 * changes asks first.
 */
export function AgendaBuilder({
  corpId,
  meetingId,
  meetingType,
  initialAgenda,
  initialUpdatedAt,
  initialNotes,
  aiAvailable,
  launch,
}: {
  corpId: string;
  meetingId: string;
  meetingType: MeetingType;
  initialAgenda: AgendaItem[];
  initialUpdatedAt: string;
  initialNotes: Record<string, string>;
  aiAvailable: boolean;
  /** Present when the viewer may launch this meeting. */
  launch?: { subscribed: boolean; trialAvailable: boolean; isAdmin: boolean };
}) {
  const router = useRouter();
  const [agenda, setAgenda] = useState<AgendaItem[]>(initialAgenda);
  const [notes, setNotes] = useState(initialNotes);
  const [updatedAt, setUpdatedAt] = useState(initialUpdatedAt);
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState<AgendaItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const uploadRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const update = useCallback((next: AgendaItem[]) => {
    setAgenda(renumber(next));
    setDirty(true);
    setStatus(null);
  }, []);

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await saveAgenda(corpId, meetingId, agenda, updatedAt);
      if (!result.ok) return setError(result.error);
      setUpdatedAt(result.updatedAt);
      setDirty(false);
      setStatus("Agenda saved.");
      router.refresh();
    });
  }

  async function upload(file: File | undefined) {
    if (!file) return;
    setError(null);
    setStatus("Reading the agenda…");
    const form = new FormData();
    form.set("file", file);
    const result = await parseUploadedAgenda(corpId, form);
    setStatus(null);
    if (!result.ok) return setError(result.error);
    update(result.agenda);
    setStatus(`Read ${result.agenda.length} items. Check them over, then save.`);
  }

  const cats = groupByCategory(agenda);
  const categoryNames = [...new Set(agenda.map((i) => i.cat).filter(Boolean))];

  function moveItem(id: string, delta: -1 | 1) {
    const idx = agenda.findIndex((i) => i.id === id);
    const target = idx + delta;
    if (idx < 0 || target < 0 || target >= agenda.length) return;
    const next = [...agenda];
    const [item] = next.splice(idx, 1);
    // Moving past the edge of its category joins the neighbouring one.
    const neighbour = next[Math.min(Math.max(target, 0), next.length - 1)];
    next.splice(target, 0, neighbour && neighbour.catId !== item.catId ? { ...item, catId: neighbour.catId, cat: neighbour.cat } : item);
    update(next);
  }

  function moveCategory(catId: string, delta: -1 | 1) {
    const order = cats.map((c) => c.id);
    const idx = order.indexOf(catId);
    const target = idx + delta;
    if (target < 0 || target >= order.length) return;
    [order[idx], order[target]] = [order[target], order[idx]];
    update(order.flatMap((id) => agenda.filter((i) => i.catId === id)));
  }

  function renameCategory(catId: string, name: string) {
    update(agenda.map((i) => (i.catId === catId ? { ...i, cat: name } : i)));
  }

  function deleteCategory(catId: string) {
    const count = agenda.filter((i) => i.catId === catId).length;
    if (count > 0 && !window.confirm(`Delete this category and its ${count} item${count === 1 ? "" : "s"}?`)) return;
    update(agenda.filter((i) => i.catId !== catId));
  }

  function addCategory() {
    const item = makeItem("New item", "New category", { catId: newCategoryId() });
    // Before Adjournment, which always stays last.
    const adjIdx = agenda.findIndex((i) => i.text.toLowerCase().includes("adjourn"));
    const next = [...agenda];
    next.splice(adjIdx < 0 ? next.length : adjIdx, 0, item);
    update(next);
    setEditing(item);
  }

  function addItem(catId: string, text: string) {
    const cat = agenda.find((i) => i.catId === catId)?.cat ?? "";
    const lastIdx = agenda.map((i) => i.catId).lastIndexOf(catId);
    const item = autoPopulate(makeItem(text || "New item", cat, { catId }));
    const next = [...agenda];
    next.splice(lastIdx + 1, 0, item);
    update(next);
    if (!text) setEditing(item);
  }

  function deleteItem(id: string) {
    update(agenda.filter((i) => i.id !== id));
  }

  function saveItem(item: AgendaItem, note: string) {
    const previousCat = agenda.find((i) => i.id === item.id)?.cat;
    let next = agenda.map((i) => (i.id === item.id ? item : i));
    // A new category name typed into the editor moves the item into that
    // category (or a new one).
    if (item.cat !== previousCat) {
      const existing = agenda.find((i) => i.cat === item.cat && i.id !== item.id);
      const catId = existing?.catId ?? newCategoryId();
      next = next.filter((i) => i.id !== item.id);
      const moved = { ...item, catId };
      const lastIdx = next.map((i) => i.catId).lastIndexOf(catId);
      next.splice(lastIdx < 0 ? next.length - 1 : lastIdx + 1, 0, moved);
    }
    update(next);
    setEditing(null);
    if ((notes[item.id] ?? "") !== note) {
      setNotes((n) => ({ ...n, [item.id]: note }));
      void saveItemNote(corpId, meetingId, item.id, note).then((r) => {
        if (!r.ok) setError(r.error);
      });
    }
  }

  if (agenda.length === 0) {
    return (
      <section className="card agenda-start" data-testid="agenda-start">
        <h3>Build the agenda</h3>
        <p>Start from the standard order of business for this type of meeting, from scratch, or from an agenda you already have.</p>
        <div className="agenda-start__options">
          <button type="button" className="button button-primary" onClick={() => update(agendaFromTemplate(meetingType))} data-testid="agenda-from-template">
            Use the template
          </button>
          <button type="button" className="button button-secondary" onClick={() => update(ensureBookends([]))} data-testid="agenda-empty">
            Start empty
          </button>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => uploadRef.current?.click()}
            disabled={!aiAvailable}
            title={aiAvailable ? undefined : "Reading an uploaded agenda needs a Stratasphere subscription."}
            data-testid="agenda-upload"
          >
            Upload an agenda
          </button>
          <input
            ref={uploadRef}
            type="file"
            accept=".pdf,.docx,.txt"
            className="visually-hidden"
            onChange={(e) => {
              void upload(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>
        {aiAvailable && (
          <p className="field__hint">
            An uploaded agenda is read by Stratasphere&trade;. Names and contact details are replaced with placeholders before it&rsquo;s sent, and put back after.
          </p>
        )}
        {status && <p className="card__meta" role="status">{status}</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
      </section>
    );
  }

  return (
    <section className="agenda-builder" data-testid="agenda-builder">
      <div className="agenda-builder__bar">
        <button type="button" className="button button-secondary button-small" onClick={addCategory} data-testid="agenda-add-category">
          Add category
        </button>
        <span className="agenda-builder__state" role="status">
          {pending ? "Saving…" : dirty ? "Unsaved changes" : status}
        </span>
        <button type="button" className="button button-secondary" onClick={save} disabled={pending || !dirty} data-testid="agenda-save">
          Save agenda
        </button>
        {launch && (
          <LaunchMeetingButton corpId={corpId} meetingId={meetingId} agendaSaved={!dirty && !pending} {...launch} />
        )}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}

      {cats.map((cat, ci) => (
        <div className="agenda-cat" key={cat.id} data-testid={`agenda-cat-${ci}`}>
          <div className="agenda-cat__head">
            <input
              className="agenda-cat__name"
              value={cat.name}
              onChange={(e) => renameCategory(cat.id, e.target.value)}
              aria-label="Category name"
              maxLength={120}
            />
            <div className="agenda-row__tools">
              <button type="button" className="icon-button" onClick={() => moveCategory(cat.id, -1)} disabled={ci === 0} aria-label={`Move ${cat.name} up`}>
                <Arrow up />
              </button>
              <button type="button" className="icon-button" onClick={() => moveCategory(cat.id, 1)} disabled={ci === cats.length - 1} aria-label={`Move ${cat.name} down`}>
                <Arrow />
              </button>
              <button type="button" className="link-button agenda-danger" onClick={() => deleteCategory(cat.id)}>
                Delete
              </button>
            </div>
          </div>
          <ol className="agenda-items">
            {cat.items.map((it) => {
              const idx = agenda.findIndex((a) => a.id === it.id);
              return (
                <li className="agenda-item" key={it.id} data-testid={`agenda-item-${it.num}`}>
                  <span className="agenda-item__num">{it.num}.</span>
                  <button type="button" className="agenda-item__title" onClick={() => setEditing(it)}>
                    {it.text}
                    {(it.background || it.financial || it.risks || it.motion?.text) && <span className="visually-hidden"> (has details)</span>}
                  </button>
                  {it.atts.length > 0 && <span className="card__meta">{it.atts.length} attached</span>}
                  {notes[it.id] && <span className="card__meta">Note</span>}
                  <span className={`rtag rtag--${it.type.toLowerCase()}`}>{resolutionTypeShort[it.type]}</span>
                  <div className="agenda-row__tools">
                    <button type="button" className="icon-button" onClick={() => moveItem(it.id, -1)} disabled={idx === 0} aria-label={`Move ${it.text} up`}>
                      <Arrow up />
                    </button>
                    <button type="button" className="icon-button" onClick={() => moveItem(it.id, 1)} disabled={idx === agenda.length - 1} aria-label={`Move ${it.text} down`}>
                      <Arrow />
                    </button>
                    <button type="button" className="link-button" onClick={() => setEditing(it)}>
                      Edit
                    </button>
                    <button type="button" className="link-button agenda-danger" onClick={() => deleteItem(it.id)} aria-label={`Delete ${it.text}`}>
                      Delete
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
          <QuickAdd onAdd={(text) => addItem(cat.id, text)} />
        </div>
      ))}

      {editing && (
        <ItemEditor
          corpId={corpId}
          meetingId={meetingId}
          item={editing}
          note={notes[editing.id] ?? ""}
          categories={categoryNames}
          onSave={saveItem}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}

function QuickAdd({ onAdd }: { onAdd: (text: string) => void }) {
  const [text, setText] = useState("");
  return (
    <form
      className="agenda-quick-add"
      onSubmit={(e) => {
        e.preventDefault();
        onAdd(text.trim());
        setText("");
      }}
    >
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add an item…" aria-label="New item title" maxLength={300} />
      <button type="submit" className="button button-secondary button-small">
        Add
      </button>
    </form>
  );
}

export function Arrow({ up = false }: { up?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {up ? <path d="M6 15l6-6 6 6" /> : <path d="M6 9l6 6 6-6" />}
    </svg>
  );
}
