"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  addSlide,
  attachStockPhoto,
  attachUpload,
  attachVideoLink,
  checkInModule,
  checkOutModule,
  checkoutStillMine,
  loadBuilderModule,
  createSlideUpload,
  deleteSlide,
  findVoice,
  generateNarration,
  getNarrationVoices,
  listEarlierNarration,
  markReadyForReview,
  moveSlide,
  publishModule,
  releaseCheckout,
  removeSlideMedia,
  saveModuleSettings,
  searchCitations,
  setDefaultVoice,
  updateMediaAlt,
  updateSlide,
  applyEarlierNarration,
  type EarlierNarration,
  type LibraryHit,
} from "@/app/admin/training/actions";
import { ModulePlayer } from "@/components/training/ModulePlayer";
import { DraftWithAI } from "@/components/training/DraftWithAI";
import { PhotoCreditLine, PhotoPicker } from "@/components/training/PhotoPicker";
import type { BuilderModule, Checkout } from "@/lib/data/training";
import type { Voice } from "@/lib/media/elevenlabs";
import {
  BLOOM_LEVELS,
  bloomFor,
  bloomLabels,
  bloomVerbs,
  buildPlayerContent,
  countWords,
  elementLabels,
  ITEM_WORDS_MAX,
  layoutLabels,
  LAYOUTS,
  MEDIA_BUCKET,
  narrationOutOfDate,
  newElement,
  newId,
  OBJECTIVES_MAX,
  publishProblems,
  SLIDE_WORDS_MAX,
  SLIDE_WORDS_TARGET,
  slideProblems,
  type Bloom,
  type ElementType,
  type FurtherReading,
  type Objective,
  type Slide,
  type SlideElement,
  type SlidePatch,
} from "@/lib/training/slides";

type Voiced = { id: string; name: string } | null;
type SaveState = "saved" | "saving" | "error";

const LOST = "You're not editing";

/**
 * The slide builder (0041). A module opens read-only; "Edit module" checks
 * it out to you (no one else can change it until you check it back in
 * with "Finished editing"). While it's yours, every change saves by itself
 * a moment after you make it: slide by slide, so a change to one slide
 * can never overwrite another. Files (pictures, video, narration) are
 * saved to the slide the moment they're added.
 */
