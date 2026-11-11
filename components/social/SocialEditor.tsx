"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  createSocialUpload,
  deleteSocialPost,
  noteSocialPhotoUse,
  redraftSocialSlide,
  saveSocialPost,
  saveSocialTemplate,
  searchSocialPhotos,
  signSocialUpload,
} from "@/app/admin/marketing/socials/actions";
import { ClipPicker } from "@/components/social/ClipPicker";
import { Modal } from "@/components/Modal";
import { PhotoPicker, PhotoCreditLine } from "@/components/training/PhotoPicker";
import { ScaledSlide, SlideCanvas } from "@/components/social/SlideCanvas";
import { DesignEditor } from "@/components/social/DesignEditor";
import { designFromSlide, roleTexts, withRoleTexts, type SlideDesign } from "@/lib/social/design";
import { socialFontClass } from "@/components/social/fonts";
import { buildExportZip, exportFileName } from "@/lib/social/export-client";
import {
  DESTINATIONS,
  emptySlide,
  LIMITS,
  normalizeHashtag,
  PLATFORMS,
  PLATFORM_INFO,
  postText,
  postTexts,
  SLIDE_KIND_LABELS,
  SLIDE_KINDS,
  slidesFor,
  TEMPLATE_LABELS,
  TEMPLATES,
  THEME_LABELS,
  THEMES,
  wordingProblems,
  xLength,
  type Destination,
  type Platform,
  type SlideKind,
  type SocialClip,
  type SocialPhoto,
  type SocialPost,
  type SocialSlide,
  type Template,
  type Theme,
  slideNumbersShown,
} from "@/lib/social/post";

const SOCIAL_BUCKET = "social-media";

/**
 * The Social tab's editor (0068): the AI's draft, editable like a Council
 * Training module. Changes save on their own after a pause. The preview is
 * the export: the same canvas, scaled down.
 */
/** Slides made before the editor had layers get a design from their kind and words (saved on the first change). */
function withDesigns(p: SocialPost): SocialPost {
  return { ...p, slides: p.slides.map((s, index) => (s.design ? s : { ...s, design: designFromSlide(s, { template: p.template, theme: p.theme, index }) })) };
}

