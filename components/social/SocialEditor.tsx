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
} from "@/app/admin/social/actions";
import { PhotoPicker, PhotoCreditLine } from "@/components/training/PhotoPicker";
import { ScaledSlide, SlideCanvas } from "@/components/social/SlideCanvas";
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
} from "@/lib/social/post";

const SOCIAL_BUCKET = "social-media";

/**
 * The Social tab's editor (0068): the AI's draft, editable like a Council
 * Training module. Changes save on their own after a pause. The preview is
 * the export: the same canvas, scaled down.
 */
export function SocialEditor({ initial }: { initial: SocialPost }) {
  const router = useRouter();
  const [post, setPost] = useState(initial);
  const [current, setCurrent] = useState(0);
  const [platform, setPlatform] = useState<Platform>("instagram");
  const [captionTab, setCaptionTab] = useState<Platform>("instagram");
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [exporting, setExporting] = useState<{ done: number; total: number } | null>(null);
  const dirty = useRef(false);
  const stageRef = useRef<HTMLDivElement>(null);

  // ── Saving ──────────────────────────────────────────────────────────
  const update = useCallback((fn: (p: SocialPost) => SocialPost) => {
    dirty.current = true;
    setPost(fn);
  }, []);

  useEffect(() => {
    if (!dirty.current) return;
    setSaveState("saving");
    const t = setTimeout(async () => {
      dirty.current = false;
      const r = await saveSocialPost(post.id, {
        title: post.title,
        campaign: post.campaign,
        template: post.template,
        theme: post.theme,
        destination: post.destination,
        slides: post.slides,
        captions: post.captions,
      }).catch(() => ({ ok: false as const, error: "Couldn't reach the server. Your changes are kept on this screen." }));
      setSaveState(r.ok ? "saved" : "error");
      if (!r.ok) setError(r.error);
    }, 800);
    return () => clearTimeout(t);
  }, [post]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const slide = post.slides[current] ?? null;
  const patchSlide = (patch: Partial<SocialSlide>) =>
    update((p) => ({ ...p, slides: p.slides.map((s, i) => (i === current ? { ...s, ...patch } : s)) }));
  const setPhoto = (photo: SocialPhoto | null) => patchSlide({ photo });

  // ── Slides ──────────────────────────────────────────────────────────
  function addSlide(kind: SlideKind) {
    if (post.slides.length >= LIMITS.slides) return setError(`A post can have up to ${LIMITS.slides} slides.`);
    const at = Math.min(current + 1, post.slides.length);
    update((p) => ({ ...p, slides: [...p.slides.slice(0, at), emptySlide(kind), ...p.slides.slice(at)] }));
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
    patchSlide({ number: r.slide.number, kicker: r.slide.kicker, title: r.slide.title, body: r.slide.body, photoQuery: r.slide.photoQuery });
    setInstruction("");
  }

  // ── Photos ──────────────────────────────────────────────────────────
  async function upload(file: File) {
    setBusy("upload");
    setError(null);
    const ticket = await createSocialUpload(post.id, { type: file.type, size: file.size });
    if (!ticket.ok) {
      setBusy(null);
      return setError(ticket.error);
    }
    const { error: upError } = await createClient().storage.from(SOCIAL_BUCKET).uploadToSignedUrl(ticket.path, ticket.token, file, { contentType: file.type });
    if (upError) {
      setBusy(null);
      return setError("The upload didn't finish. Try again.");
    }
    const signed = await signSocialUpload(post.id, ticket.path);
    setBusy(null);
    if (!signed.ok) return setError(signed.error);
    // A PNG is usually a cut-out with a transparent background.
    setPhoto({ path: ticket.path, src: signed.src, alt: slide?.photo?.alt || "", credit: null, fit: file.type === "image/png" ? "cutout" : "cover" });
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
    if (!window.confirm("Delete this post for good? Its slides, captions and uploaded pictures are removed and can't be recovered.")) return;
    setBusy("delete");
    const r = await deleteSocialPost(post.id);
    setBusy(null);
    if (!r.ok) return setError(r.error);
    dirty.current = false;
    router.push("/admin/social");
  }

  const problems = useMemo(() => wordingProblems(postTexts(post)), [post]);
  const info = PLATFORM_INFO[platform];
  const previewScale = 520 / info.width;

  return (
    <div className={`social-editor ${socialFontClass}`} data-testid="social-editor">
      <div className="social-editor__bar">
        <Link href="/admin/social" className="link-button">
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
          <span>Template</span>
          <select value={post.template} onChange={(e) => update((p) => ({ ...p, template: e.target.value as Template }))} data-testid="social-template">
            {TEMPLATES.map((t) => (
              <option key={t} value={t}>
                {TEMPLATE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Colours</span>
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

        <div className="social-editor__preview">
          <div className="social-editor__platforms" role="tablist" aria-label="Preview as">
            {PLATFORMS.map((p) => (
              <button key={p} type="button" role="tab" aria-selected={platform === p} className="button button-secondary button-small" data-active={platform === p} onClick={() => setPlatform(p)}>
                {PLATFORM_INFO[p].label}
              </button>
            ))}
          </div>
          {slide ? (
            <ScaledSlide scale={previewScale} width={info.width} height={info.height}>
              <SlideCanvas post={post} slide={slide} index={current} total={post.slides.length} platform={platform} />
            </ScaledSlide>
          ) : (
            <p className="card__meta">No slides yet. Add one.</p>
          )}
          {platform === "x" && slidesFor("x", post.slides).every((x) => x.index !== current) && (
            <p className="card__meta">X takes 4 pictures: this slide isn&rsquo;t one of them (the cover, the next two, and the call to action are).</p>
          )}
        </div>

        {slide && (
          <section className="social-editor__fields" aria-label={`Slide ${current + 1}`}>
            <label className="field">
              <span>Kind</span>
              <select value={slide.kind} onChange={(e) => patchSlide({ kind: e.target.value as SlideKind })} data-testid="social-slide-kind">
                {SLIDE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {SLIDE_KIND_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{slide.kind === "quote" ? "Stat or big number" : "Number"}</span>
              <input value={slide.number} maxLength={LIMITS.number} onChange={(e) => patchSlide({ number: e.target.value })} data-testid="social-slide-number" />
            </label>
            <label className="field field--wide">
              <span>Kicker (a short line above the title)</span>
              <input value={slide.kicker} maxLength={LIMITS.kicker} onChange={(e) => patchSlide({ kicker: e.target.value })} data-testid="social-slide-kicker" />
            </label>
            <label className="field field--wide">
              <span>Title</span>
              <input value={slide.title} maxLength={LIMITS.slideTitle} onChange={(e) => patchSlide({ title: e.target.value })} data-testid="social-slide-title" />
            </label>
            <label className="field field--wide">
              <span>Text</span>
              <textarea rows={4} value={slide.body} maxLength={LIMITS.body} onChange={(e) => patchSlide({ body: e.target.value })} data-testid="social-slide-body" />
            </label>

            <div className="field field--wide">
              <span>Photo</span>
              {slide.photo ? (
                <div className="social-editor__photo">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {slide.photo.src && <img src={slide.photo.src} alt="" />}
                  <div>
                    <label className="field">
                      <span>Placement</span>
                      <select value={slide.photo.fit} onChange={(e) => setPhoto({ ...slide.photo!, fit: e.target.value === "cutout" ? "cutout" : "cover" })}>
                        <option value="cover">Photo (fills its frame)</option>
                        <option value="cutout">Cut-out (transparent PNG)</option>
                      </select>
                    </label>
                    <label className="field">
                      <span>Alt text</span>
                      <input value={slide.photo.alt} maxLength={300} onChange={(e) => setPhoto({ ...slide.photo!, alt: e.target.value })} />
                    </label>
                    <PhotoCreditLine credit={slide.photo.credit} />
                    <button type="button" className="link-button" onClick={() => setPhoto(null)}>
                      Remove photo
                    </button>
                  </div>
                </div>
              ) : null}
              <span className="social-editor__photo-actions">
                <button type="button" className="button button-secondary button-small" onClick={() => setPicker(true)} data-testid="social-find-photo">
                  Find a photo
                </button>
                <label className="button button-secondary button-small">
                  {busy === "upload" ? "Uploading…" : "Upload"}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f) void upload(f);
                    }}
                  />
                </label>
              </span>
            </div>

            <div className="field field--wide">
              <span>Rewrite this slide with AI</span>
              <input value={instruction} maxLength={500} placeholder="Optional: what to change (shorter, more practical, mention minutes...)" onChange={(e) => setInstruction(e.target.value)} />
              <button type="button" className="button button-secondary button-small" onClick={rewrite} disabled={busy !== null} data-testid="social-rewrite">
                {busy === "rewrite" ? "Rewriting…" : "Rewrite"}
              </button>
            </div>
          </section>
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

      {picker && slide && (
        <PhotoPicker
          searchWith={searchSocialPhotos}
          initialQuery={slide.photoQuery || slide.title}
          onClose={() => setPicker(false)}
          onPick={async (p) => {
            setPicker(false);
            const used = await noteSocialPhotoUse(p.downloadLocation);
            if (!used.ok) return setError(used.error);
            setPhoto({ path: null, src: p.src, alt: p.alt, credit: p.credit as SocialPhoto["credit"], fit: "cover" });
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
