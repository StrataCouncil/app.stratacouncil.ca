"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  blockCatalog,
  cloneBlock,
  flattenScreens,
  newBlock,
  newScreen,
  newSection,
  publishProblems,
  type Block,
  type BlockType,
  type ModuleContent,
  type Screen,
  type ScreenLayout,
  type Section,
} from "@/lib/training/content";
import { markReadyForReview, publishModule, saveModuleDraft } from "@/app/admin/training/actions";
import { BlockEditor, ItemTools, MediaField, move } from "@/components/training/BlockEditor";
import { ModulePlayer } from "@/components/training/ModulePlayer";
import { Modal } from "@/components/Modal";

export interface BuilderModule {
  id: string;
  title: string;
  trackTitle: string;
  publishedVersion: number;
  publishedAt: string | null;
  draftUpdatedAt: string | null;
  readyForReviewAt: string | null;
  /** Set when the AI module builder wrote the first draft (the source document's title). */
  aiDraftedFrom?: string | null;
}

type Selection = { kind: "settings" } | { kind: "screen"; screenId: string };

/**
 * The Module Builder. A module is sections (the learner's menu), each a
 * run of screens shown one at a time; a screen is a stack of blocks, full
 * width or beside a picture, with optional narration. The left side is the
 * outline, the middle edits the selected screen, and Preview runs the
 * real player at desktop or phone width. Everything autosaves to the
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
  const firstScreen = flattenScreens(initialContent)[0]?.screen.id;
  const [selected, setSelected] = useState<Selection>(firstScreen ? { kind: "screen", screenId: firstScreen } : { kind: "settings" });
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

  // ── Outline edits ──
  const located = selected.kind === "screen" ? flattenScreens(content).find((f) => f.screen.id === selected.screenId) : undefined;
  const screen = located?.screen ?? null;
  const section = located?.section ?? null;

  const setSections = (fn: (s: Section[]) => Section[]) => setContent((c) => ({ ...c, sections: fn(c.sections) }));
  const updateSection = (id: string, fn: (s: Section) => Section) => setSections((ss) => ss.map((s) => (s.id === id ? fn(s) : s)));
  const updateScreen = (id: string, fn: (s: Screen) => Screen) =>
    setSections((ss) => ss.map((sec) => ({ ...sec, screens: sec.screens.map((s) => (s.id === id ? fn(s) : s)) })));
  const setBlocks = (fn: (b: Block[]) => Block[]) => screen && updateScreen(screen.id, (s) => ({ ...s, blocks: fn(s.blocks) }));

  function addSection() {
    const sec = newSection(`Section ${content.sections.length + 1}`);
    setSections((ss) => [...ss, sec]);
    setSelected({ kind: "screen", screenId: sec.screens[0].id });
    setMode("edit");
  }
  function addScreen(sectionId: string) {
    const s = newScreen();
    updateSection(sectionId, (sec) => ({ ...sec, screens: [...sec.screens, s] }));
    setSelected({ kind: "screen", screenId: s.id });
    setMode("edit");
  }
  function moveScreen(sectionId: string, i: number, d: -1 | 1) {
    updateSection(sectionId, (sec) => ({ ...sec, screens: move(sec.screens, i, d) }));
  }
  function duplicateScreen(sectionId: string, s: Screen) {
    const copy: Screen = { ...JSON.parse(JSON.stringify(s)), id: newScreen().id, title: `${s.title} (copy)` };
    copy.blocks = s.blocks.map(cloneBlock);
    updateSection(sectionId, (sec) => {
      const i = sec.screens.findIndex((x) => x.id === s.id);
      return { ...sec, screens: [...sec.screens.slice(0, i + 1), copy, ...sec.screens.slice(i + 1)] };
    });
    setSelected({ kind: "screen", screenId: copy.id });
  }
  const [confirmDelete, setConfirmDelete] = useState<{ kind: "section"; section: Section } | { kind: "screen"; screen: Screen } | null>(null);
  function deleteConfirmed() {
    if (!confirmDelete) return;
    if (confirmDelete.kind === "section") {
      setSections((ss) => ss.filter((s) => s.id !== confirmDelete.section.id));
      if (confirmDelete.section.screens.some((s) => s.id === screen?.id)) setSelected({ kind: "settings" });
    } else {
      setSections((ss) => ss.map((sec) => ({ ...sec, screens: sec.screens.filter((s) => s.id !== confirmDelete.screen.id) })));
      if (screen?.id === confirmDelete.screen.id) setSelected({ kind: "settings" });
    }
    setConfirmDelete(null);
  }

  function insertBlock(at: number, type: BlockType) {
    setBlocks((b) => [...b.slice(0, at), newBlock(type), ...b.slice(at)]);
  }

  // ── Publish / review ──
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
  const screenCount = flattenScreens(content).length;

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
          <button type="button" data-active={mode === "preview"} onClick={() => setMode("preview")} disabled={screenCount === 0}>
            Preview
          </button>
        </div>
        {canPublish ? (
          <button type="button" className="button button-primary button-small" onClick={() => setShowPublish(true)} data-testid="builder-publish">
            Publish
          </button>
        ) : (
          <button type="button" className={`button ${readyAt ? "button-secondary" : "button-primary"} button-small`} onClick={toggleReady}>
            {readyAt ? "Ready for review (undo)" : "Mark ready for review"}
          </button>
        )}
      </header>
      {module.aiDraftedFrom && module.publishedVersion === 0 && (
        <p className="builder__ai-note" role="note">
          <strong>Drafted by AI</strong> from &ldquo;{module.aiDraftedFrom}&rdquo;. Check every fact, number and reference against
          the source before publishing, and record narration from the scripts on each screen.
        </p>
      )}
      {save.state === "error" && (
        <p className="builder__alert" role="alert">
          {save.error}
        </p>
      )}
      {notice && (
        <p className="builder__notice" role="status">
          {notice}{" "}
          <button type="button" className="text-action" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </p>
      )}

      <div className="builder__body">
        <nav className="builder__lessons builder__outline" aria-label="Module outline">
          <button
            type="button"
            className="builder__settings-link"
            data-active={selected.kind === "settings"}
            onClick={() => {
              setSelected({ kind: "settings" });
              setMode("edit");
            }}
          >
            Module settings
            <span className="card__meta">
              {content.objectives.length} {content.objectives.length === 1 ? "objective" : "objectives"}
            </span>
          </button>

          {content.sections.map((sec, si) => (
            <div key={sec.id} className="builder__section">
              <div className="builder__section-head">
                <span className="builder__section-title">
                  <span className="builder__lesson-num">{si + 1}</span>
                  {sec.title}
                </span>
                <span className="be-tools">
                  <button
                    type="button"
                    className="be-icon"
                    onClick={() => setSections((ss) => move(ss, si, -1))}
                    disabled={si === 0}
                    aria-label={`Move section ${sec.title} up`}
                  >
                    &uarr;
                  </button>
                  <button
                    type="button"
                    className="be-icon"
                    onClick={() => setSections((ss) => move(ss, si, 1))}
                    disabled={si === content.sections.length - 1}
                    aria-label={`Move section ${sec.title} down`}
                  >
                    &darr;
                  </button>
                  <button
                    type="button"
                    className="be-icon be-icon--danger"
                    onClick={() => setConfirmDelete({ kind: "section", section: sec })}
                    aria-label={`Delete section ${sec.title}`}
                  >
                    &times;
                  </button>
                </span>
              </div>
              <ol>
                {sec.screens.map((s, i) => (
                  <li key={s.id} data-active={screen?.id === s.id}>
                    <button
                      type="button"
                      className="builder__lesson"
                      onClick={() => {
                        setSelected({ kind: "screen", screenId: s.id });
                      }}
                    >
                      <span className="builder__lesson-num">
                        {si + 1}.{i + 1}
                      </span>
                      <span>{s.title}</span>
                    </button>
                    <ItemTools
                      index={i}
                      count={sec.screens.length}
                      onMove={(d) => moveScreen(sec.id, i, d)}
                      onRemove={() => setConfirmDelete({ kind: "screen", screen: s })}
                    />
                  </li>
                ))}
              </ol>
              <button type="button" className="text-action builder__add-screen" onClick={() => addScreen(sec.id)}>
                + Add screen
              </button>
            </div>
          ))}
          <button type="button" className="button button-secondary button-small builder__add-lesson" onClick={addSection} data-testid="builder-add-section">
            + Add section
          </button>
        </nav>

        <main className="builder__main">
          {mode === "preview" && screenCount > 0 ? (
            <div className="builder__preview">
              <div className="builder__devices" role="group" aria-label="Preview width">
                <button type="button" data-active={device === "desktop"} onClick={() => setDevice("desktop")}>
                  Desktop
                </button>
                <button type="button" data-active={device === "phone"} onClick={() => setDevice("phone")}>
                  Phone
                </button>
              </div>
              <div className="builder__frame builder__frame--player" data-device={device}>
                <ModulePlayer
                  preview
                  moduleId={module.id}
                  moduleTitle={module.title}
                  version={0}
                  content={content}
                  completedSectionIds={[]}
                  track={{ title: module.trackTitle, slug: "" }}
                  nextModule={null}
                  startScreenId={screen?.id}
                />
              </div>
            </div>
          ) : selected.kind === "settings" || !screen || !section ? (
            <ModuleSettings
              content={content}
              onChange={(objectives) => setContent((c) => ({ ...c, objectives }))}
              onAddSection={content.sections.length === 0 ? addSection : undefined}
            />
          ) : (
            <div className="builder__canvas">
              <label className="field builder__section-field">
                <span>Section {content.sections.findIndex((s) => s.id === section.id) + 1} (the learner&rsquo;s menu)</span>
                <input
                  value={section.title}
                  maxLength={200}
                  onChange={(e) => updateSection(section.id, (s) => ({ ...s, title: e.target.value }))}
                />
              </label>
              <div className="builder__screen-head">
                <input
                  className="builder__lesson-title"
                  value={screen.title}
                  maxLength={200}
                  aria-label="Screen title (shown in the title bar)"
                  onChange={(e) => updateScreen(screen.id, (s) => ({ ...s, title: e.target.value }))}
                />
                <button type="button" className="text-action" onClick={() => duplicateScreen(section.id, screen)}>
                  Duplicate screen
                </button>
              </div>

              <ScreenSettings moduleId={module.id} screen={screen} onChange={(s) => updateScreen(screen.id, () => s)} />

              <Inserter onPick={(t) => insertBlock(0, t)} />
              {screen.blocks.map((b, i) => {
                const meta = blockCatalog.find((c) => c.type === b.type);
                return (
                  <div key={b.id}>
                    <section className="builder__block" aria-label={`${meta?.label} block`}>
                      <div className="builder__block-head">
                        <span className="builder__block-type">{meta?.label}</span>
                        <span className="be-tools">
                          <button type="button" className="be-icon" onClick={() => setBlocks((bs) => move(bs, i, -1))} disabled={i === 0} aria-label="Move block up" title="Move up">
                            &uarr;
                          </button>
                          <button
                            type="button"
                            className="be-icon"
                            onClick={() => setBlocks((bs) => move(bs, i, 1))}
                            disabled={i === screen.blocks.length - 1}
                            aria-label="Move block down"
                            title="Move down"
                          >
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
                      <BlockEditor moduleId={module.id} block={b} onChange={(nb) => setBlocks((bs) => bs.map((x) => (x.id === b.id ? nb : x)))} />
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
        <Modal
          title={`Delete "${confirmDelete.kind === "section" ? confirmDelete.section.title : confirmDelete.screen.title}"?`}
          onClose={() => setConfirmDelete(null)}
        >
          <p>
            {confirmDelete.kind === "section"
              ? `The section and its ${confirmDelete.section.screens.length} ${confirmDelete.section.screens.length === 1 ? "screen are" : "screens are"} removed from the draft.`
              : `The screen and its ${confirmDelete.screen.blocks.length} ${confirmDelete.screen.blocks.length === 1 ? "block are" : "blocks are"} removed from the draft.`}{" "}
            Published versions aren&rsquo;t affected until you publish again.
          </p>
          <div className="role-editor__actions">
            <button type="button" className="button button-secondary" onClick={() => setConfirmDelete(null)}>
              Cancel
            </button>
            <button type="button" className="button button-danger" onClick={deleteConfirmed}>
              Delete {confirmDelete.kind}
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
              Learners will see this version right away. Anyone partway through the current version keeps their finished
              sections only if they finish it; earned credentials are never taken back.
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

/** Learning objectives: the player's opening screen lists them, and the closing recap repeats them. */
function ModuleSettings({
  content,
  onChange,
  onAddSection,
}: {
  content: ModuleContent;
  onChange: (objectives: string[]) => void;
  onAddSection?: () => void;
}) {
  const [draft, setDraft] = useState("");
  const objectives = content.objectives;
  return (
    <div className="builder__canvas">
      <h2 className="builder__lesson-title">Module settings</h2>
      <section className="builder__block">
        <div className="builder__block-head">
          <span className="builder__block-type">Learning objectives</span>
        </div>
        <p className="card__meta">
          What a learner can do after this module, e.g. &ldquo;Explain what council can decide without a vote of the
          owners&rdquo;. They open the module on its own screen and come back in the closing recap.
        </p>
        <div className="be-stack">
          {objectives.map((o, i) => (
            <div key={i} className="be-row">
              <input
                className="be-grow"
                value={o}
                maxLength={300}
                aria-label={`Objective ${i + 1}`}
                onChange={(e) => onChange(objectives.map((x, j) => (j === i ? e.target.value : x)))}
              />
              <ItemTools
                index={i}
                count={objectives.length}
                onMove={(d) => onChange(move(objectives, i, d))}
                onRemove={() => onChange(objectives.filter((_, j) => j !== i))}
              />
            </div>
          ))}
          {objectives.length < 12 && (
            <form
              className="be-row"
              onSubmit={(e) => {
                e.preventDefault();
                if (!draft.trim()) return;
                onChange([...objectives, draft.trim()]);
                setDraft("");
              }}
            >
              <input className="be-grow" value={draft} maxLength={300} placeholder="Add an objective" onChange={(e) => setDraft(e.target.value)} />
              <button className="button button-secondary button-small" disabled={!draft.trim()}>
                Add
              </button>
            </form>
          )}
        </div>
      </section>
      {onAddSection && (
        <div className="builder__empty">
          <h2>Then add the first section</h2>
          <p className="card__meta">
            Sections are the learner&rsquo;s menu. Each one is a few screens, shown one at a time: text, pictures, narration,
            questions and scenarios.
          </p>
          <button type="button" className="button button-primary" onClick={onAddSection}>
            Add the first section
          </button>
        </div>
      )}
    </div>
  );
}

