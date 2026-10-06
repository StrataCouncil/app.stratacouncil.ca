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
  narrationOutOfDate,
  publishProblems,
  newId,
  type Block,
  type BlockType,
  type FurtherReading,
  type ModuleContent,
  type Screen,
  type ScreenLayout,
  type Section,
} from "@/lib/training/content";
import {
  generateNarration,
  getNarrationVoices,
  markReadyForReview,
  getFactCheck,
  markFactIssue,
  publishModule,
  saveModuleDraft,
  startFactCheck,
  tightenScreen,
} from "@/app/admin/training/actions";
import type { FactCheck, FactIssue } from "@/lib/training/library";
import { onScreenWords } from "@/lib/training/ai";
import { PhotoCreditLine, PhotoPicker } from "@/components/training/PhotoPicker";
import type { Voice } from "@/lib/media/elevenlabs";
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
  /** The latest check against the Legislation Library (0037). */
  factCheck?: FactCheck | null;
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
  const [skipWaits, setSkipWaits] = useState(false);
  const [save, setSave] = useState<{ state: "saved" | "saving" | "error"; at: string | null; error?: string }>({
    state: "saved",
    at: module.draftUpdatedAt,
  });
  const [publishing, setPublishing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [readyAt, setReadyAt] = useState(module.readyForReviewAt);

  // ── Fact check (0037): poll while it runs ──
  const [factCheck, setFactCheck] = useState<FactCheck | null>(module.factCheck ?? null);
  const checking = factCheck?.status === "checking";
  useEffect(() => {
    if (!checking) return;
    const t = setInterval(async () => {
      const r = await getFactCheck(module.id).catch(() => null);
      if (r?.ok) setFactCheck(r.check);
    }, 5000);
    return () => clearInterval(t);
  }, [checking, module.id]);
  // Open notes by screen, each with its place in the full list (for "Checked by hand").
  const issuesBy = new Map<string, IndexedIssue[]>();
  if (factCheck && factCheck.status !== "failed")
    factCheck.issues.forEach((issue, index) => {
      if (!issue.checkedByHand) issuesBy.set(issue.screenId, [...(issuesBy.get(issue.screenId) ?? []), { issue, index }]);
    });
  const openIssues = [...issuesBy.values()].reduce((n, list) => n + list.length, 0);
  async function markIssue(index: number, checked: boolean) {
    const r = await markFactIssue(module.id, index, checked);
    if (!r.ok) return setNotice(r.error);
    setFactCheck(r.check);
  }
  const checkOutOfDate = Boolean(factCheck?.status === "done" && factCheck.draftUpdatedAt && save.at && save.at > factCheck.draftUpdatedAt);

  // ── Autosave ──
  const first = useRef(true);
  const latest = useRef(content);
  latest.current = content;
  // An edit waiting for its save (the save waits for a pause in typing).
  const pending = useRef(false);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    pending.current = true;
    setSave((s) => ({ ...s, state: "saving" }));
    const t = setTimeout(async () => {
      pending.current = false;
      const r = await saveModuleDraft(module.id, latest.current).catch(() => ({ ok: false as const, error: "Couldn't save. Check your connection." }));
      setSave(r.ok ? { state: "saved", at: r.savedAt } : { state: "error", at: null, error: r.error });
    }, 800);
    return () => clearTimeout(t);
  }, [content, module.id]);
  // Leaving the builder (its back link, or any other link) mustn't drop an edit still waiting to save.
  useEffect(
    () => () => {
      if (pending.current) void saveModuleDraft(module.id, latest.current).catch(() => undefined);
    },
    [module.id]
  );
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
  const missingAudio = flattenScreens(content).filter((f) => f.screen.narration.transcript.trim() && !f.screen.narration.src).length;
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
          the source before publishing, then add photos and narration (Module settings can voice every screen at once).
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
                      {issuesBy.has(s.id) && (
                        <span className="fact-flag" title={`${issuesBy.get(s.id)!.length} fact check ${issuesBy.get(s.id)!.length === 1 ? "note" : "notes"}`}>
                          {issuesBy.get(s.id)!.length}
                        </span>
                      )}
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
              <label className="be-check builder__skip">
                <input type="checkbox" checked={skipWaits} onChange={(e) => setSkipWaits(e.target.checked)} />
                Let me skip ahead (authors only; learners always wait for narration and activities)
              </label>
              <div className="builder__frame builder__frame--player" data-device={device}>
                <ModulePlayer
                  preview
                  skipWaits={skipWaits}
                  key={skipWaits ? "skip" : "wait"}
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
            <>
              <ModuleSettings
                content={content}
                onChange={(objectives) => setContent((c) => ({ ...c, objectives }))}
                onReading={(furtherReading) => setContent((c) => ({ ...c, furtherReading }))}
                onAddSection={content.sections.length === 0 ? addSection : undefined}
                aiBuildHref={canPublish ? `/admin/training/ai?module=${module.id}` : null}
              />
              <FactCheckPanel
                check={factCheck}
                outOfDate={checkOutOfDate}
                canRun={canPublish && content.sections.length > 0}
                saved={save.state === "saved"}
                onStart={async () => {
                  const r = await startFactCheck(module.id);
                  if (!r.ok) return setNotice(r.error);
                  const latest = await getFactCheck(module.id);
                  if (latest.ok) setFactCheck(latest.check);
                }}
                onMark={markIssue}
                screenTitle={(id) => {
                  const f = flattenScreens(content).find((x) => x.screen.id === id);
                  return f ? `${f.sectionIndex + 1}.${f.indexInSection + 1} ${f.screen.title}` : "A screen since removed";
                }}
                onOpen={(id) => setSelected({ kind: "screen", screenId: id })}
              />
              <TightenAll moduleId={module.id} content={content} onTightened={(s) => updateScreen(s.id, () => s)} />
              <NarrationSettings
                moduleId={module.id}
                content={content}
                onVoice={(voice) => setContent((c) => ({ ...c, voice }))}
                onVoiced={(screenId, url, voicedText) =>
                  updateScreen(screenId, (s) => ({ ...s, narration: { ...s.narration, src: url, voicedText } }))
                }
              />
            </>
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
              {issuesBy.has(screen.id) && <ScreenFactNotes issues={issuesBy.get(screen.id)!} outOfDate={checkOutOfDate} onMark={markIssue} />}
              <TightenScreen moduleId={module.id} screen={screen} onChange={(s) => updateScreen(screen.id, () => s)} />

              <ScreenSettings moduleId={module.id} screen={screen} voice={content.voice ?? null} onChange={(s) => updateScreen(screen.id, () => s)} />

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
              {factCheck?.status === "done" && openIssues > 0 && (
                <>
                  <strong>
                    The fact check has {openIssues} open {openIssues === 1 ? "note" : "notes"}
                    {checkOutOfDate ? " (from before your latest edits)" : ""}.
                  </strong>{" "}
                  Make sure each one is dealt with.{" "}
                </>
              )}
              {missingAudio > 0 && (
                <>
                  <strong>
                    {missingAudio} {missingAudio === 1 ? "screen has" : "screens have"} a narration script but no audio yet
                  </strong>{" "}
                  (learners will read {missingAudio === 1 ? "it" : "them"} without narration).{" "}
                </>
              )}
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
  onReading,
  onAddSection,
  aiBuildHref,
}: {
  content: ModuleContent;
  onChange: (objectives: string[]) => void;
  onReading: (reading: FurtherReading[]) => void;
  onAddSection?: () => void;
  /** Super Admins: write this module's sections with the AI module builder. */
  aiBuildHref: string | null;
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
      <FurtherReadingEditor reading={content.furtherReading ?? []} onChange={onReading} />
      {aiBuildHref && (
        <section className="builder__block" data-testid="builder-ai-build">
          <div className="builder__block-head">
            <span className="builder__block-type">Build with AI</span>
          </div>
          <p className="card__meta">
            {content.sections.length === 0
              ? "Give the AI reference documents and it writes this module's sections to the objectives above, as a draft for you to check."
              : "Rewrites this module's sections from reference documents, to the objectives above. It replaces the current sections; your objectives, further reading and voice stay."}
          </p>
          <div>
            <Link href={aiBuildHref} className={`button ${content.sections.length === 0 ? "button-primary" : "button-secondary"} button-small`}>
              {content.sections.length === 0 ? "Build this module with AI" : "Rebuild with AI"}
            </Link>
          </div>
        </section>
      )}
      {onAddSection && (
        <div className="builder__empty">
          <h2>{aiBuildHref ? "Or add the first section yourself" : "Then add the first section"}</h2>
          <p className="card__meta">
            Sections are the learner&rsquo;s menu. Each one is a few screens, shown one at a time: text, pictures, narration,
            questions and scenarios.
          </p>
          <button type="button" className={`button ${aiBuildHref ? "button-secondary" : "button-primary"}`} onClick={onAddSection}>
            Add the first section
          </button>
        </div>
      )}
    </div>
  );
}