export function SlideBuilder({
  module: initial,
  me,
  defaultVoice: initialDefaultVoice,
  canPublish,
  backHref,
}: {
  module: BuilderModule;
  me: string;
  defaultVoice: Voiced;
  canPublish: boolean;
  backHref: string;
}) {
  const router = useRouter();
  const [slides, setSlides] = useState<Slide[]>(initial.slides);
  const [objectives, setObjectives] = useState<Objective[]>(initial.objectives);
  const [reading, setReading] = useState<FurtherReading[]>(initial.furtherReading);
  const [voice, setVoice] = useState<Voiced>(initial.voice);
  const [defaultVoice, setDefaultVoiceState] = useState<Voiced>(initialDefaultVoice);
  const [selected, setSelected] = useState<string>(initial.slides[0]?.id ?? "settings");
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [token, setToken] = useState<string | null>(null);
  const [checkout, setCheckout] = useState<Checkout | null>(initial.checkout);
  const [save, setSave] = useState<{ state: SaveState; error?: string }>({ state: "saved" });
  const [alert, setAlert] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [readyAt, setReadyAt] = useState(initial.readyForReviewAt);
  const editing = Boolean(token);

  // ── Saving: queued changes per slide, sent a moment after the last edit ──
  const pending = useRef(new Map<string, SlidePatch>());
  const settingsPending = useRef(false);
  const latest = useRef({ objectives, reading, voice });
  latest.current = { objectives, reading, voice };
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushing = useRef<Promise<boolean> | null>(null);
  const tokenRef = useRef(token);
  tokenRef.current = token;

  const storeKey = `sc-checkout-${initial.id}`;
  const remember = (t: string | null) => {
    try {
      if (t) sessionStorage.setItem(storeKey, t);
      else sessionStorage.removeItem(storeKey);
    } catch {}
  };

  /** Show the module as saved (after checking out, or when the page refreshes while read-only). */
  const load = useCallback((m: BuilderModule) => {
    setSlides(m.slides);
    setObjectives(m.objectives);
    setReading(m.furtherReading);
    setVoice(m.voice);
    setReadyAt(m.readyForReviewAt);
    setSelected((sel) => (sel === "settings" || m.slides.some((s) => s.id === sel) ? sel : (m.slides[0]?.id ?? "settings")));
  }, []);
  useEffect(() => {
    if (!tokenRef.current) {
      load(initial);
      setCheckout(initial.checkout);
    }
  }, [initial, load]);

  // The window that's editing answers when another window asks who has the checkout.
  useEffect(() => {
    if (!token || typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(storeKey);
    ch.onmessage = (e) => {
      if (e.data?.type === "who" && e.data.token === token) ch.postMessage({ type: "me", token });
    };
    return () => ch.close();
  }, [token, storeKey]);

  // A reload of this window carries on editing, if the checkout is still this
  // window's. A copy of the window (a duplicated tab carries the same
  // memory) doesn't: if the original answers, the copy stays read-only.
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = sessionStorage.getItem(storeKey);
    } catch {}
    if (!saved || initial.checkout?.userId !== me) return;
    const token = saved;
    let answered = false;
    let ch: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== "undefined") {
      ch = new BroadcastChannel(storeKey);
      ch.onmessage = (e) => {
        if (e.data?.type === "me" && e.data.token === token) answered = true;
      };
      ch.postMessage({ type: "who", token });
    }
    const t = setTimeout(() => {
      ch?.close();
      if (answered) return remember(null);
      void checkoutStillMine(initial.id, token).then((ok) => {
        if (ok) setToken(token);
        else remember(null);
      });
    }, 400);
    return () => {
      clearTimeout(t);
      ch?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lose = useCallback((error: string) => {
    try {
      sessionStorage.removeItem(`sc-checkout-${initial.id}`);
    } catch {}
    setToken(null);
    setAlert(error);
    setSave({ state: "error", error });
  }, [initial.id]);

  const flush = useCallback(async (): Promise<boolean> => {
    if (flushing.current) await flushing.current;
    const t = tokenRef.current;
    if (!t) return pending.current.size === 0 && !settingsPending.current;
    if (pending.current.size === 0 && !settingsPending.current) return true;
    const run = (async () => {
      setSave({ state: "saving" });
      const batch = [...pending.current.entries()];
      pending.current.clear();
      for (const [slideId, patch] of batch) {
        const r = await updateSlide(initial.id, t, slideId, patch);
        if (!r.ok) {
          // Put it back so a retry sends it again.
          pending.current.set(slideId, { ...patch, ...(pending.current.get(slideId) ?? {}) });
          if (r.error.startsWith(LOST)) lose(r.error);
          else setSave({ state: "error", error: r.error });
          return false;
        }
        if (r.citations) setSlides((ss) => ss.map((s) => (s.id === slideId ? { ...s, citations: r.citations! } : s)));
      }
      if (settingsPending.current) {
        settingsPending.current = false;
        const { objectives: o, reading: fr, voice: v } = latest.current;
        const r = await saveModuleSettings(initial.id, t, { objectives: o, furtherReading: fr, voice: v });
        if (!r.ok) {
          settingsPending.current = true;
          if (r.error.startsWith(LOST)) lose(r.error);
          else setSave({ state: "error", error: r.error });
          return false;
        }
      }
      setSave({ state: "saved" });
      return true;
    })();
    flushing.current = run;
    const ok = await run;
    flushing.current = null;
    if (pending.current.size || settingsPending.current) schedule();
    return ok;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.id, lose]);

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 700);
  }, [flush]);

  function changeSlide(id: string, patch: SlidePatch) {
    if (!editing) return;
    setSlides((ss) => ss.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    pending.current.set(id, { ...(pending.current.get(id) ?? {}), ...patch });
    setSave({ state: "saving" });
    schedule();
  }
  function changeSettings(fn: () => void) {
    if (!editing) return;
    fn();
    settingsPending.current = true;
    setSave({ state: "saving" });
    schedule();
  }

  // Send anything waiting before the page goes away, and warn if it can't be.
  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => {
      if (pending.current.size || settingsPending.current) {
        void flush();
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", onLeave);
    return () => {
      window.removeEventListener("beforeunload", onLeave);
      void flush();
    };
  }, [flush]);

  // ── Checking out and in ──
  async function startEditing() {
    setBusy(true);
    setAlert(null);
    const r = await checkOutModule(initial.id);
    setBusy(false);
    if (!r.ok) {
      setAlert(r.error);
      router.refresh();
      return;
    }
    // Start from what's saved now, in case it changed since this page opened.
    const fresh = await loadBuilderModule(initial.id);
    if (fresh.ok) load(fresh.module);
    remember(r.token);
    setToken(r.token);
    setCheckout({ userId: me, name: "you", at: new Date().toISOString() });
    setSave({ state: "saved" });
  }

  async function finishEditing() {
    if (!token) return;
    setBusy(true);
    const ok = await flush();
    if (!ok) {
      setBusy(false);
      return setAlert("Some changes haven't saved yet, so the module is still checked out to you. Fix the problem above and try again.");
    }
    const r = await checkInModule(initial.id, token);
    setBusy(false);
    if (!r.ok) return setAlert(r.error);
    remember(null);
    setToken(null);
    setCheckout(null);
    setNotice("Checked in. Your changes are saved, and the module is free for others to edit.");
    router.refresh();
  }

  async function release() {
    const mine = checkout?.userId === me;
    const ask = mine
      ? "Check the module back in from here? Do this only if the window you were editing in is closed: if it's still open, it stops saving. Everything you changed there is already saved."
      : `Release the module from ${checkout?.name}? Their changes are already saved, but if they're still editing, their window stops saving.`;
    if (!window.confirm(ask)) return;
    const r = await releaseCheckout(initial.id);
    if (!r.ok) return setAlert(r.error);
    setCheckout(null);
    router.refresh();
  }

  // ── Slides ──
  async function add(afterId: string | null) {
    if (!token) return;
    await flush();
    const r = await addSlide(initial.id, token, afterId);
    if (!r.ok) return r.error.startsWith(LOST) ? lose(r.error) : setAlert(r.error);
    setSlides((ss) => {
      const i = afterId ? ss.findIndex((s) => s.id === afterId) + 1 : ss.length;
      const next = [...ss];
      next.splice(i, 0, r.slide);
      return next.map((s, n) => ({ ...s, position: n + 1 }));
    });
    setSelected(r.slide.id);
    setMode("edit");
  }

  async function move(id: string, dir: -1 | 1) {
    if (!token) return;
    await flush();
    const r = await moveSlide(initial.id, token, id, dir);
    if (!r.ok) return r.error.startsWith(LOST) ? lose(r.error) : setAlert(r.error);
    setSlides((ss) => {
      const i = ss.findIndex((s) => s.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= ss.length) return ss;
      const next = [...ss];
      [next[i], next[j]] = [next[j], next[i]];
      return next.map((s, n) => ({ ...s, position: n + 1 }));
    });
  }

  async function remove(slide: Slide) {
    if (!token) return;
    if (!window.confirm(`Delete slide "${slide.title || "Untitled"}"? Its picture, video and narration are deleted too.`)) return;
    pending.current.delete(slide.id);
    await flush();
    const r = await deleteSlide(initial.id, token, slide.id);
    if (!r.ok) return r.error.startsWith(LOST) ? lose(r.error) : setAlert(r.error);
    setSlides((ss) => {
      const i = ss.findIndex((s) => s.id === slide.id);
      const next = ss.filter((s) => s.id !== slide.id).map((s, n) => ({ ...s, position: n + 1 }));
      if (selected === slide.id) setSelected(next[Math.max(0, i - 1)]?.id ?? "settings");
      return next;
    });
  }

  /** A slide's file changed on the server (already saved there). */
  function patchLocal(id: string, patch: Partial<Slide>) {
    setSlides((ss) => ss.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  // ── Publish / review ──
  const moduleInfo = useMemo(() => ({ title: initial.title, objectives, furtherReading: reading }), [initial.title, objectives, reading]);
  const problems = useMemo(() => publishProblems(moduleInfo, slides), [moduleInfo, slides]);
  const [showProblems, setShowProblems] = useState(false);

  async function publish() {
    if (problems.length) return setShowProblems(true);
    if (!window.confirm("Publish this module? Learners will see it as it is now.")) return;
    setBusy(true);
    const ok = await flush();
    if (!ok) {
      setBusy(false);
      return;
    }
    const r = await publishModule(initial.id);
    setBusy(false);
    if (!r.ok) return setAlert(r.error);
    setNotice(`Published as version ${r.version}. Learners see it now.`);
    router.refresh();
  }

  async function toggleReady() {
    const r = await markReadyForReview(initial.id, !readyAt);
    if (!r.ok) return setAlert(r.error);
    setReadyAt(readyAt ? null : new Date().toISOString());
  }

  const slide = slides.find((s) => s.id === selected) ?? null;
  const content = useMemo(() => buildPlayerContent(moduleInfo, slides), [moduleInfo, slides]);
  const heldByOther = checkout && checkout.userId !== me && !editing;
  const heldByMeElsewhere = checkout && checkout.userId === me && !editing;
  const topics = [...new Set(slides.map((s) => s.topic.trim()).filter(Boolean))];

  return (
    <div className="builder">
      <header className="builder__top">
        <div className="builder__title">
          <Link href={backHref} className="card__meta">
            &larr; {initial.track.title}
          </Link>
          <strong>{initial.title}</strong>
        </div>
        {editing && (
          <span className="builder__status" data-state={save.state} role="status">
            {save.state === "saving" ? "Saving…" : save.state === "error" ? "Not saved" : "All changes saved"}
          </span>
        )}
        <span className="pill">{initial.publishedVersion ? `Published v${initial.publishedVersion}` : "Not published"}</span>
        <div className="builder__mode" role="group" aria-label="Mode">
          <button type="button" data-active={mode === "edit"} onClick={() => setMode("edit")}>
            Slides
          </button>
          <button type="button" data-active={mode === "preview"} onClick={() => setMode("preview")} disabled={slides.length === 0}>
            Preview
          </button>
        </div>
        {editing ? (
          <button type="button" className="button button-primary button-small" onClick={finishEditing} disabled={busy} data-testid="builder-check-in">
            Finished editing
          </button>
        ) : (
          <button type="button" className="button button-primary button-small" onClick={startEditing} disabled={busy || Boolean(heldByOther) || Boolean(heldByMeElsewhere)} data-testid="builder-check-out">
            Edit module
          </button>
        )}
        {canPublish ? (
          <button type="button" className="button button-secondary button-small" onClick={publish} disabled={busy || Boolean(heldByOther)} data-testid="builder-publish">
            Publish
          </button>
        ) : (
          <button type="button" className="button button-secondary button-small" onClick={toggleReady}>
            {readyAt ? "Ready for review (undo)" : "Mark ready for review"}
          </button>
        )}
      </header>

      {!editing && (
        <p className="builder__checkout" role="status" data-testid="builder-checkout">
          {heldByOther ? (
            <>
              <strong>{checkout!.name} is editing this module</strong> (checked out {when(checkout!.at)}). It&rsquo;s read-only for
              you until they press Finished editing.{" "}
              {canPublish && (
                <button type="button" className="text-action" onClick={release}>
                  Release it
                </button>
              )}
            </>
          ) : heldByMeElsewhere ? (
            <>
              <strong>You&rsquo;re already editing this module in another window</strong> (since {when(checkout!.at)}). Carry on
              there, and press Finished editing when you&rsquo;re done. If that window is closed,{" "}
              <button type="button" className="text-action" onClick={release}>
                check the module back in from here
              </button>
              .
            </>
          ) : (
            <>Read-only. Press Edit module to make changes; no one else can edit it until you press Finished editing.</>
          )}
        </p>
      )}
      {alert && (
        <div className="builder__alert" role="alert">
          <p>{alert}</p>
          {save.state === "error" && editing && (
            <button type="button" className="button button-secondary button-small" onClick={() => void flush()}>
              Try saving again
            </button>
          )}
          <button type="button" className="text-action" onClick={() => setAlert(null)}>
            Dismiss
          </button>
        </div>
      )}
      {save.state === "error" && editing && !alert && (
        <div className="builder__alert" role="alert">
          <p>{save.error}</p>
          <button type="button" className="button button-secondary button-small" onClick={() => void flush()}>
            Try saving again
          </button>
        </div>
      )}
      {notice && (
        <p className="builder__notice" role="status">
          {notice}{" "}
          <button type="button" className="text-action" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </p>
      )}
      {showProblems && problems.length > 0 && (
        <div className="builder__alert" role="alert">
          <p>
            <strong>Fix these before publishing:</strong>
          </p>
          <ul className="builder__problems">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <button type="button" className="text-action" onClick={() => setShowProblems(false)}>
            Hide
          </button>
        </div>
      )}

      <div className="builder__body">
        <nav className="builder__lessons builder__outline" aria-label="Slides">
          <button
            type="button"
            className="builder__settings-link"
            data-active={selected === "settings"}
            onClick={() => {
              setSelected("settings");
              setMode("edit");
            }}
          >
            Module settings
            <span className="card__meta">
              {objectives.length} {objectives.length === 1 ? "objective" : "objectives"}
            </span>
          </button>
          <Outline slides={slides} selected={selected} editing={editing} onSelect={(id) => {
              setSelected(id);
              setMode("edit");
            }} onMove={move} onRemove={remove} />
          {editing && (
            <button type="button" className="button button-secondary button-small builder__add-lesson" onClick={() => add(slide?.id ?? null)} data-testid="builder-add-slide">
              + Add slide{slide ? " after this one" : ""}
            </button>
          )}
        </nav>

        <main className="builder__main">
          {mode === "preview" && slides.length > 0 ? (
            <Preview content={content} title={initial.title} track={initial.track} startId={slide?.id} />
          ) : selected === "settings" || !slide ? (
            <fieldset className="builder__fieldset" disabled={!editing}>
              <Settings
                moduleId={initial.id}
                objectives={objectives}
                reading={reading}
                voice={voice}
                defaultVoice={defaultVoice}
                canSetDefault={canPublish}
                onObjectives={(o) => changeSettings(() => setObjectives(o))}
                onReading={(r) => changeSettings(() => setReading(r))}
                onVoice={(v) => changeSettings(() => setVoice(v))}
                onDefaultVoice={setDefaultVoiceState}
              />
            </fieldset>
          ) : (
            <fieldset className="builder__fieldset" disabled={!editing} key={slide.id}>
              <SlideEditor
                moduleId={initial.id}
                token={token}
                slide={slide}
                number={slides.indexOf(slide) + 1}
                topics={topics}
                voice={voice ?? defaultVoice}
                onChange={(p) => changeSlide(slide.id, p)}
                onSaved={(p) => patchLocal(slide.id, p)}
                onError={(e) => (e.startsWith(LOST) ? lose(e) : setAlert(e))}
                beforeFiles={flush}
              />
            </fieldset>
          )}
          {/* Kept mounted while you look at the slides it's writing, so the outline and progress aren't lost. */}
          {editing && token && (
            <div className="builder__canvas" hidden={!(mode === "edit" && (selected === "settings" || !slide))}>
              <DraftWithAI
                moduleId={initial.id}
                token={token}
                hasObjectives={objectives.some((o) => o.text.trim())}
                onSlide={(s) => setSlides((ss) => [...ss, s].sort((a, b) => a.position - b.position))}
              />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function when(iso: string) {
  if (!iso) return "earlier";
  return new Date(iso).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" });
}

// ── Outline: slides grouped by topic ─────────────────────────────────────

function Outline({
  slides,
  selected,
  editing,
  onSelect,
  onMove,
  onRemove,
}: {
  slides: Slide[];
  selected: string;
  editing: boolean;
  onSelect: (id: string) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onRemove: (s: Slide) => void;
}) {
  if (!slides.length) return <p className="card__meta builder__empty-note">No slides yet.</p>;
  const groups: { topic: string; slides: Slide[] }[] = [];
  for (const s of slides) {
    const t = s.topic.trim();
    const last = groups[groups.length - 1];
    if (!last || (t && t !== last.topic)) groups.push({ topic: t || "Introduction", slides: [s] });
    else last.slides.push(s);
  }
  return (
    <>
      {groups.map((g, gi) => (
        <div key={`${g.topic}-${gi}`} className="builder__section">
          <div className="builder__section-head">
            <span className="builder__section-title">{g.topic}</span>
          </div>
          <ol>
            {g.slides.map((s) => {
              const n = slides.indexOf(s);
              const issues = slideProblems(s).length;
              return (
                <li key={s.id} data-active={selected === s.id}>
                  <button type="button" className="builder__lesson" onClick={() => onSelect(s.id)}>
                    <span className="builder__lesson-num">{n + 1}</span>
                    <span>{s.title || "Untitled slide"}</span>
                    {issues > 0 && (
                      <span className="builder__flag" title={`${issues} ${issues === 1 ? "thing" : "things"} to fix`}>
                        {issues}
                      </span>
                    )}
                  </button>
                  {editing && (
                    <span className="be-tools">
                      <button type="button" className="be-icon" disabled={n === 0} onClick={() => onMove(s.id, -1)} aria-label={`Move slide ${n + 1} up`}>
                        &uarr;
                      </button>
                      <button type="button" className="be-icon" disabled={n === slides.length - 1} onClick={() => onMove(s.id, 1)} aria-label={`Move slide ${n + 1} down`}>
                        &darr;
                      </button>
                      <button type="button" className="be-icon be-icon--danger" onClick={() => onRemove(s)} aria-label={`Delete slide ${n + 1}`}>
                        &times;
                      </button>
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </>
  );
}

// ── Preview ──────────────────────────────────────────────────────────────

function Preview({
  content,
  title,
  track,
  startId,
}: {
  content: ReturnType<typeof buildPlayerContent>;
  title: string;
  track: { title: string; slug: string };
  startId?: string;
}) {
  const [device, setDevice] = useState<"desktop" | "phone">("desktop");
  const [skipWaits, setSkipWaits] = useState(true);
  return (
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
          moduleId="preview"
          moduleTitle={title}
          version={0}
          content={content}
          completedSectionIds={[]}
          track={track}
          nextModule={null}
          startScreenId={startId}
        />
      </div>
    </div>
  );
}

// ── One slide ────────────────────────────────────────────────────────────

function SlideEditor({
  moduleId,
  token,
  slide,
  number,
  topics,
  voice,
  onChange,
  onSaved,
  onError,
  beforeFiles,
}: {
  moduleId: string;
  token: string | null;
  slide: Slide;
  number: number;
  topics: string[];
  voice: Voiced;
  onChange: (p: SlidePatch) => void;
  onSaved: (p: Partial<Slide>) => void;
  onError: (e: string) => void;
  beforeFiles: () => Promise<boolean>;
}) {
  const problems = slideProblems(slide);
  return (
    <div className="builder__canvas">
      <div className="builder__screen-head">
        <span className="card__meta">Slide {number}</span>
      </div>

      <section className="builder__block">
        <div className="be-stack">
          <label>
            <span className="be-label">Topic</span>
            <input
              value={slide.topic}
              list="slide-topics"
              maxLength={200}
              placeholder="e.g. Units and common property"
              onChange={(e) => onChange({ topic: e.target.value })}
            />
            <datalist id="slide-topics">
              {topics.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
            <span className="card__meta">Slides on the same topic sit together in the learner&rsquo;s menu.</span>
          </label>
          <label>
            <span className="be-label">Title</span>
            <input value={slide.title} maxLength={200} placeholder="Slide title" onChange={(e) => onChange({ title: e.target.value })} data-testid="slide-title" />
          </label>
          <label>
            <span className="be-label">Text</span>
            <textarea
              rows={6}
              value={slide.body}
              maxLength={4000}
              placeholder={"A sentence or two, or short bullets.\n- Start a line with a dash for a bullet"}
              onChange={(e) => onChange({ body: e.target.value })}
              data-testid="slide-body"
            />
          </label>
          <WordCount words={countWords(slide.body)} max={SLIDE_WORDS_MAX} target={SLIDE_WORDS_TARGET} />
        </div>
      </section>

      <section className="builder__block">
        <div className="builder__block-head">
          <span className="builder__block-type">Picture or video</span>
        </div>
        <div className="builder__devices builder__layouts" role="group" aria-label="Layout">
          {LAYOUTS.map((l) => (
            <button key={l} type="button" data-active={slide.layout === l} onClick={() => onChange({ layout: l })}>
              {layoutLabels[l]}
            </button>
          ))}
        </div>
        {slide.layout !== "text" && (
          <Visual moduleId={moduleId} token={token} slide={slide} onSaved={onSaved} onError={onError} beforeFiles={beforeFiles} />
        )}
      </section>

      <Narration moduleId={moduleId} token={token} slide={slide} voice={voice} onChange={onChange} onSaved={onSaved} onError={onError} beforeFiles={beforeFiles} />

      <ElementEditor element={slide.element} onChange={(element) => onChange({ element })} />

      <Citations moduleId={moduleId} slide={slide} onChange={(citations) => onChange({ citations })} onError={onError} />

      {problems.length > 0 && (
        <section className="builder__block">
          <div className="builder__block-head">
            <span className="builder__block-type">Before publishing</span>
          </div>
          <ul className="builder__problems">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function WordCount({ words, max, target }: { words: number; max: number; target?: number }) {
  const over = words > max;
  return (
    <div className="builder__words" data-over={over} aria-live="polite">
      <span>
        {words} / {max} words
        {over ? ` · ${words - max} over: cut it down (learners can't be shown more than ${max})` : target && words > 0 && words < target - 15 ? " · short is fine" : ""}
      </span>
    </div>
  );
}

/** Upload a file straight into the slide's folder, then put it on the slide. */
async function uploadToSlide(moduleId: string, token: string, slideId: string, file: File, alt: string) {
  const ticket = await createSlideUpload(moduleId, token, slideId, { type: file.type, size: file.size });
  if (!ticket.ok) return ticket;
  const { error } = await createClient().storage.from(MEDIA_BUCKET).uploadToSignedUrl(ticket.path, ticket.token, file, { contentType: file.type });
  if (error) return { ok: false as const, error: "The upload didn't finish. Try again." };
  return attachUpload(moduleId, token, slideId, { path: ticket.path, alt });
}

function Visual({
  moduleId,
  token,
  slide,
  onSaved,
  onError,
  beforeFiles,
}: {
  moduleId: string;
  token: string | null;
  slide: Slide;
  onSaved: (p: Partial<Slide>) => void;
  onError: (e: string) => void;
  beforeFiles: () => Promise<boolean>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [link, setLink] = useState("");
  const [alt, setAlt] = useState(slide.visual?.alt ?? "");
  const v = slide.visual;
  useEffect(() => setAlt(slide.visual?.alt ?? ""), [slide.visual?.id, slide.visual?.alt]);

  async function upload(file: File) {
    if (!token) return;
    setBusy("Uploading…");
    await beforeFiles();
    const r = await uploadToSlide(moduleId, token, slide.id, file, "");
    setBusy(null);
    if (!r.ok) return onError(r.error);
    if (r.media.role === "visual") onSaved({ visual: r.media });
    else if (r.slide) onSaved({ narration: r.slide.narration, narrationVoiced: r.slide.narrationVoiced });
  }

  async function useLink() {
    if (!token) return;
    setBusy("Adding…");
    const r = await attachVideoLink(moduleId, token, slide.id, link);
    setBusy(null);
    if (!r.ok) return onError(r.error);
    setLink("");
    onSaved({ visual: r.media });
  }

  async function remove() {
    if (!token || !window.confirm("Remove the picture or video from this slide? The file is deleted.")) return;
    const r = await removeSlideMedia(moduleId, token, slide.id, "visual");
    if (!r.ok) return onError(r.error);
    onSaved({ visual: null });
  }

  async function saveAlt() {
    if (!token || !v || alt === v.alt) return;
    const r = await updateMediaAlt(moduleId, token, v.id, alt);
    if (!r.ok) return onError(r.error);
    onSaved({ visual: { ...v, alt } });
  }

  return (
    <div className="be-stack">
      {v && (
        <div className="be-media">
          {v.kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={v.url} alt="" className="be-media__thumb" />
          ) : (
            <span className="card__meta">Video: {v.source === "link" ? v.url : "uploaded file"}</span>
          )}
          <PhotoCreditLine credit={v.credit} />
        </div>
      )}
      <div className="be-row">
        <input ref={input} type="file" hidden accept="image/*,video/mp4,video/webm,video/quicktime" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        <button type="button" className="button button-secondary button-small" disabled={Boolean(busy)} onClick={() => input.current?.click()}>
          {busy ?? (v ? "Replace with a file" : "Upload a picture or video")}
        </button>
        <button type="button" className="button button-secondary button-small" disabled={Boolean(busy)} onClick={() => setPicking(true)}>
          Find a photo
        </button>
        {v && (
          <button type="button" className="text-action" onClick={remove}>
            Remove
          </button>
        )}
      </div>
      <div className="be-row">
        <input className="be-grow" value={link} placeholder="Or paste a YouTube or Vimeo link" onChange={(e) => setLink(e.target.value)} aria-label="Video link" />
        <button type="button" className="button button-secondary button-small" disabled={!link.trim() || Boolean(busy)} onClick={useLink}>
          Use video
        </button>
      </div>
      {v?.kind === "image" && (
        <label>
          <span className="be-label">Describe the picture (for screen readers)</span>
          <input value={alt} maxLength={500} onChange={(e) => setAlt(e.target.value)} onBlur={saveAlt} data-testid="visual-alt" />
        </label>
      )}
      {picking && token && (
        <PhotoPicker
          moduleId={moduleId}
          initialQuery={slide.title}
          onClose={() => setPicking(false)}
          onPick={async (p) => {
            setPicking(false);
            setBusy("Adding…");
            const r = await attachStockPhoto(moduleId, token, slide.id, p);
            setBusy(null);
            if (!r.ok) return onError(r.error);
            onSaved({ visual: r.media });
          }}
        />
      )}
    </div>
  );
}

function Narration({
  moduleId,
  token,
  slide,
  voice,
  onChange,
  onSaved,
  onError,
  beforeFiles,
}: {
  moduleId: string;
  token: string | null;
  slide: Slide;
  voice: Voiced;
  onChange: (p: SlidePatch) => void;
  onSaved: (p: Partial<Slide>) => void;
  onError: (e: string) => void;
  beforeFiles: () => Promise<boolean>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [earlier, setEarlier] = useState<EarlierNarration[] | null>(null);
  const stale = narrationOutOfDate(slide);

  async function make() {
    if (!token) return;
    if (!voice) return onError("Choose a narration voice first, in Module settings.");
    if (slide.narration && !stale && !window.confirm("This slide already has narration for this script. Make it again (this uses ElevenLabs credits)?")) return;
    setBusy("Making narration…");
    await beforeFiles();
    const r = await generateNarration(moduleId, token, slide.id, slide.narrationScript, voice.id);
    setBusy(null);
    if (!r.ok) return onError(r.error);
    onSaved({ narration: r.media, narrationVoiced: r.voiced, narrationScript: r.voiced });
  }

  async function upload(file: File) {
    if (!token) return;
    setBusy("Uploading…");
    await beforeFiles();
    const r = await uploadToSlide(moduleId, token, slide.id, file, "");
    setBusy(null);
    if (!r.ok) return onError(r.error);
    if (r.slide) onSaved({ narration: r.slide.narration, narrationVoiced: r.slide.narrationVoiced });
  }

  async function remove() {
    if (!token || !window.confirm("Remove this slide's narration? The audio file is deleted.")) return;
    const r = await removeSlideMedia(moduleId, token, slide.id, "narration");
    if (!r.ok) return onError(r.error);
    onSaved({ narration: null, narrationVoiced: "" });
  }

  async function showEarlier() {
    const r = await listEarlierNarration(moduleId);
    if (!r.ok) return onError(r.error);
    setEarlier(r.files);
  }

  async function choose(f: EarlierNarration) {
    if (!token) return;
    setBusy("Copying…");
    await beforeFiles();
    const r = await applyEarlierNarration(moduleId, token, slide.id, f.path);
    setBusy(null);
    if (!r.ok) return onError(r.error);
    setEarlier(null);
    onSaved({ narration: r.media, narrationVoiced: r.voiced });
  }

  return (
    <section className="builder__block">
      <div className="builder__block-head">
        <span className="builder__block-type">Narration</span>
      </div>
      <div className="be-stack">
        <label>
          <span className="be-label">Script (what the narrator says)</span>
          <textarea rows={5} value={slide.narrationScript} maxLength={5000} onChange={(e) => onChange({ narrationScript: e.target.value })} data-testid="slide-script" />
        </label>
        {slide.narration && (
          <div className="be-row">
            <audio src={slide.narration.url} controls preload="none" aria-label="This slide's narration" />
            {stale && <span className="builder__stale">The script changed after this audio was made.</span>}
          </div>
        )}
        <div className="be-row">
          <button type="button" className="button button-primary button-small" disabled={Boolean(busy) || !slide.narrationScript.trim()} onClick={make}>
            {busy ?? (slide.narration ? "Make the narration again" : "Make narration")}
          </button>
          <span className="card__meta">Voice: {voice?.name ?? "not chosen (Module settings)"}</span>
        </div>
        <div className="be-row">
          <input ref={input} type="file" hidden accept="audio/*" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          <button type="button" className="text-action" disabled={Boolean(busy)} onClick={() => input.current?.click()}>
            Upload a recording
          </button>
          <button type="button" className="text-action" disabled={Boolean(busy)} onClick={showEarlier}>
            Use narration made earlier
          </button>
          {slide.narration && (
            <button type="button" className="text-action" onClick={remove}>
              Remove narration
            </button>
          )}
        </div>
        {earlier && (
          <div className="builder__earlier">
            <p className="card__meta">
              Narration made with the old builder for this module. Listen, and choose the one that matches this slide&rsquo;s script.
            </p>
            {earlier.length === 0 ? (
              <p className="card__meta">There&rsquo;s none for this module.</p>
            ) : (
              <ul>
                {earlier.map((f, i) => (
                  <li key={f.path}>
                    <span>Recording {i + 1}</span>
                    <audio src={f.url} controls preload="none" />
                    <button type="button" className="button button-secondary button-small" onClick={() => choose(f)} disabled={Boolean(busy)}>
                      Use on this slide
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button type="button" className="text-action" onClick={() => setEarlier(null)}>
              Close
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

// ── Interactive element ──────────────────────────────────────────────────

function ElementEditor({ element, onChange }: { element: SlideElement | null; onChange: (e: SlideElement | null) => void }) {
  return (
    <section className="builder__block">
      <div className="builder__block-head">
        <span className="builder__block-type">Interactive element</span>
      </div>
      <div className="builder__devices builder__layouts" role="group" aria-label="Interactive element">
        <button type="button" data-active={!element} onClick={() => element && window.confirm("Remove the interactive element?") && onChange(null)}>
          None
        </button>
        {(Object.keys(elementLabels) as ElementType[]).map((t) => (
          <button
            key={t}
            type="button"
            data-active={element?.type === t}
            onClick={() => {
              if (element?.type === t) return;
              if (element && !window.confirm(`Replace the ${elementLabels[element.type].toLowerCase()} with ${elementLabels[t].toLowerCase()}?`)) return;
              onChange(newElement(t));
            }}
          >
            {elementLabels[t]}
          </button>
        ))}
      </div>
      {element?.type === "knowledge_check" && (
        <div className="be-stack">
          <label>
            <span className="be-label">Question</span>
            <input value={element.question} maxLength={400} onChange={(e) => onChange({ ...element, question: e.target.value })} />
          </label>
          <p className="card__meta">One right answer. Wrong answers should sound plausible but be clearly wrong.</p>
          {element.options.map((o, i) => (
            <div key={o.id} className="be-row">
              <label className="be-check" title="The right answer">
                <input type="radio" name="kc-correct" checked={element.correctId === o.id} onChange={() => onChange({ ...element, correctId: o.id })} />
                {element.correctId === o.id ? "Right" : "Wrong"}
              </label>
              <input
                className="be-grow"
                value={o.text}
                maxLength={300}
                placeholder={`Answer ${i + 1}`}
                onChange={(e) => onChange({ ...element, options: element.options.map((x) => (x.id === o.id ? { ...x, text: e.target.value } : x)) })}
              />
              <button
                type="button"
                className="be-icon be-icon--danger"
                disabled={element.options.length <= 2}
                aria-label={`Remove answer ${i + 1}`}
                onClick={() => {
                  const options = element.options.filter((x) => x.id !== o.id);
                  onChange({ ...element, options, correctId: element.correctId === o.id ? options[0].id : element.correctId });
                }}
              >
                &times;
              </button>
            </div>
          ))}
          {element.options.length < 5 && (
            <button type="button" className="text-action" onClick={() => onChange({ ...element, options: [...element.options, { id: newId("o"), text: "" }] })}>
              + Add an answer
            </button>
          )}
          <label>
            <span className="be-label">Why the right answer is right (shown after answering)</span>
            <textarea rows={2} value={element.explanation} maxLength={600} onChange={(e) => onChange({ ...element, explanation: e.target.value })} />
          </label>
          <WordCount words={countWords(element.explanation)} max={ITEM_WORDS_MAX} />
        </div>
      )}
      {element?.type === "accordion" && (
        <Items
          items={element.items.map((i) => ({ id: i.id, a: i.title, b: i.body }))}
          labels={["Heading", "Text"]}
          onChange={(items) => onChange({ ...element, items: items.map((i) => ({ id: i.id, title: i.a, body: i.b })) })}
        />
      )}
      {element?.type === "flip_cards" && (
        <Items
          items={element.items.map((i) => ({ id: i.id, a: i.front, b: i.back }))}
          labels={["Front", "Back"]}
          onChange={(items) => onChange({ ...element, items: items.map((i) => ({ id: i.id, front: i.a, back: i.b })) })}
        />
      )}
    </section>
  );
}

function Items({ items, labels, onChange }: { items: { id: string; a: string; b: string }[]; labels: [string, string]; onChange: (i: { id: string; a: string; b: string }[]) => void }) {
  const set = (id: string, p: Partial<{ a: string; b: string }>) => onChange(items.map((i) => (i.id === id ? { ...i, ...p } : i)));
  return (
    <div className="be-stack">
      {items.map((it, n) => (
        <div key={it.id} className="be-item">
          <div className="be-item__head">
            <strong>{n + 1}</strong>
            <button type="button" className="be-icon be-icon--danger" disabled={items.length <= 2} aria-label={`Remove ${n + 1}`} onClick={() => onChange(items.filter((i) => i.id !== it.id))}>
              &times;
            </button>
          </div>
          <input value={it.a} maxLength={120} placeholder={labels[0]} aria-label={labels[0]} onChange={(e) => set(it.id, { a: e.target.value })} />
          <textarea rows={2} value={it.b} maxLength={600} placeholder={labels[1]} aria-label={labels[1]} onChange={(e) => set(it.id, { b: e.target.value })} />
          <WordCount words={countWords(it.b)} max={ITEM_WORDS_MAX} />
        </div>
      ))}
      {items.length < 6 && (
        <button type="button" className="text-action" onClick={() => onChange([...items, { id: newId("i"), a: "", b: "" }])}>
          + Add another
        </button>
      )}
    </div>
  );
}

// ── Citations: library sections only ─────────────────────────────────────

function Citations({
  moduleId,
  slide,
  onChange,
  onError,
}: {
  moduleId: string;
  slide: Slide;
  onChange: (c: Slide["citations"]) => void;
  onError: (e: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<LibraryHit[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function search() {
    setBusy(true);
    const r = await searchCitations(moduleId, query);
    setBusy(false);
    if (!r.ok) return onError(r.error);
    setHits(r.hits);
  }

  return (
    <section className="builder__block">
      <div className="builder__block-head">
        <span className="builder__block-type">Sources</span>
      </div>
      <p className="card__meta">The Legislation Library sections this slide relies on. Only sections in the library can be chosen.</p>
      {slide.citations.length > 0 && (
        <ul className="builder__citations">
          {slide.citations.map((c) => (
            <li key={c.chunkId}>
              <span>{c.label || "Library section"}</span>
              <button type="button" className="text-action" onClick={() => onChange(slide.citations.filter((x) => x.chunkId !== c.chunkId))}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="be-row"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <input className="be-grow" value={query} maxLength={300} placeholder='Section number ("45") or words ("notice of general meetings")' onChange={(e) => setQuery(e.target.value)} aria-label="Search the library" />
        <button className="button button-secondary button-small" disabled={busy || !query.trim()}>
          {busy ? "Searching…" : "Search"}
        </button>
      </form>
      {hits && (
        <ul className="builder__hits">
          {hits.length === 0 && <li className="card__meta">Nothing in the library matches. Try other words.</li>}
          {hits.map((h) => {
            const added = slide.citations.some((c) => c.chunkId === h.chunkId);
            return (
              <li key={h.chunkId}>
                <div>
                  <strong>{h.label}</strong>
                  <p className="card__meta">{h.snippet}</p>
                </div>
                <button
                  type="button"
                  className="button button-secondary button-small"
                  disabled={added || slide.citations.length >= 8}
                  onClick={() => onChange([...slide.citations, { chunkId: h.chunkId, label: h.label }])}
                >
                  {added ? "Added" : "Cite"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ── Module settings ──────────────────────────────────────────────────────

function Settings({
  moduleId,
  objectives,
  reading,
  voice,
  defaultVoice,
  canSetDefault,
  onObjectives,
  onReading,
  onVoice,
  onDefaultVoice,
}: {
  moduleId: string;
  objectives: Objective[];
  reading: FurtherReading[];
  voice: Voiced;
  defaultVoice: Voiced;
  canSetDefault: boolean;
  onObjectives: (o: Objective[]) => void;
  onReading: (r: FurtherReading[]) => void;
  onVoice: (v: Voiced) => void;
  onDefaultVoice: (v: Voiced) => void;
}) {
  return (
    <div className="builder__canvas">
      <h2 className="builder__lesson-title">Module settings</h2>
      <section className="builder__block">
        <div className="builder__block-head">
          <span className="builder__block-type">Learning objectives</span>
        </div>
        <p className="card__meta">
          One to three things the learner can do by the end, each starting with a verb at its Bloom level. They open and close the module.
        </p>
        <div className="be-stack">
          {objectives.map((o, i) => (
            <div key={i} className="be-row">
              <select
                value={o.bloom}
                aria-label={`Bloom level for objective ${i + 1}`}
                onChange={(e) => onObjectives(objectives.map((x, n) => (n === i ? { ...x, bloom: e.target.value as Bloom } : x)))}
              >
                {BLOOM_LEVELS.map((b) => (
                  <option key={b} value={b}>
                    {bloomLabels[b]}
                  </option>
                ))}
              </select>
              <input
                className="be-grow"
                value={o.text}
                maxLength={300}
                placeholder={`e.g. ${bloomVerbs[o.bloom].split(", ")[0]} …`}
                aria-label={`Objective ${i + 1}`}
                onChange={(e) => {
                  const text = e.target.value;
                  // Follow the verb while the author hasn't chosen a level by hand.
                  const bloom = o.bloom === bloomFor(o.text) ? bloomFor(text) : o.bloom;
                  onObjectives(objectives.map((x, n) => (n === i ? { text, bloom } : x)));
                }}
              />
              <button type="button" className="be-icon be-icon--danger" aria-label={`Remove objective ${i + 1}`} onClick={() => onObjectives(objectives.filter((_, n) => n !== i))}>
                &times;
              </button>
            </div>
          ))}
          {objectives.length < OBJECTIVES_MAX && (
            <button type="button" className="text-action" onClick={() => onObjectives([...objectives, { text: "", bloom: "understand" }])}>
              + Add an objective
            </button>
          )}
          <p className="card__meta">
            Verbs by level:{" "}
            {BLOOM_LEVELS.slice(0, 4)
              .map((b) => `${bloomLabels[b]}: ${bloomVerbs[b]}`)
              .join(" · ")}
          </p>
        </div>
      </section>

      <VoicePicker moduleId={moduleId} voice={voice} defaultVoice={defaultVoice} canSetDefault={canSetDefault} onVoice={onVoice} onDefaultVoice={onDefaultVoice} />

      <section className="builder__block" data-testid="further-reading-editor">
        <div className="builder__block-head">
          <span className="builder__block-type">Further reading</span>
        </div>
        <p className="card__meta">Optional links for keen learners, shown at the end of the module. https:// links only.</p>
        <div className="be-stack">
          {reading.map((r, i) => (
            <div key={i} className="be-item">
              <div className="be-item__head">
                <strong>{i + 1}</strong>
                <button type="button" className="be-icon be-icon--danger" aria-label={`Remove link ${i + 1}`} onClick={() => onReading(reading.filter((_, n) => n !== i))}>
                  &times;
                </button>
              </div>
              <input value={r.title} maxLength={200} placeholder="Title" aria-label="Title" onChange={(e) => onReading(reading.map((x, n) => (n === i ? { ...x, title: e.target.value } : x)))} />
              <input value={r.url} maxLength={1000} placeholder="https://" aria-label="Link" onChange={(e) => onReading(reading.map((x, n) => (n === i ? { ...x, url: e.target.value } : x)))} />
              <input value={r.note} maxLength={300} placeholder="Why it's worth reading (optional)" aria-label="Note" onChange={(e) => onReading(reading.map((x, n) => (n === i ? { ...x, note: e.target.value } : x)))} />
            </div>
          ))}
          {reading.length < 10 && (
            <button type="button" className="text-action" onClick={() => onReading([...reading, { title: "", url: "", note: "" }])}>
              + Add a link
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

function VoicePicker({
  moduleId,
  voice,
  defaultVoice,
  canSetDefault,
  onVoice,
  onDefaultVoice,
}: {
  moduleId: string;
  voice: Voiced;
  defaultVoice: Voiced;
  canSetDefault: boolean;
  onVoice: (v: Voiced) => void;
  onDefaultVoice: (v: Voiced) => void;
}) {
  const [voices, setVoices] = useState<Voice[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [voiceId, setVoiceId] = useState("");
  const current = voice ?? defaultVoice;
  const shown = (voices ?? []).filter((v) => `${v.name} ${v.description}`.toLowerCase().includes(search.trim().toLowerCase()));

  async function load() {
    setLoading(true);
    setError(null);
    const r = await getNarrationVoices(moduleId);
    setLoading(false);
    if (!r.ok) return setError(r.error);
    setVoices(r.voices);
  }
  async function lookUp() {
    setError(null);
    const r = await findVoice(moduleId, voiceId);
    if (!r.ok) return setError(r.error);
    setVoices((vs) => [r.voice, ...(vs ?? []).filter((v) => v.id !== r.voice.id)]);
    setVoiceId("");
  }
  async function everywhere(v: { id: string; name: string }) {
    const r = await setDefaultVoice(v);
    if (!r.ok) return setError(r.error);
    onDefaultVoice(v);
    onVoice(null);
    setVoices(null);
  }

  return (
    <section className="builder__block">
      <div className="builder__block-head">
        <span className="builder__block-type">Narration voice</span>
      </div>
      <div className="be-row">
        <span>
          Voice: <strong>{current?.name ?? "not chosen"}</strong>{" "}
          {current && <span className="card__meta">({voice ? "this module only" : "the default for every module"})</span>}
        </span>
        <button type="button" className="button button-secondary button-small" onClick={load} disabled={loading}>
          {loading ? "Loading voices…" : current ? "Change voice" : "Choose a voice"}
        </button>
        {voice && defaultVoice && (
          <button type="button" className="text-action" onClick={() => onVoice(null)}>
            Use the default ({defaultVoice.name})
          </button>
        )}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {voices && (
        <>
          <div className="be-row voice-tools">
            <input className="be-grow" value={search} placeholder={`Search ${voices.length} voices`} aria-label="Search voices" onChange={(e) => setSearch(e.target.value)} />
            <input value={voiceId} placeholder="Or paste an ElevenLabs voice ID" aria-label="ElevenLabs voice ID" maxLength={64} onChange={(e) => setVoiceId(e.target.value)} />
            <button type="button" className="button button-secondary button-small" disabled={!voiceId.trim()} onClick={lookUp}>
              Find
            </button>
          </div>
          <ul className="voice-list">
            {shown.map((v) => (
              <li key={v.id} data-chosen={current?.id === v.id}>
                <div>
                  <strong>{v.name}</strong>
                  {v.description && <span className="card__meta"> &middot; {v.description}</span>}
                </div>
                {v.previewUrl ? <audio src={v.previewUrl} controls preload="none" aria-label={`Sample of ${v.name}`} /> : <span />}
                <span className="voice-list__actions">
                  {canSetDefault && (
                    <button type="button" className="button button-secondary button-small" onClick={() => everywhere({ id: v.id, name: v.name })}>
                      {defaultVoice?.id === v.id ? "Default for every module" : "Use for every module"}
                    </button>
                  )}
                  <button
                    type="button"
                    className="text-action"
                    onClick={() => {
                      onVoice({ id: v.id, name: v.name });
                      setVoices(null);
                    }}
                  >
                    This module only
                  </button>
                </span>
              </li>
            ))}
            {shown.length === 0 && <li className="card__meta">No voices match &ldquo;{search}&rdquo;.</li>}
          </ul>
        </>
      )}
    </section>
  );
}
