"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  blockCatalog,
  cloneBlock,
  newBlock,
  newId,
  publishProblems,
  type Block,
  type BlockType,
  type Lesson,
  type ModuleContent,
} from "@/lib/training/content";
import { markReadyForReview, publishModule, saveModuleDraft } from "@/app/admin/training/actions";
import { BlockEditor } from "@/components/training/BlockEditor";
import { LessonView } from "@/components/training/LessonView";
import { Modal } from "@/components/Modal";

export interface BuilderModule {
  id: string;
  title: string;
  trackTitle: string;
  publishedVersion: number;
  publishedAt: string | null;
  draftUpdatedAt: string | null;
  readyForReviewAt: string | null;
}

/**
 * The Module Builder (modelled on Articulate Rise): lessons down the side,
 * a lesson's blocks in the middle, each block edited in place, with a
 * learner preview at desktop or phone width. Everything autosaves to the
 * draft; learners only see a version once it's published.
 */
export function ModuleBuilder({
  module,
  initialContent,
  canPublish,
  backHref,
}: {
  module: BuilderModule;
  initialContent: ModuleContent;
  /** Super Admin: publish. Author: mark ready for review. */
  canPublish: boolean;
  backHref: string;
}) {
  const router = useRouter();
  const [content, setContent] = useState<ModuleContent>(initialContent);
  const [lessonId, setLessonId] = useState<string | null>(initialContent.lessons[0]?.id ?? null);
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [device, setDevice] = useState<"desktop" | "phone">("desktop");
  const [save, setSave] = useState<{ state: "saved" | "saving" | "error"; at: string | null; error?: string }>({
    state: "saved",
    at: module.draftUpdatedAt,
  });
  const [publishing, setPublishing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [readyAt, setReadyAt] = useState(module.readyForReviewAt);

  // ── Autosave ──
  const first = useRef(true);
  const latest = useRef(content);
  latest.current = content;
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setSave((s) => ({ ...s, state: "saving" }));
    const t = setTimeout(async () => {
      const r = await saveModuleDraft(module.id, latest.current).catch(() => ({ ok: false as const, error: "Couldn't save. Check your connection." }));
      setSave(r.ok ? { state: "saved", at: r.savedAt } : { state: "error", at: null, error: r.error });
    }, 800);
    return () => clearTimeout(t);
  }, [content, module.id]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (save.state !== "saved") e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [save.state]);

  const lesson = content.lessons.find((l) => l.id === lessonId) ?? null;
  const lessonIndex = content.lessons.findIndex((l) => l.id === lessonId);

  const updateLesson = useCallback((id: string, fn: (l: Lesson) => Lesson) => {
    setContent((c) => ({ lessons: c.lessons.map((l) => (l.id === id ? fn(l) : l)) }));
  }, []);
  const setBlocks = (fn: (b: Block[]) => Block[]) => lesson && updateLesson(lesson.id, (l) => ({ ...l, blocks: fn(l.blocks) }));

  function addLesson() {
    const l: Lesson = { id: newId("l"), title: `Lesson ${content.lessons.length + 1}`, blocks: [newBlock("text")] };
    setContent((c) => ({ lessons: [...c.lessons, l] }));
    setLessonId(l.id);
    setMode("edit");
  }
  function moveLesson(i: number, d: -1 | 1) {
    setContent((c) => {
      const j = i + d;
      if (j < 0 || j >= c.lessons.length) return c;
      const lessons = [...c.lessons];
      [lessons[i], lessons[j]] = [lessons[j], lessons[i]];
      return { lessons };
    });
  }
  const [confirmDelete, setConfirmDelete] = useState<Lesson | null>(null);
  function deleteLesson(l: Lesson) {
    setContent((c) => {
      const lessons = c.lessons.filter((x) => x.id !== l.id);
      if (lessonId === l.id) setLessonId(lessons[0]?.id ?? null);
      return { lessons };
    });
    setConfirmDelete(null);
  }

  function insertBlock(at: number, type: BlockType) {
    setBlocks((b) => [...b.slice(0, at), newBlock(type), ...b.slice(at)]);
  }
  function moveBlock(i: number, d: -1 | 1) {
    setBlocks((b) => {
      const j = i + d;
      if (j < 0 || j >= b.length) return b;
      const out = [...b];
      [out[i], out[j]] = [out[j], out[i]];
      return out;
    });
  }

  const problems = publishProblems(content);
  const [showPublish, setShowPublish] = useState(false);
  async function publish() {
    setPublishing(true);
    const r = await publishModule(module.id);
    setPublishing(false);
    setShowPublish(false);
    if (!r.ok) return setNotice(r.error);
    setNotice(`Published as version ${r.version}. Learners see it now.`);
    router.refresh();
  }
  async function toggleReady() {
    const next = !readyAt;
    const r = await markReadyForReview(module.id, next);
    if (!r.ok) return setNotice(r.error);
    setReadyAt(next ? new Date().toISOString() : null);
    setNotice(next ? "Marked ready for review. A Super Admin will publish it." : "No longer marked ready for review.");
  }

  const savedLabel =
    save.state === "saving"
      ? "Saving…"
      : save.state === "error"
        ? "Not saved"
        : save.at
          ? `Draft saved ${new Date(save.at).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" })}`
          : "Draft";

  return (
    <div className="builder">
      <header className="builder__top">
        <div className="builder__title">
          <Link href={backHref} className="card__meta">
            &larr; {module.trackTitle}
          </Link>
          <strong>{module.title}</strong>
        </div>
        <span className="builder__status" data-state={save.state} role="status">
          {savedLabel}
        </span>
        <span className="pill">{module.publishedVersion ? `Published v${module.publishedVersion}` : "Not published"}</span>
        <div className="builder__mode" role="group" aria-label="Mode">
          <button type="button" data-active={mode === "edit"} onClick={() => setMode("edit")}>
            Edit
          </button>
          <button type="button" data-active={mode === "preview"} onClick={() => setMode("preview")}>
            Preview
          </button>
        </div>
        {canPublish ? (
          <button type="button" className="button button-primary button-small" onClick={() => setShowPublish(true)} data-testid="builder-publish">
            Publish
          </button>
        ) : (
          <button type="button" className={`button ${readyAt ? "button-secondary" : "button-primary"} button-small`} onClick={toggleReady}>
            {readyAt ? "Ready for review ✓" : "Mark ready for review"}
          </button>
        )}
      </header>
      {save.state === "error" && <p className="builder__alert" role="alert">{save.error}</p>}
      {notice && (
        <p className="builder__notice" role="status">
          {notice}{" "}
          <button type="button" className="text-action" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </p>
      )}

      <div className="builder__body">
        <nav className="builder__lessons" aria-label="Lessons">
          <div className="builder__lessons-head">Lessons</div>
          <ol>
            {content.lessons.map((l, i) => (
              <li key={l.id} data-active={l.id === lessonId}>
                <button type="button" className="builder__lesson" onClick={() => setLessonId(l.id)}>
                  <span className="builder__lesson-num">{i + 1}</span>
                  <span>{l.title}</span>
                </button>
                <span className="be-tools">
                  <button type="button" className="be-icon" onClick={() => moveLesson(i, -1)} disabled={i === 0} aria-label={`Move ${l.title} up`}>
                    &uarr;
                  </button>
                  <button type="button" className="be-icon" onClick={() => moveLesson(i, 1)} disabled={i === content.lessons.length - 1} aria-label={`Move ${l.title} down`}>
                    &darr;
                  </button>
                  <button type="button" className="be-icon be-icon--danger" onClick={() => setConfirmDelete(l)} aria-label={`Delete ${l.title}`}>
                    &times;
                  </button>
                </span>
              </li>
            ))}
          </ol>
          <button type="button" className="button button-secondary button-small builder__add-lesson" onClick={addLesson} data-testid="builder-add-lesson">
            + Add lesson
          </button>
        </nav>

        <main className="builder__main">
          {!lesson ? (
            <div className="builder__empty">
              <h2>Start with a lesson</h2>
              <p className="card__meta">A module is a few short lessons. Each lesson is a stack of blocks: text, images, video, questions and scenarios.</p>
              <button type="button" className="button button-primary" onClick={addLesson}>
                Add the first lesson
              </button>
            </div>
          ) : mode === "preview" ? (
            <div className="builder__preview">
              <div className="builder__devices" role="group" aria-label="Preview width">
                <button type="button" data-active={device === "desktop"} onClick={() => setDevice("desktop")}>
                  Desktop
                </button>
                <button type="button" data-active={device === "phone"} onClick={() => setDevice("phone")}>
                  Phone
                </button>
              </div>
              <div className="builder__frame" data-device={device}>
                <LessonView key={lesson.id + JSON.stringify(lesson).length} lesson={lesson} />
                <div className="lesson-nav">
                  <button type="button" className="text-action" disabled={lessonIndex <= 0} onClick={() => setLessonId(content.lessons[lessonIndex - 1].id)}>
                    &larr; Previous lesson
                  </button>
                  <button
                    type="button"
                    className="button button-primary button-small"
                    disabled={lessonIndex >= content.lessons.length - 1}
                    onClick={() => setLessonId(content.lessons[lessonIndex + 1].id)}
                  >
                    Continue
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="builder__canvas">
              <input
                className="builder__lesson-title"
                value={lesson.title}
                maxLength={200}
                aria-label="Lesson title"
                onChange={(e) => updateLesson(lesson.id, (l) => ({ ...l, title: e.target.value }))}
              />
              <Inserter onPick={(t) => insertBlock(0, t)} />
              {lesson.blocks.map((b, i) => {
                const meta = blockCatalog.find((c) => c.type === b.type);
                return (
                  <div key={b.id}>
                    <section className="builder__block" aria-label={`${meta?.label} block`}>
                      <div className="builder__block-head">
                        <span className="builder__block-type">{meta?.label}</span>
                        <span className="be-tools">
                          <button type="button" className="be-icon" onClick={() => moveBlock(i, -1)} disabled={i === 0} aria-label="Move block up" title="Move up">
                            &uarr;
                          </button>
                          <button type="button" className="be-icon" onClick={() => moveBlock(i, 1)} disabled={i === lesson.blocks.length - 1} aria-label="Move block down" title="Move down">
                            &darr;
                          </button>
                          <button
                            type="button"
                            className="be-icon"
                            onClick={() => setBlocks((bs) => [...bs.slice(0, i + 1), cloneBlock(b), ...bs.slice(i + 1)])}
                            aria-label="Duplicate block"
                            title="Duplicate"
                          >
                            &#x2398;
                          </button>
                          <button
                            type="button"
                            className="be-icon be-icon--danger"
                            onClick={() => setBlocks((bs) => bs.filter((x) => x.id !== b.id))}
                            aria-label="Delete block"
                            title="Delete"
                          >
                            &times;
                          </button>
                        </span>
                      </div>
                      <BlockEditor
                        moduleId={module.id}
                        block={b}
                        onChange={(nb) => setBlocks((bs) => bs.map((x) => (x.id === b.id ? nb : x)))}
                      />
                    </section>
                    <Inserter onPick={(t) => insertBlock(i + 1, t)} />
                  </div>
                );
              })}
            </div>
          )}
        </main>
      </div>

      {confirmDelete && (
        <Modal title={`Delete "${confirmDelete.title}"?`} onClose={() => setConfirmDelete(null)}>
          <p>The lesson and its {confirmDelete.blocks.length} blocks are removed from the draft. Published versions aren&rsquo;t affected until you publish again.</p>
          <div className="role-editor__actions">
            <button type="button" className="button button-secondary" onClick={() => setConfirmDelete(null)}>
              Cancel
            </button>
            <button type="button" className="button button-danger" onClick={() => deleteLesson(confirmDelete)}>
              Delete lesson
            </button>
          </div>
        </Modal>
      )}

      {showPublish && (
        <Modal title={problems.length ? "Not ready to publish" : `Publish version ${module.publishedVersion + 1}?`} onClose={() => setShowPublish(false)}>
          {problems.length ? (
            <ul className="builder__problems">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : (
            <p>
              Learners will see this version right away. Anyone partway through the current version keeps their completed
              lessons only if they finish it; earned credentials are never taken back.
            </p>
          )}
          <div className="role-editor__actions">
            <button type="button" className="button button-secondary" onClick={() => setShowPublish(false)}>
              {problems.length ? "Back to editing" : "Cancel"}
            </button>
            {!problems.length && (
              <button type="button" className="button button-primary" onClick={publish} disabled={publishing || save.state !== "saved"} data-testid="builder-publish-confirm">
                {publishing ? "Publishing…" : save.state !== "saved" ? "Saving…" : "Publish"}
              </button>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

/** The "+" between blocks that opens the block menu. */
function Inserter({ onPick }: { onPick: (t: BlockType) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="builder__insert" data-open={open}>
      <button type="button" className="builder__insert-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Add a block here">
        +
      </button>
      {open && (
        <div className="builder__menu" role="menu">
          {blockCatalog.map((c) => (
            <button
              key={c.type}
              type="button"
              role="menuitem"
              className="builder__menu-item"
              onClick={() => {
                onPick(c.type);
                setOpen(false);
              }}
            >
              <strong>{c.label}</strong>
              <span>{c.description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