export function SocialEditor({ initial }: { initial: SocialPost }) {
  const router = useRouter();
  const [post, setPost] = useState(() => withDesigns(initial));
  const [current, setCurrent] = useState(0);
  const [platform, setPlatform] = useState<Platform>("instagram");
  const [captionTab, setCaptionTab] = useState<Platform>("instagram");
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [exporting, setExporting] = useState<{ done: number; total: number; detail?: string } | null>(null);
  const [clipPicker, setClipPicker] = useState<string | null>(null);
  const clipResolve = useRef<((c: SocialClip | null) => void) | null>(null);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Each change bumps the version; a save confirms the version it sent. Unsaved
  // while they differ, so leaving mid-save or after a failed save still warns.
  const version = useRef(initial.slides.some((s) => !s.design) ? 1 : 0);
  const savedVersion = useRef(0);
  const unsaved = () => version.current !== savedVersion.current;
  const findResolve = useRef<((p: SocialPhoto | null) => void) | null>(null);
  const [pickerQuery, setPickerQuery] = useState("");
  const stageRef = useRef<HTMLDivElement>(null);

  // ── Saving ──────────────────────────────────────────────────────────
  const update = useCallback((fn: (p: SocialPost) => SocialPost) => {
    version.current += 1;
    setPost(fn);
  }, []);

  const latest = useRef(post);
  latest.current = post;

  /** Save what's on screen now. Safe to call when nothing has changed. */
  const flush = useCallback(async () => {
    if (!unsaved()) return;
    const sent = version.current;
    const p = latest.current;
    setSaveState("saving");
    const r = await saveSocialPost(p.id, {
      title: p.title,
      campaign: p.campaign,
      template: p.template,
      theme: p.theme,
      destination: p.destination,
      slides: p.slides,
      captions: p.captions,
      showSlideNumbers: p.showSlideNumbers,
    }).catch(() => ({ ok: false as const, error: "Couldn't reach the server. Your changes are kept on this screen." }));
    if (r.ok) {
      savedVersion.current = Math.max(savedVersion.current, sent);
      setError(null);
    } else setError(r.error);
    setSaveState(r.ok ? (version.current === savedVersion.current ? "saved" : "saving") : "error");
  }, []);

  useEffect(() => {
    if (!unsaved()) return;
    setSaveState("saving");
    const t = setTimeout(flush, 800);
    return () => clearTimeout(t);
  }, [post, flush]);

  // Leaving the editor inside the pause (All posts, another tab, Back) saves
  // straight away instead of dropping the last change.
  useEffect(() => () => void flush(), [flush]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (unsaved()) e.preventDefault();
    };
    const hidden = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [flush]);

  const slide = post.slides[current] ?? null;
  const patchSlide = (patch: Partial<SocialSlide>) =>
    update((p) => ({ ...p, slides: p.slides.map((s, i) => (i === current ? { ...s, ...patch } : s)) }));
  const setDesign = useCallback(
    (design: SlideDesign, fields?: Partial<SocialSlide>) =>
      update((p) => ({ ...p, slides: p.slides.map((s, i) => (i === current ? { ...s, ...fields, design } : s)) })),
    [current, update]
  );

  // ── Slides ──────────────────────────────────────────────────────────
  function addSlide(kind: SlideKind) {
    if (post.slides.length >= LIMITS.slides) return setError(`A post can have up to ${LIMITS.slides} slides.`);
    const at = Math.min(current + 1, post.slides.length);
    const fresh = { ...emptySlide(kind), title: kind === "cta" ? "Start free council training" : "Your title", number: kind === "point" ? String(at) : "" };
    const s: SocialSlide = { ...fresh, design: designFromSlide(fresh, { template: post.template, theme: post.theme, index: at }) };
    update((p) => ({ ...p, slides: [...p.slides.slice(0, at), s, ...p.slides.slice(at)] }));
    setCurrent(at);
  }
  function moveSlide(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= post.slides.length) return;
    update((p) => {
      const slides = [...p.slides];
      [slides[i], slides[j]] = [slides[j], slides[i]];
      return { ...p, slides };
    });
    setCurrent(j);
  }
  function removeSlide(i: number) {
    if (!window.confirm(`Remove slide ${i + 1}?`)) return;
    update((p) => ({ ...p, slides: p.slides.filter((_, k) => k !== i) }));
    setCurrent((c) => Math.max(0, Math.min(c, post.slides.length - 2)));
  }

  async function rewrite() {
    if (!slide) return;
    setBusy("rewrite");
    setError(null);
    const r = await redraftSocialSlide(post.id, post.slides, current, instruction);
    setBusy(null);
    if (!r.ok) return setError(r.error);
    const words = { number: r.slide.number, kicker: r.slide.kicker, title: r.slide.title, body: r.slide.body };
    patchSlide({ ...words, photoQuery: r.slide.photoQuery, design: slide.design ? withRoleTexts(slide.design, words) : null });
    setInstruction("");
  }

  // ── Photos ──────────────────────────────────────────────────────────
  async function upload(file: File): Promise<SocialPhoto | null> {
    setError(null);
    const ticket = await createSocialUpload(post.id, { type: file.type, size: file.size });
    if (!ticket.ok) {
      setError(ticket.error);
      return null;
    }
    const { error: upError } = await createClient().storage.from(SOCIAL_BUCKET).uploadToSignedUrl(ticket.path, ticket.token, file, { contentType: file.type });
    if (upError) {
      setError("The upload didn't finish. Try again.");
      return null;
    }
    const signed = await signSocialUpload(post.id, ticket.path);
    if (!signed.ok) {
      setError(signed.error);
      return null;
    }
    // A PNG is usually a cut-out with a transparent background.
    return { path: ticket.path, src: signed.src, alt: "", credit: null, fit: file.type === "image/png" ? "cutout" : "cover" };
  }

  /** A video upload: its length and size read here first (a clip the browser can't play can't be exported either). */
  async function uploadClip(file: File): Promise<SocialClip | null> {
    setError(null);
    const meta = await new Promise<{ duration: number; width: number; height: number } | null>((resolve) => {
      const v = document.createElement("video");
      const url = URL.createObjectURL(file);
      v.preload = "metadata";
      v.muted = true;
      v.onloadedmetadata = () => {
        URL.revokeObjectURL(url);
        resolve(v.videoWidth && Number.isFinite(v.duration) ? { duration: v.duration, width: v.videoWidth, height: v.videoHeight } : null);
      };
      v.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      v.src = url;
    });
    if (!meta) {
      setError("This browser can't play that video. Export it as an MP4 (H.264) and try again.");
      return null;
    }
    const ticket = await createSocialUpload(post.id, { type: file.type, size: file.size });
    if (!ticket.ok) {
      setError(ticket.error);
      return null;
    }
    const { error: upError } = await createClient().storage.from(SOCIAL_BUCKET).uploadToSignedUrl(ticket.path, ticket.token, file, { contentType: file.type });
    if (upError) {
      setError("The upload didn't finish. Try again.");
      return null;
    }
    const signed = await signSocialUpload(post.id, ticket.path);
    if (!signed.ok) {
      setError(signed.error);
      return null;
    }
    return { path: ticket.path, src: signed.src, duration: Math.round(meta.duration * 100) / 100, width: meta.width, height: meta.height, credit: null };
  }

  /** The Pixabay picker, for the editor: resolves with the copied clip, or null if closed. */
  const findClip = useCallback((query: string) => {
    clipResolve.current?.(null);
    setClipPicker(query);
    return new Promise<SocialClip | null>((resolve) => {
      clipResolve.current = resolve;
    });
  }, []);
  function closeClipPicker(clip: SocialClip | null) {
    setClipPicker(null);
    clipResolve.current?.(clip);
    clipResolve.current = null;
  }

  /** The photo picker, for the editor: resolves with the chosen photo, or null if closed. */
  const findPhoto = useCallback((query: string) => {
    findResolve.current?.(null);
    setPickerQuery(query);
    setPicker(true);
    return new Promise<SocialPhoto | null>((resolve) => {
      findResolve.current = resolve;
    });
  }, []);
  function closePicker(photo: SocialPhoto | null) {
    setPicker(false);
    findResolve.current?.(photo);
    findResolve.current = null;
  }

  // ── Export and delete ───────────────────────────────────────────────
  async function exportZip() {
    setError(null);
    setExporting({ done: 0, total: 1 });
    // The stage is drawn once exporting starts: wait for it to be on the page.
    for (let i = 0; i < 20 && !stageRef.current; i++) await new Promise((r) => setTimeout(r, 50));
    try {
      if (!stageRef.current) throw new Error("The export stage didn't appear.");
      const blob = await buildExportZip(post, stageRef.current, (done, total, detail) => setExporting({ done, total, detail }));
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = exportFileName(post);
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      console.error("[export]", err);
      setError(err instanceof Error && err.name !== "Error" && err.message ? err.message : "The export didn't finish. A photo or clip may not have loaded; reload the page and try again.");
    }
    setExporting(null);
  }

  async function remove() {
    if (!window.confirm("Delete this post for good? Its slides, captions, and uploaded pictures are removed and can't be recovered.")) return;
    setBusy("delete");
    const r = await deleteSocialPost(post.id);
    setBusy(null);
    if (!r.ok) return setError(r.error);
    savedVersion.current = version.current;
    router.push("/admin/marketing/socials");
  }

  const problems = useMemo(() => wordingProblems(postTexts(post)), [post]);

  return (
    <div className={`social-editor ${socialFontClass}`} data-testid="social-editor">
      <header className="se-top">
        <Link href="/admin/marketing/socials" className="se-icon" title="All posts" aria-label="All posts">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </Link>
        <input
          className="se-top__title"
          value={post.title}
          maxLength={LIMITS.title}
          placeholder="Untitled post"
          aria-label="Post title (for the list only)"
          onChange={(e) => update((p) => ({ ...p, title: e.target.value }))}
          data-testid="social-title"
        />
        <span className="se-top__state" data-state={saveState} data-testid="social-save-state">
          {saveState === "saving" ? "Saving…" : saveState === "error" ? "Not saved" : "Saved"}
        </span>
        <span className="se-top__actions">
          <button type="button" className="button button-secondary button-small" aria-expanded={settingsOpen} onClick={() => setSettingsOpen((v) => !v)} data-testid="social-settings">
            Post settings
          </button>
          <button type="button" className="button button-secondary button-small" onClick={() => setTemplateOpen(true)} disabled={post.slides.length === 0} data-testid="social-save-template">
            Save as template
          </button>
          <button type="button" className="button button-primary button-small" onClick={exportZip} disabled={exporting !== null || post.slides.length === 0} data-testid="social-export">
            {exporting ? `Exporting ${exporting.done} of ${exporting.total}…` : "Export"}
          </button>
        </span>
      </header>
      {exporting?.detail && (
        <p className="se-hint" role="status" data-testid="social-export-detail">
          Making video: {exporting.detail}. Keep this tab open.
        </p>
      )}

      {error && (
        <p className="form-alert" role="alert">
          {error}
        </p>
      )}
      {problems.length > 0 && (
        <div className="form-alert" role="status" data-testid="social-problems">
          <strong>Fix before posting:</strong>
          <ul>
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      {settingsOpen && (
        <section className="se-settings" aria-label="Post settings">
          <label className="field">
            <span>Campaign (utm_campaign)</span>
            <input
              value={post.campaign}
              maxLength={60}
              onChange={(e) => update((p) => ({ ...p, campaign: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 60) }))}
              data-testid="social-campaign"
            />
          </label>
          <label className="field">
            <span>Links go to</span>
            <select value={post.destination} onChange={(e) => update((p) => ({ ...p, destination: e.target.value as Destination }))}>
              {(Object.keys(DESTINATIONS) as Destination[]).map((d) => (
                <option key={d} value={d}>
                  {DESTINATIONS[d].label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Look for new slides</span>
            <select value={post.template} onChange={(e) => update((p) => ({ ...p, template: e.target.value as Template }))} data-testid="social-template">
              {TEMPLATES.map((t) => (
                <option key={t} value={t}>
                  {TEMPLATE_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Colours for new slides</span>
            <select value={post.theme} onChange={(e) => update((p) => ({ ...p, theme: e.target.value as Theme }))} data-testid="social-theme">
              {THEMES.map((t) => (
                <option key={t} value={t}>
                  {THEME_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="checkbox-field se-settings__check">
            <input type="checkbox" checked={slideNumbersShown(post)} onChange={(e) => update((p) => ({ ...p, showSlideNumbers: e.target.checked }))} data-testid="social-slide-numbers" /> Slide numbers (01 / 05)
          </label>
          <button type="button" className="link-button agenda-danger se-settings__delete" onClick={remove} disabled={busy !== null || exporting !== null} data-testid="social-delete">
            Delete post
          </button>
        </section>
      )}

      {slide?.design ? (
        <DesignEditor
          post={post}
          index={current}
          platform={platform}
          onPlatform={setPlatform}
          onChange={setDesign}
          onError={setError}
          findPhoto={findPhoto}
          uploadPhoto={upload}
          findClip={findClip}
          uploadClip={uploadClip}
          slides={
            <>
              <ol className="se-slides">
                {post.slides.map((s, i) => (
                  <li key={s.id} data-active={i === current}>
                    <button type="button" className="se-slides__thumb" onClick={() => setCurrent(i)} aria-label={`Slide ${i + 1}: ${s.title || SLIDE_KIND_LABELS[s.kind]}`} aria-current={i === current}>
                      <ScaledSlide scale={88 / 1080} width={1080} height={1350}>
                        <SlideCanvas post={post} slide={s} index={i} total={post.slides.length} platform="instagram" />
                      </ScaledSlide>
                      <span className="se-slides__num">{i + 1}</span>
                    </button>
                    <span className="se-slides__tools">
                      <button type="button" onClick={() => moveSlide(i, -1)} disabled={i === 0} aria-label={`Move slide ${i + 1} up`} title="Move up">
                        &uarr;
                      </button>
                      <button type="button" onClick={() => moveSlide(i, 1)} disabled={i === post.slides.length - 1} aria-label={`Move slide ${i + 1} down`} title="Move down">
                        &darr;
                      </button>
                      <button type="button" onClick={() => removeSlide(i)} aria-label={`Remove slide ${i + 1}`} title="Remove">
                        &times;
                      </button>
                    </span>
                  </li>
                ))}
              </ol>
              <label className="se-slides__add" title="Add a slide">
                <span aria-hidden>+</span>
                <select value="" onChange={(e) => e.target.value && addSlide(e.target.value as SlideKind)} aria-label="Add a slide" data-testid="social-add-slide">
                  <option value="">Add a slide…</option>
                  {SLIDE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {SLIDE_KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
              </label>
            </>
          }
          slidePanel={
            <div className="field">
              <span>Rewrite the words with AI</span>
              <textarea rows={2} value={instruction} maxLength={500} placeholder="Optional: shorter, more practical, mention minutes…" onChange={(e) => setInstruction(e.target.value)} />
              <button type="button" className="button button-secondary button-small" onClick={rewrite} disabled={busy !== null} data-testid="social-rewrite">
                {busy === "rewrite" ? "Rewriting…" : "Rewrite slide"}
              </button>
            </div>
          }
          note={
            platform === "x" && slidesFor("x", post.slides).every((x) => x.index !== current) ? (
              <p className="se-note">X takes 4 pictures: this slide isn&rsquo;t one of them (the cover, the next two, and the call to action are).</p>
            ) : null
          }
        />
      ) : (
        <p className="card__meta">No slides yet. Add one.</p>
      )}

      <section className="se-captions" aria-label="Captions">
        <h2>Captions</h2>
        <div className="social-editor__platforms" role="tablist" aria-label="Caption for">
          {PLATFORMS.map((p) => (
            <button key={p} type="button" role="tab" aria-selected={captionTab === p} className="button button-secondary button-small" data-active={captionTab === p} onClick={() => setCaptionTab(p)}>
              {PLATFORM_INFO[p].label}
            </button>
          ))}
        </div>
        <CaptionEditor post={post} platform={captionTab} update={update} />
      </section>

      {picker && (
        <PhotoPicker
          searchWith={searchSocialPhotos}
          initialQuery={pickerQuery}
          onClose={() => closePicker(null)}
          onPick={async (p) => {
            const used = await noteSocialPhotoUse(p.downloadLocation);
            if (!used.ok) {
              setError(used.error);
              return closePicker(null);
            }
            closePicker({ path: null, src: p.src, alt: p.alt, credit: p.credit as SocialPhoto["credit"], fit: "cover" });
          }}
        />
      )}

      {clipPicker !== null && <ClipPicker postId={post.id} initialQuery={clipPicker} onClose={() => closeClipPicker(null)} onPick={(c) => closeClipPicker(c)} />}

      {templateOpen && <SaveTemplate post={post} onClose={() => setTemplateOpen(false)} />}

      {/* The export stage: every platform's slides at full size, off screen, for drawing to PNG. */}
      {exporting && (
        <div ref={stageRef} aria-hidden style={{ position: "fixed", left: -20000, top: 0, pointerEvents: "none" }}>
          {PLATFORMS.flatMap((p) =>
            slidesFor(p, post.slides).map(({ slide: s, index }) => (
              <div key={`${p}-${s.id}`} data-platform={p} data-index={index}>
                <SlideCanvas post={post} slide={s} index={index} total={post.slides.length} platform={p} />
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/** Save the post's slides as a template, to start other posts from. */
function SaveTemplate({ post, onClose }: { post: SocialPost; onClose: () => void }) {
  const [name, setName] = useState(post.title.slice(0, 60));
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const dropsMedia = post.slides.some((s) => s.design?.layers.some((l) => (l.type === "image" && l.photo?.path) || (l.type === "video" && l.clip)));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await saveSocialTemplate({ name, description, slides: post.slides, showSlideNumbers: post.showSlideNumbers });
    setBusy(false);
    setResult(r.ok ? { ok: true, message: "Saved. It's in the template library under New post." } : { ok: false, message: r.error });
  }

  return (
    <Modal title="Save as template" onClose={onClose}>
      <form onSubmit={save} style={{ display: "grid", gap: "0.9rem" }}>
        <p className="card__meta">The slides and their designs become a template in the library. Editing this post afterwards doesn&rsquo;t change the template.</p>
        <label className="field">
          <span>Name</span>
          <input value={name} maxLength={60} required autoFocus onChange={(e) => setName(e.target.value)} data-testid="template-name" />
        </label>
        <label className="field">
          <span>Description (optional)</span>
          <input value={description} maxLength={200} placeholder="e.g. A cover, five tips, and a call to action" onChange={(e) => setDescription(e.target.value)} />
        </label>
        {dropsMedia && <p className="card__meta">Uploaded photos and video clips stay with this post; the template keeps empty frames where they were. Unsplash photos are kept.</p>}
        {result && (
          <p className={result.ok ? "form-alert form-alert--ok" : "form-alert form-alert--error"} role="status">
            {result.message}
          </p>
        )}
        <div className="modal__actions">
          <button type="button" className="button button-secondary" onClick={onClose}>
            {result?.ok ? "Done" : "Cancel"}
          </button>
          {!result?.ok && (
            <button className="button button-primary" disabled={busy || !name.trim()} data-testid="template-save">
              {busy ? "Saving…" : "Save template"}
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}

function CaptionEditor({ post, platform, update }: { post: SocialPost; platform: Platform; update: (fn: (p: SocialPost) => SocialPost) => void }) {
  const text = post.captions.text[platform] ?? "";
  const tags = (post.captions.hashtags[platform] ?? []).join(" ");
  const [tagDraft, setTagDraft] = useState(tags);
  useEffect(() => setTagDraft(tags), [platform, tags]);
  const full = postText(post, platform);
  const xCount = platform === "x" ? xLength(full) : null;

  return (
    <div className="social-editor__caption">
      <label className="field field--wide">
        <span>{PLATFORM_INFO[platform].label} caption</span>
        <textarea
          rows={5}
          value={text}
          maxLength={LIMITS.caption}
          onChange={(e) => update((p) => ({ ...p, captions: { ...p.captions, text: { ...p.captions.text, [platform]: e.target.value } } }))}
          data-testid="social-caption"
        />
      </label>
      <label className="field field--wide">
        <span>Hashtags</span>
        <input
          value={tagDraft}
          onChange={(e) => setTagDraft(e.target.value)}
          onBlur={() => {
            const list = [...new Set(tagDraft.split(/[\s,]+/).map(normalizeHashtag).filter(Boolean))].slice(0, LIMITS.hashtags);
            update((p) => ({ ...p, captions: { ...p.captions, hashtags: { ...p.captions.hashtags, [platform]: list } } }));
          }}
          data-testid="social-hashtags"
        />
        {!/#stratasphere\b/i.test(tagDraft) && <span className="field__hint">Add #stratasphere where it fits.</span>}
      </label>
      <div className="field field--wide">
        <span>
          What gets posted
          {xCount !== null && (
            <span className={xCount > 280 ? "form-error" : "card__meta"} data-testid="social-x-count">
              {" "}
              ({xCount} of 280)
            </span>
          )}
        </span>
        <pre className="social-editor__post-text" data-testid="social-post-text">
          {full}
        </pre>
      </div>
    </div>
  );
}