const layoutLabels: Record<ScreenLayout, string> = { full: "Full width", split: "Text with a picture beside it" };

/** A screen's layout, side picture and narration. */
function ScreenSettings({ moduleId, screen, onChange }: { moduleId: string; screen: Screen; onChange: (s: Screen) => void }) {
  return (
    <section className="builder__block builder__screen-settings">
      <div className="be-row">
        <label className="field">
          <span>Layout</span>
          <select value={screen.layout} onChange={(e) => onChange({ ...screen, layout: e.target.value as ScreenLayout })}>
            {(Object.keys(layoutLabels) as ScreenLayout[]).map((l) => (
              <option key={l} value={l}>
                {layoutLabels[l]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {screen.layout === "split" && (
        <div className="be-stack">
          <MediaField moduleId={moduleId} kind="image" value={screen.image.src} label="The picture beside the text" onChange={(src) => onChange({ ...screen, image: { ...screen.image, src } })} />
          <label className="field">
            <span>Picture description (alt text)</span>
            <input value={screen.image.alt} maxLength={500} onChange={(e) => onChange({ ...screen, image: { ...screen.image, alt: e.target.value } })} />
          </label>
        </div>
      )}
      <div className="be-stack">
        <MediaField
          moduleId={moduleId}
          kind="audio"
          value={screen.narration.src}
          label={screen.narration.src ? "Narration added. Next waits until it finishes." : "Narration (optional): an MP3 or M4A that plays with this screen"}
          onChange={(src) => onChange({ ...screen, narration: { ...screen.narration, src } })}
          onClear={screen.narration.src ? () => onChange({ ...screen, narration: { src: "", transcript: screen.narration.transcript } }) : undefined}
        />
        {screen.narration.src && <audio src={screen.narration.src} controls preload="metadata" className="be-audio" />}
        <label className="field">
          <span>
            {screen.narration.src
              ? "Captions (the narration as text; learners can turn these on)"
              : "Narration script (record it, then upload the audio above; it becomes the captions)"}
          </span>
          <textarea
            rows={3}
            value={screen.narration.transcript}
            onChange={(e) => onChange({ ...screen, narration: { ...screen.narration, transcript: e.target.value } })}
          />
        </label>
      </div>
    </section>
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
