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
  searchSocialPhotos,
  signSocialUpload,
} from "@/app/admin/marketing/socials/actions";
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
  const [exporting, setExporting] = useState<{ done: number; total: number } | null>(null);
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
      const blob = await buildExportZip(post, stageRef.current, (done, total) => setExporting({ done, total }));
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = exportFileName(post);
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      console.error("[export]", err);
      setError("The export didn't finish. A photo may not have loaded; reload the page and try again.");
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
  const info = PLATFORM_INFO[platform];
  const previewScale = 520 / info.width;

  return (
    <div className={`social-editor ${socialFontClass}`} data-testid="social-editor">
      <div className="social-editor__bar">
        <Link href="/admin/marketing/socials" className="link-button">
          All posts
        </Link>
        <span className="card__meta" data-testid="social-save-state">
          {saveState === "saving" ? "Saving…" : saveState === "error" ? "Not saved" : "Saved"}
        </span>
        <span className="social-editor__bar-actions">
          <button type="button" className="button button-secondary" onClick={remove} disabled={busy !== null || exporting !== null} data-testid="social-delete">
            Delete post
          </button>
          <button type="button" className="button button-primary" onClick={exportZip} disabled={exporting !== null || post.slides.length === 0} data-testid="social-export">
            {exporting ? `Drawing ${exporting.done} of ${exporting.total}…` : "Export ZIP"}
          </button>
        </span>
      </div>

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

      <section className="card social-editor__settings">
        <label className="field field--wide">
          <span>Title (for this list only)</span>
          <input value={post.title} maxLength={LIMITS.title} onChange={(e) => update((p) => ({ ...p, title: e.target.value }))} data-testid="social-title" />
        </label>
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
        <label className="field checkbox-field">
          <span>
            <input
              type="checkbox"
              checked={slideNumbersShown(post)}
              onChange={(e) => update((p) => ({ ...p, showSlideNumbers: e.target.checked }))}
              data-testid="social-slide-numbers"
            />{" "}
            Slide numbers
          </span>
          <span className="field__hint">The &ldquo;01 / 05&rdquo; in the corner. Off by default for a single slide.</span>
        </label>
      </section>

      <div className="social-editor__main">
        <aside className="social-editor__slides" aria-label="Slides">
          <ol>
            {post.slides.map((s, i) => (
              <li key={s.id} data-active={i === current}>
                <button type="button" className="social-editor__thumb" onClick={() => setCurrent(i)} aria-label={`Slide ${i + 1}: ${s.title || SLIDE_KIND_LABELS[s.kind]}`}>
                  <ScaledSlide scale={110 / 1080} width={1080} height={1350}>
                    <SlideCanvas post={post} slide={s} index={i} total={post.slides.length} platform="instagram" />
                  </ScaledSlide>
                  <span>
                    {i + 1}. {SLIDE_KIND_LABELS[s.kind]}
                  </span>
                </button>
                <span className="social-editor__thumb-tools">
                  <button type="button" className="icon-button" onClick={() => moveSlide(i, -1)} disabled={i === 0} aria-label={`Move slide ${i + 1} up`}>
                    &uarr;
                  </button>
                  <button type="button" className="icon-button" onClick={() => moveSlide(i, 1)} disabled={i === post.slides.length - 1} aria-label={`Move slide ${i + 1} down`}>
                    &darr;
                  </button>
                  <button type="button" className="icon-button" onClick={() => removeSlide(i)} aria-label={`Remove slide ${i + 1}`}>
                    &times;
                  </button>
                </span>
              </li>
            ))}
          </ol>
          <label className="field">
            <span>Add a slide</span>
            <select value="" onChange={(e) => e.target.value && addSlide(e.target.value as SlideKind)} data-testid="social-add-slide">
              <option value="">Choose a kind…</option>
              {SLIDE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {SLIDE_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
        </aside>

        {slide?.design ? (
          <div className="social-editor__design">
            <DesignEditor post={post} index={current} platform={platform} onPlatform={setPlatform} onChange={setDesign} onError={setError} findPhoto={findPhoto} uploadPhoto={upload} />
            {platform === "x" && slidesFor("x", post.slides).every((x) => x.index !== current) && (
              <p className="card__meta">X takes 4 pictures: this slide isn&rsquo;t one of them (the cover, the next two, and the call to action are).</p>
            )}
            <div className="social-editor__rewrite">
              <label className="field">
                <span>Rewrite this slide&rsquo;s words with AI</span>
                <input value={instruction} maxLength={500} placeholder="Optional: what to change (shorter, more practical, mention minutes...)" onChange={(e) => setInstruction(e.target.value)} />
              </label>
              <button type="button" className="button button-secondary button-small" onClick={rewrite} disabled={busy !== null} data-testid="social-rewrite">
                {busy === "rewrite" ? "Rewriting…" : "Rewrite"}
              </button>
            </div>
          </div>
        ) : (
          <p className="card__meta">No slides yet. Add one.</p>
        )}
      </div>

      <section className="card social-editor__captions" aria-label="Captions">
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