const ISSUE_LABEL = { contradicted: "Doesn't match the law", wrong_reference: "Wrong reference", unsupported: "Couldn't confirm" } as const;

type IndexedIssue = { issue: FactIssue; index: number };

/** The module's last check against the Legislation Library, and running a new one. */
function FactCheckPanel({
  check,
  outOfDate,
  canRun,
  saved,
  onStart,
  onMark,
  screenTitle,
  onOpen,
}: {
  check: FactCheck | null;
  outOfDate: boolean;
  canRun: boolean;
  saved: boolean;
  onStart: () => Promise<void>;
  onMark: (index: number, checked: boolean) => Promise<void>;
  screenTitle: (id: string) => string;
  onOpen: (screenId: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const checking = check?.status === "checking";
  const all = (check?.issues ?? []).map((issue, index) => ({ issue, index }));
  const open = all.filter((x) => !x.issue.checkedByHand);
  const handled = all.filter((x) => x.issue.checkedByHand);
  return (
    <section className="builder__block" data-testid="fact-check">
      <div className="builder__block-head">
        <span className="builder__block-type">Fact check</span>
      </div>
      <p className="card__meta">
        Checks every fact, number, deadline and reference on every screen against the Legislation Library (not further reading
        or other links), and lists anything the law contradicts or doesn&rsquo;t cover. It changes nothing; you decide what to
        fix. It runs by itself after an AI build. &ldquo;Couldn&rsquo;t confirm&rdquo; means the library doesn&rsquo;t cover
        it: check it yourself, or add the source to the Legislation Library.
      </p>
      {check?.status === "checking" && (
        <p role="status">
          Checking{check.sectionsTotal ? ` section ${Math.min(check.sectionsDone + 1, check.sectionsTotal)} of ${check.sectionsTotal}` : ""}&hellip;
        </p>
      )}
      {check?.status === "failed" && (
        <p className="form-alert" role="alert">
          The last check didn&rsquo;t finish{check.error ? `: ${check.error}` : "."}
        </p>
      )}
      {check?.status === "done" && (
        <>
          <p>
            <strong>
              {open.length === 0
                ? handled.length
                  ? "Every note has been checked by hand."
                  : "No problems found."
                : `${open.length} ${open.length === 1 ? "note" : "notes"} to look at.`}
            </strong>{" "}
            <span className="card__meta">
              Checked {new Date(check.checkedAt).toLocaleString("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
              {outOfDate ? " · The module has changed since; check again to include your edits." : ""}
            </span>
          </p>
          {open.length > 0 && (
            <ul className="fact-list">
              {open.map(({ issue: i, index }) => (
                <li key={index}>
                  <button type="button" className="text-action" onClick={() => onOpen(i.screenId)}>
                    {screenTitle(i.screenId)}
                  </button>{" "}
                  <span className="fact-kind" data-kind={i.kind}>
                    {ISSUE_LABEL[i.kind]}
                  </span>
                  <div>{i.note}</div>
                  <button type="button" className="text-action" onClick={() => onMark(index, true)}>
                    Checked by hand
                  </button>
                </li>
              ))}
            </ul>
          )}
          {handled.length > 0 && (
            <details className="fact-handled">
              <summary>
                {handled.length} checked by hand
              </summary>
              <ul className="fact-list">
                {handled.map(({ issue: i, index }) => (
                  <li key={index}>
                    <span className="card__meta">{screenTitle(i.screenId)}:</span> {i.note}{" "}
                    <button type="button" className="text-action" onClick={() => onMark(index, false)}>
                      Undo
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      {canRun && (
        <div>
          <button
            type="button"
            className={`button ${check?.status === "done" && !outOfDate ? "button-secondary" : "button-primary"} button-small`}
            disabled={busy || checking || !saved}
            onClick={async () => {
              setBusy(true);
              await onStart();
              setBusy(false);
            }}
          >
            {checking ? "Checking…" : !saved ? "Saving…" : check ? "Check again" : "Check facts"}
          </button>
        </div>
      )}
    </section>
  );
}

/** What the fact check said about the screen being edited. */
function ScreenFactNotes({ issues, outOfDate, onMark }: { issues: IndexedIssue[]; outOfDate: boolean; onMark: (index: number, checked: boolean) => Promise<void> }) {
  return (
    <div className="fact-notes" role="note">
      <strong>Fact check{outOfDate ? " (before your latest edits)" : ""}</strong>
      <ul>
        {issues.map(({ issue: i, index }) => (
          <li key={index}>
            <span className="fact-kind" data-kind={i.kind}>
              {ISSUE_LABEL[i.kind]}
            </span>{" "}
            {i.quote && <q>{i.quote}</q>} {i.note}
            {i.library && <div className="fact-notes__law">{i.library}</div>}
            <div>
              <button type="button" className="text-action" onClick={() => onMark(index, true)}>
                Checked by hand
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Optional links for keen learners, listed on the module's closing recap. Public sources only. */
function FurtherReadingEditor({ reading, onChange }: { reading: FurtherReading[]; onChange: (r: FurtherReading[]) => void }) {
  const set = (id: string, patch: Partial<FurtherReading>) => onChange(reading.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  return (
    <section className="builder__block" data-testid="further-reading-editor">
      <div className="builder__block-head">
        <span className="builder__block-type">Further reading</span>
      </div>
      <p className="card__meta">
        Optional links for anyone who wants to go deeper, shown at the end of the module. Use public sources (the Act, the
        Province&rsquo;s strata pages, the Civil Resolution Tribunal), never paid or private material.
      </p>
      {reading.map((r, i) => (
        <div key={r.id} className="reading-editor__row">
          <div className="reading-editor__fields">
            <input value={r.title} maxLength={200} placeholder="Title" aria-label={`Reading ${i + 1} title`} onChange={(e) => set(r.id, { title: e.target.value })} />
            <input
              value={r.url}
              maxLength={1000}
              type="url"
              placeholder="https://"
              aria-label={`Reading ${i + 1} link`}
              onChange={(e) => set(r.id, { url: e.target.value })}
            />
            <input value={r.note} maxLength={300} placeholder="Why it's worth reading (optional)" aria-label={`Reading ${i + 1} note`} onChange={(e) => set(r.id, { note: e.target.value })} />
          </div>
          <ItemTools index={i} count={reading.length} onMove={(d) => onChange(move(reading, i, d))} onRemove={() => onChange(reading.filter((x) => x.id !== r.id))} />
        </div>
      ))}
      {reading.length < 10 && (
        <div>
          <button
            type="button"
            className="button button-secondary button-small"
            onClick={() => onChange([...reading, { id: newId("fr"), title: "", url: "", note: "" }])}
          >
            Add a link
          </button>
        </div>
      )}
    </section>
  );
}

/**
 * The module's narration voice, and voicing every screen whose audio is
 * missing or older than its script, one screen at a time.
 */
function NarrationSettings({
  moduleId,
  content,
  onVoice,
  onVoiced,
}: {
  moduleId: string;
  content: ModuleContent;
  onVoice: (v: { id: string; name: string } | null) => void;
  onVoiced: (screenId: string, url: string, voicedText: string) => void;
}) {
  const [voices, setVoices] = useState<Voice[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [stop, setStop] = useState(false);
  const stopRef = useRef(false);
  stopRef.current = stop;

  const screens = flattenScreens(content).map((f) => f.screen);
  const todo = screens.filter((s) => s.narration.transcript.trim() && (!s.narration.src || narrationOutOfDate(s)));
  const characters = todo.reduce((n, s) => n + s.narration.transcript.trim().length, 0);
  const voiced = screens.filter((s) => s.narration.src && !narrationOutOfDate(s)).length;

  async function loadVoices() {
    setLoading(true);
    setError(null);
    const r = await getNarrationVoices(moduleId);
    setLoading(false);
    if (!r.ok) return setError(r.error);
    setVoices(r.voices);
  }

  async function voiceAll() {
    if (!content.voice) return setError("Choose a voice first.");
    setError(null);
    setStop(false);
    setProgress({ done: 0, total: todo.length });
    for (let i = 0; i < todo.length; i++) {
      if (stopRef.current) break;
      const s = todo[i];
      const r = await generateNarration(moduleId, s.narration.transcript, content.voice.id);
      if (!r.ok) {
        setError(`Stopped at "${s.title}": ${r.error}`);
        break;
      }
      onVoiced(s.id, r.url, r.voicedText);
      setProgress({ done: i + 1, total: todo.length });
    }
    setProgress(null);
  }

  return (
    <div className="builder__canvas">
      <section className="builder__block">
        <div className="builder__block-head">
          <span className="builder__block-type">Narration</span>
        </div>
        <p className="card__meta">
          Generated with ElevenLabs from each screen&rsquo;s narration script. {voiced} of {screens.length} screens have up-to-date
          narration.
        </p>
        <div className="be-row">
          <span>
            Voice: <strong>{content.voice?.name ?? "not chosen"}</strong>
          </span>
          <button type="button" className="button button-secondary button-small" onClick={loadVoices} disabled={loading}>
            {loading ? "Loading voices…" : content.voice ? "Change voice" : "Choose a voice"}
          </button>
        </div>
        {voices && (
          <ul className="voice-list">
            {voices.map((v) => (
              <li key={v.id} data-chosen={content.voice?.id === v.id}>
                <div>
                  <strong>{v.name}</strong>
                  {v.description && <span className="card__meta"> &middot; {v.description}</span>}
                </div>
                {v.previewUrl && <audio src={v.previewUrl} controls preload="none" aria-label={`Sample of ${v.name}`} />}
                <button
                  type="button"
                  className="button button-secondary button-small"
                  onClick={() => {
                    onVoice({ id: v.id, name: v.name });
                    setVoices(null);
                  }}
                >
                  {content.voice?.id === v.id ? "Chosen" : "Use this voice"}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="be-row">
          {progress ? (
            <>
              <span role="status">
                Making audio: {progress.done} of {progress.total} screens…
              </span>
              <button type="button" className="text-action" onClick={() => setStop(true)}>
                Stop
              </button>
            </>
          ) : (
            <>
              <button type="button" className="button button-primary button-small" disabled={!content.voice || todo.length === 0} onClick={voiceAll}>
                {todo.length ? `Generate narration for ${todo.length} ${todo.length === 1 ? "screen" : "screens"}` : "All narration is up to date"}
              </button>
              {todo.length > 0 && <span className="card__meta">About {characters.toLocaleString("en-CA")} characters of your ElevenLabs allowance.</span>}
            </>
          )}
        </div>
        {error && (
          <p className="form-alert" role="alert">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}

/** Most screens should carry about this many words, so they can be read while the narration plays. */
const WORD_TARGET = 45;

/** Words on screen, and Tighten with AI (with undo) when there are too many. */
function TightenScreen({ moduleId, screen, onChange }: { moduleId: string; screen: Screen; onChange: (s: Screen) => void }) {
  const [busy, setBusy] = useState(false);
  const [undo, setUndo] = useState<Screen | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const words = onScreenWords(screen);
  useEffect(() => {
    setUndo(null);
    setError(null);
    setResult(null);
  }, [screen.id]);

  async function tighten() {
    setBusy(true);
    setError(null);
    const before = screen;
    setResult(null);
    const r = await tightenScreen(moduleId, screen);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    if (r.after >= r.before) return setResult("The AI couldn't make this shorter without losing something. Edit it by hand.");
    setUndo(before);
    onChange({ ...r.screen, id: screen.id });
    setResult(`${r.before} → ${r.after} words.${r.after > WORD_TARGET ? " Still long: trim the rest by hand." : ""}`);
  }

  if (words === 0 && !undo) return null;
  return (
    <div className="builder__words" data-over={words > WORD_TARGET}>
      <span>
        {words} words on screen{words > WORD_TARGET ? ` (aim for about ${WORD_TARGET - 5}; the narration carries the detail)` : ""}
      </span>
      {words > 0 && (
        <button type="button" className="button button-secondary button-small" disabled={busy} onClick={tighten}>
          {busy ? "Tightening…" : "Tighten with AI"}
        </button>
      )}
      {undo && !busy && (
        <button
          type="button"
          className="text-action"
          onClick={() => {
            onChange(undo);
            setUndo(null);
          }}
        >
          Undo
        </button>
      )}
      {result && !busy && <span role="status">{result}</span>}
      {error && (
        <span className="form-alert" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

/** Tighten every screen with too many words, one at a time; narration and its audio are untouched. */
function TightenAll({ moduleId, content, onTightened }: { moduleId: string; content: ModuleContent; onTightened: (s: Screen) => void }) {
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<string[] | null>(null);
  // Screens the AI has already had a go at this visit: offering them again just repeats it.
  const [tried, setTried] = useState<Set<string>>(new Set());
  const stopRef = useRef(false);
  const over = flattenScreens(content)
    .map((f) => f.screen)
    .filter((s) => onScreenWords(s) > WORD_TARGET);
  const crowded = over.filter((s) => !tried.has(s.id));

  async function run() {
    stopRef.current = false;
    setError(null);
    setReport(null);
    const lines: string[] = [];
    setProgress({ done: 0, total: crowded.length });
    for (let i = 0; i < crowded.length; i++) {
      if (stopRef.current) break;
      const s = crowded[i];
      const r = await tightenScreen(moduleId, s);
      if (!r.ok) {
        setError(`Stopped at "${s.title}": ${r.error}`);
        break;
      }
      setTried((t) => new Set(t).add(s.id));
      if (r.after < r.before) onTightened({ ...r.screen, id: s.id });
      lines.push(
        r.after < r.before
          ? `"${s.title}": ${r.before} → ${r.after} words${r.after > WORD_TARGET ? " (still long: trim by hand)" : ""}`
          : `"${s.title}": couldn't be shortened without losing something; edit by hand`
      );
      setProgress({ done: i + 1, total: crowded.length });
    }
    setProgress(null);
    setReport(lines);
  }

  return (
    <div className="builder__canvas">
      <section className="builder__block">
        <div className="builder__block-head">
          <span className="builder__block-type">Screen text</span>
        </div>
        <p className="card__meta">
          Learners read the screen while the narration plays, so each screen should carry about {WORD_TARGET - 5} words at most.
          Tighten with AI shortens the on-screen text only; narration, its audio, questions and scenarios stay as they are.
          Check the results; each screen also has its own Tighten button with Undo.
        </p>
        <div className="be-row">
          {progress ? (
            <>
              <span role="status">
                Tightening: {progress.done} of {progress.total} screens…
              </span>
              <button type="button" className="text-action" onClick={() => (stopRef.current = true)}>
                Stop
              </button>
            </>
          ) : (
            <button type="button" className="button button-primary button-small" disabled={crowded.length === 0} onClick={run}>
              {crowded.length
                ? `Tighten ${crowded.length} crowded ${crowded.length === 1 ? "screen" : "screens"}`
                : over.length
                  ? `${over.length} ${over.length === 1 ? "screen is" : "screens are"} still long: edit by hand`
                  : "Every screen is within the word target"}
            </button>
          )}
        </div>
        {report && report.length > 0 && (
          <ul className="tighten-report" role="status">
            {report.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        )}
        {error && (
          <p className="form-alert" role="alert">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}

const layoutLabels: Record<ScreenLayout, string> = { full: "Full width", split: "Text with a picture beside it" };

/** A screen's layout, side picture and narration. */
function ScreenSettings({
  moduleId,
  screen,
  voice,
  onChange,
}: {
  moduleId: string;
  screen: Screen;
  voice: { id: string; name: string } | null;
  onChange: (s: Screen) => void;
}) {
  const [picking, setPicking] = useState(false);
  const [voicing, setVoicing] = useState(false);
  const [narrationError, setNarrationError] = useState<string | null>(null);
  const stale = narrationOutOfDate(screen);

  async function voiceIt() {
    if (!voice) return setNarrationError("Choose a narration voice in Module settings first.");
    setVoicing(true);
    setNarrationError(null);
    const r = await generateNarration(moduleId, screen.narration.transcript, voice.id);
    setVoicing(false);
    if (!r.ok) return setNarrationError(r.error);
    onChange({ ...screen, narration: { ...screen.narration, src: r.url, voicedText: r.voicedText } });
  }

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
        <button type="button" className="button button-secondary button-small builder__find-photo" onClick={() => setPicking(true)}>
          {screen.image.src ? "Change photo" : "Find a photo"}
        </button>
      </div>
      {screen.layout === "split" && (
        <div className="be-stack">
          <MediaField
            moduleId={moduleId}
            kind="image"
            value={screen.image.src}
            label="Or upload your own picture"
            onChange={(src) => onChange({ ...screen, image: { ...screen.image, src, credit: null } })}
          />
          <PhotoCreditLine credit={screen.image.credit} />
          <label className="field">
            <span>Picture description (alt text)</span>
            <input value={screen.image.alt} maxLength={500} onChange={(e) => onChange({ ...screen, image: { ...screen.image, alt: e.target.value } })} />
          </label>
        </div>
      )}
      {picking && (
        <PhotoPicker
          moduleId={moduleId}
          initialQuery={screen.image.hint || screen.title}
          onClose={() => setPicking(false)}
          onPick={(p) => {
            onChange({ ...screen, layout: "split", image: { ...screen.image, src: p.src, alt: p.alt || screen.image.alt, credit: p.credit } });
            setPicking(false);
          }}
        />
      )}

      <div className="be-stack">
        <label className="field">
          <span>Narration script (also the captions)</span>
          <textarea
            rows={3}
            value={screen.narration.transcript}
            onChange={(e) => onChange({ ...screen, narration: { ...screen.narration, transcript: e.target.value } })}
          />
        </label>
        <div className="be-row builder__narration">
          <button
            type="button"
            className={`button ${screen.narration.src && !stale ? "button-secondary" : "button-primary"} button-small`}
            disabled={voicing || !screen.narration.transcript.trim()}
            onClick={voiceIt}
            title={voice ? `Voice: ${voice.name}` : "Choose a voice in Module settings"}
          >
            {voicing ? "Making audio…" : screen.narration.src ? "Regenerate narration" : "Generate narration"}
          </button>
          <span className="card__meta">
            {voice ? `Voice: ${voice.name}` : "No voice chosen yet (Module settings)"}
            {screen.narration.transcript.trim() ? ` · ${screen.narration.transcript.trim().length.toLocaleString("en-CA")} characters` : ""}
          </span>
        </div>
        {stale && (
          <p className="builder__stale" role="status">
            The script has changed since this audio was made. Regenerate it so the narration matches the captions.
          </p>
        )}
        {narrationError && (
          <p className="form-alert" role="alert">
            {narrationError}
          </p>
        )}
        {screen.narration.src && <audio src={screen.narration.src} controls preload="metadata" className="be-audio" key={screen.narration.src} />}
        <MediaField
          moduleId={moduleId}
          kind="audio"
          value={screen.narration.src}
          label={screen.narration.src ? "Narration added. Next waits until it finishes." : "Or upload your own recording (MP3 or M4A)"}
          onChange={(src) => onChange({ ...screen, narration: { ...screen.narration, src, voicedText: "" } })}
          onClear={screen.narration.src ? () => onChange({ ...screen, narration: { ...screen.narration, src: "", voicedText: "" } }) : undefined}
        />
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
