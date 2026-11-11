"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { deleteSocialLayout, listSocialLayouts, rewriteSocialText, saveSocialLayout, type SocialLayout } from "@/app/admin/marketing/socials/actions";
import { PhotoCreditLine } from "@/components/training/PhotoPicker";
import { LayeredSlide, ScaledSlide } from "@/components/social/SlideCanvas";
import {
  BRAND,
  BRAND_COLORS,
  BRAND_LABELS,
  boxFor,
  cloneDesign,
  designFromSlide,
  newLayer,
  newLayerId,
  roleTexts,
  withRoleTexts,
  WEIGHTS,
  type Box,
  type BrandColor,
  type Layer,
  type LayerType,
  type SlideDesign,
} from "@/lib/social/design";
import { PLATFORM_INFO, PLATFORMS, SLIDE_KIND_LABELS, SLIDE_KINDS, slidePhotos, type Platform, type SlideKind, type SocialPhoto, type SocialPost, type SocialSlide } from "@/lib/social/post";

/**
 * The Socials editor's slide canvas (docs/marketing.md, "Socials editor"):
 * layers you drag, resize, and change, in the brand kit only. The canvas
 * is the export's own drawing (LayeredSlide), scaled down, so what you see
 * is what's exported. TikTok (9:16) keeps its own positions for layers
 * moved while it's shown.
 */

/** Where each platform covers the slide with its own buttons or crops it (percent of the slide). */
const SAFE_ZONES: Partial<Record<Platform, Array<Box & { label: string }>>> = {
  tiktok: [
    { x: 0, y: 0, w: 100, h: 8.5, label: "Top bar" },
    { x: 85, y: 30, w: 15, h: 50, label: "Buttons" },
    { x: 0, y: 80, w: 85, h: 20, label: "Caption" },
  ],
  x: [{ x: 0, y: 88, w: 100, h: 12, label: "Can be cropped in the timeline" }],
};

const TYPE_LABELS: Record<LayerType, string> = { text: "Text", image: "Photo", shape: "Shape", logo: "Logo", dots: "Pattern", auto: "Auto text" };
const ADDABLE: Array<{ type: LayerType; label: string }> = [
  { type: "text", label: "Text" },
  { type: "image", label: "Photo" },
  { type: "shape", label: "Shape" },
  { type: "logo", label: "Logo" },
  { type: "dots", label: "Pattern" },
  { type: "auto", label: "Handle" },
];

export interface DesignEditorProps {
  post: SocialPost;
  index: number;
  platform: Platform;
  onPlatform: (p: Platform) => void;
  /** Change this slide. `fields` keeps the slide's own words in step with its text layers. */
  onChange: (design: SlideDesign, fields?: Partial<SocialSlide>) => void;
  onError: (message: string | null) => void;
  /** Open the photo picker, or upload a file, for this image layer; resolves with the photo, or null. */
  findPhoto: (query: string) => Promise<SocialPhoto | null>;
  uploadPhoto: (file: File) => Promise<SocialPhoto | null>;
}

export function DesignEditor({ post, index, platform, onPlatform, onChange, onError, findPhoto, uploadPhoto }: DesignEditorProps) {
  const slide = post.slides[index];
  const design = slide.design!;
  const info = PLATFORM_INFO[platform];
  const tall = info.height > 1500;
  const stageRef = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(480);
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setRoom(Math.max(240, Math.min(560, entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scale = Math.min(room / info.width, 680 / info.height);
  const [selected, setSelected] = useState<string | null>(null);
  const [showSafe, setShowSafe] = useState(true);
  const [snap, setSnap] = useState(true);
  const [guides, setGuides] = useState<{ v: boolean; h: boolean }>({ v: false, h: false });
  const [layoutsOpen, setLayoutsOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const past = useRef<Array<{ slideId: string; design: SlideDesign }>>([]);
  const future = useRef<Array<{ slideId: string; design: SlideDesign }>>([]);
  const [, bump] = useState(0);

  useEffect(() => setSelected(null), [slide.id]);
  const layer = design.layers.find((l) => l.id === selected) ?? null;

  // ── Changes and undo ────────────────────────────────────────────────
  const remember = useCallback(() => {
    past.current.push({ slideId: slide.id, design });
    if (past.current.length > 100) past.current.shift();
    future.current = [];
    bump((n) => n + 1);
  }, [slide.id, design]);

  /** Keep the slide's own words in step with the text layers that hold them. */
  const fieldsFor = (d: SlideDesign): Partial<SocialSlide> => {
    const words = roleTexts(d);
    const present = new Set(d.layers.flatMap((l) => (l.type === "text" && l.role ? [l.role] : [])));
    return Object.fromEntries(Object.entries(words).filter(([k]) => present.has(k as keyof typeof words)));
  };

  function change(next: SlideDesign, record = true) {
    if (record) remember();
    onChange(next, fieldsFor(next));
  }
  function setLayer(id: string, patch: Partial<Layer>, record = true) {
    change({ ...design, layers: design.layers.map((l) => (l.id === id ? ({ ...l, ...patch } as Layer) : l)) }, record);
  }
  function undo() {
    const last = past.current.pop();
    if (!last) return;
    if (last.slideId === slide.id) {
      future.current.push({ slideId: slide.id, design });
      onChange(last.design, fieldsFor(last.design));
    }
    bump((n) => n + 1);
  }
  function redo() {
    const next = future.current.pop();
    if (!next || next.slideId !== slide.id) return;
    past.current.push({ slideId: slide.id, design });
    onChange(next.design, fieldsFor(next.design));
    bump((n) => n + 1);
  }

  // ── Dragging and resizing ───────────────────────────────────────────
  const drag = useRef<{ id: string; mode: "move" | "resize"; sx: number; sy: number; start: Box; w: number; h: number; moved: boolean } | null>(null);

  function onLayerDown(e: ReactPointerEvent, id: string, mode: "move" | "resize") {
    e.stopPropagation();
    setSelected(id);
    const l = design.layers.find((x) => x.id === id);
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!l || l.locked || !rect) return;
    drag.current = { id, mode, sx: e.clientX, sy: e.clientY, start: boxFor(design, l, tall), w: rect.width, h: rect.height, moved: false };
    canvasRef.current!.setPointerCapture(e.pointerId);
  }

  function placeBox(id: string, b: Box): SlideDesign {
    const box = { x: round(b.x), y: round(b.y), w: round(b.w), h: round(b.h) };
    if (tall) return { ...design, tall: { ...design.tall, [id]: box } };
    return { ...design, layers: design.layers.map((l) => (l.id === id ? ({ ...l, ...box } as Layer) : l)) };
  }

  function onMove(e: ReactPointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = ((e.clientX - d.sx) / d.w) * 100;
    const dy = ((e.clientY - d.sy) / d.h) * 100;
    if (!d.moved) {
      if (Math.abs(dx) + Math.abs(dy) < 0.3) return;
      remember();
      d.moved = true;
    }
    let b: Box;
    let v = false;
    let h = false;
    if (d.mode === "move") {
      b = { ...d.start, x: d.start.x + dx, y: d.start.y + dy };
      if (snap && Math.abs(b.x + b.w / 2 - 50) < 1.2) {
        b.x = 50 - b.w / 2;
        v = true;
      }
      if (snap && Math.abs(b.y + b.h / 2 - 50) < 1.2) {
        b.y = 50 - b.h / 2;
        h = true;
      }
    } else {
      b = { ...d.start, w: Math.max(2, d.start.w + dx), h: Math.max(1, d.start.h + dy) };
    }
    setGuides({ v, h });
    onChange(placeBox(d.id, b));
  }
  function onUp() {
    drag.current = null;
    setGuides({ v: false, h: false });
  }

  // ── Keyboard ────────────────────────────────────────────────────────
  useEffect(() => {
    function key(e: KeyboardEvent) {
      const el = document.activeElement;
      if (el && (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || (el as HTMLElement).isContentEditable)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (!layer || layer.locked) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        removeLayer(layer.id);
      } else if (e.key.startsWith("Arrow")) {
        e.preventDefault();
        const step = e.shiftKey ? 2 : 0.5;
        const b = boxFor(design, layer, tall);
        remember();
        onChange(
          placeBox(layer.id, {
            ...b,
            x: b.x + (e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0),
            y: b.y + (e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0),
          })
        );
      }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  // ── Layers ──────────────────────────────────────────────────────────
  function addLayer(type: LayerType) {
    const l = newLayer(type, design.bg);
    change({ ...design, layers: [...design.layers, l] });
    setSelected(l.id);
    if (type === "image") void choosePhoto(l.id, slide.photoQuery || slide.title);
  }
  function removeLayer(id: string) {
    const { [id]: _gone, ...tallRest } = design.tall;
    void _gone;
    change({ ...design, layers: design.layers.filter((l) => l.id !== id), tall: tallRest });
    setSelected(null);
  }
  function duplicate(id: string) {
    const l = design.layers.find((x) => x.id === id);
    if (!l) return;
    const copy = { ...l, id: newLayerId(), name: `${l.name} copy`, x: l.x + 2, y: l.y + 2, locked: false } as Layer;
    const at = design.layers.indexOf(l) + 1;
    change({ ...design, layers: [...design.layers.slice(0, at), copy, ...design.layers.slice(at)] });
    setSelected(copy.id);
  }
  function move(id: string, dir: 1 | -1) {
    const i = design.layers.findIndex((l) => l.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= design.layers.length) return;
    const layers = [...design.layers];
    [layers[i], layers[j]] = [layers[j], layers[i]];
    change({ ...design, layers });
  }
  function resetTall(id: string) {
    const { [id]: _gone, ...rest } = design.tall;
    void _gone;
    change({ ...design, tall: rest });
  }

  async function choosePhoto(id: string, query: string) {
    const photo = await findPhoto(query);
    if (photo) setLayer(id, { photo } as Partial<Layer>);
  }
  async function uploadTo(id: string, file: File) {
    setBusy("upload");
    const photo = await uploadPhoto(file);
    setBusy(null);
    if (photo) setLayer(id, { photo, fit: photo.fit === "cutout" ? "contain" : "cover" } as Partial<Layer>);
  }

  async function rewrite(id: string, text: string, instruction: string) {
    setBusy("rewrite");
    onError(null);
    const r = await rewriteSocialText(post.id, post.slides, index, text, instruction);
    setBusy(null);
    if (!r.ok) return onError(r.error);
    setLayer(id, { text: r.text } as Partial<Layer>);
  }

  const zones = showSafe ? SAFE_ZONES[platform] ?? [] : [];
  const displayW = info.width * scale;
  const displayH = info.height * scale;

  return (
    <div className="design-editor">
      <aside className="design-editor__left" aria-label="Layers">
        <div className="design-editor__group">
          <h3>Add</h3>
          <div className="design-editor__add">
            {ADDABLE.map((a) => (
              <button key={a.type} type="button" className="button button-secondary button-small" onClick={() => addLayer(a.type)} data-testid={`design-add-${a.type}`}>
                {a.label}
              </button>
            ))}
          </div>
          <button type="button" className="button button-secondary button-small" onClick={() => setLayoutsOpen(true)} data-testid="design-layouts">
            Layouts
          </button>
        </div>
        <div className="design-editor__group">
          <h3>Layers</h3>
          <ul className="design-editor__layers" data-testid="design-layers">
            {[...design.layers].reverse().map((l) => (
              <li key={l.id} data-active={l.id === selected}>
                <button type="button" className="design-editor__layer-name" onClick={() => setSelected(l.id)}>
                  <span className="design-editor__layer-type">{TYPE_LABELS[l.type]}</span>
                  {l.name}
                </button>
                <span className="design-editor__layer-tools">
                  <button type="button" className="icon-button" title="Bring forward" aria-label={`Bring ${l.name} forward`} onClick={() => move(l.id, 1)}>
                    &uarr;
                  </button>
                  <button type="button" className="icon-button" title="Send back" aria-label={`Send ${l.name} back`} onClick={() => move(l.id, -1)}>
                    &darr;
                  </button>
                  <button type="button" className="icon-button" title={l.hidden ? "Show" : "Hide"} aria-pressed={l.hidden} onClick={() => setLayer(l.id, { hidden: !l.hidden })}>
                    {l.hidden ? "Show" : "Hide"}
                  </button>
                  <button type="button" className="icon-button" title={l.locked ? "Unlock" : "Lock"} aria-pressed={l.locked} onClick={() => setLayer(l.id, { locked: !l.locked })}>
                    {l.locked ? "Locked" : "Lock"}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <div className="design-editor__stage" ref={stageRef}>
        <div className="design-editor__toolbar">
          <div className="social-editor__platforms" role="tablist" aria-label="Show as">
            {PLATFORMS.map((p) => (
              <button key={p} type="button" role="tab" aria-selected={platform === p} className="button button-secondary button-small" data-active={platform === p} onClick={() => onPlatform(p)}>
                {PLATFORM_INFO[p].label}
              </button>
            ))}
          </div>
          <span className="design-editor__toolbar-right">
            <button type="button" className="button button-secondary button-small" onClick={undo} disabled={!past.current.some((h) => h.slideId === slide.id)}>
              Undo
            </button>
            <button type="button" className="button button-secondary button-small" onClick={redo} disabled={!future.current.some((h) => h.slideId === slide.id)}>
              Redo
            </button>
          </span>
        </div>
        <div className="design-editor__toggles">
          <label>
            <input type="checkbox" checked={showSafe} onChange={(e) => setShowSafe(e.target.checked)} /> Safe areas
          </label>
          <label>
            <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} /> Snap to centre
          </label>
          <span className="card__meta">
            {info.label}: {info.width} by {info.height}
            {tall ? ". Moves here apply to TikTok only." : ""}
          </span>
        </div>
        <div
          ref={canvasRef}
          className="design-editor__canvas"
          style={{ width: displayW, height: displayH }}
          onPointerDown={() => setSelected(null)}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          data-testid="design-canvas"
        >
          <ScaledSlide scale={scale} width={info.width} height={info.height}>
            <LayeredSlide
              design={design}
              platform={platform}
              index={index}
              total={post.slides.length}
              showNumbers={post.showSlideNumbers ?? post.slides.length > 1}
              interaction={{ selectedId: selected, scale, onPointerDown: onLayerDown }}
            />
          </ScaledSlide>
          {zones.map((z) => (
            <div key={z.label} className="design-editor__zone" style={{ left: `${z.x}%`, top: `${z.y}%`, width: `${z.w}%`, height: `${z.h}%` }}>
              <span>{z.label}</span>
            </div>
          ))}
          {guides.v && <div className="design-editor__guide design-editor__guide--v" />}
          {guides.h && <div className="design-editor__guide design-editor__guide--h" />}
        </div>
      </div>

      <aside className="design-editor__right" aria-label="Settings">
        {layer ? (
          <LayerSettings
            key={layer.id}
            layer={layer}
            tallMoved={tall && Boolean(design.tall[layer.id])}
            busy={busy}
            onSet={(patch, record) => setLayer(layer.id, patch, record)}
            onRemember={remember}
            onDelete={() => removeLayer(layer.id)}
            onDuplicate={() => duplicate(layer.id)}
            onResetTall={() => resetTall(layer.id)}
            onFindPhoto={() => choosePhoto(layer.id, slide.photoQuery || slide.title)}
            onUpload={(f) => uploadTo(layer.id, f)}
            onRewrite={(text, instruction) => rewrite(layer.id, text, instruction)}
          />
        ) : (
          <div className="design-editor__group">
            <h3>Slide</h3>
            <Field label="Background">
              <Swatches value={design.bg} onPick={(c) => change({ ...design, bg: c })} />
            </Field>
            <p className="card__meta">Select a layer on the slide, or in the list, to change it.</p>
          </div>
        )}
        <div className="design-editor__group">
          <h3>Brand kit</h3>
          <div className="design-editor__kit">
            {BRAND_COLORS.map((c) => (
              <span key={c} className="design-editor__swatch" style={{ background: BRAND[c] }} title={BRAND_LABELS[c]} />
            ))}
          </div>
          <p className="card__meta">Fraunces for headlines, Work Sans for text, and the StrataCouncil.ca logo. Slides use only these.</p>
        </div>
      </aside>

      {layoutsOpen && (
        <LayoutsDialog
          post={post}
          index={index}
          onClose={() => setLayoutsOpen(false)}
          onError={onError}
          onApply={(d, kind) => {
            remember();
            const texts = roleTexts(design);
            const next = withRoleTexts(d, { number: texts.number, kicker: texts.kicker, title: texts.title, body: texts.body });
            onChange(next, { ...fieldsFor(next), ...(kind ? { kind } : {}) });
            setSelected(null);
            setLayoutsOpen(false);
          }}
        />
      )}
    </div>
  );
}

const round = (n: number) => Math.round(n * 100) / 100;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <span>{label}</span>
      {children}
    </div>
  );
}

function Swatches({ value, onPick }: { value: BrandColor; onPick: (c: BrandColor) => void }) {
  return (
    <div className="design-editor__kit" role="radiogroup">
      {BRAND_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={BRAND_LABELS[c]}
          title={BRAND_LABELS[c]}
          className="design-editor__swatch"
          data-active={value === c}
          style={{ background: BRAND[c] }}
          onClick={() => onPick(c)}
        />
      ))}
    </div>
  );
}

function Range({ label, value, min, max, step = 1, suffix = "", onChange, onStart }: { label: string; value: number; min: number; max: number; step?: number; suffix?: string; onChange: (n: number) => void; onStart: () => void }) {
  return (
    <label className="field">
      <span>
        {label}: {value}
        {suffix}
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onPointerDown={onStart} onKeyDown={onStart} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function LayerSettings({
  layer: l,
  tallMoved,
  busy,
  onSet,
  onRemember,
  onDelete,
  onDuplicate,
  onResetTall,
  onFindPhoto,
  onUpload,
  onRewrite,
}: {
  layer: Layer;
  tallMoved: boolean;
  busy: string | null;
  onSet: (patch: Partial<Layer>, record?: boolean) => void;
  onRemember: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onResetTall: () => void;
  onFindPhoto: () => void;
  onUpload: (f: File) => void;
  onRewrite: (text: string, instruction: string) => void;
}) {
  const [instruction, setInstruction] = useState("");
  // One undo step per edit, however many keystrokes or slider moves it takes.
  const started = useRef(false);
  const live = (patch: Partial<Layer>) => {
    if (!started.current) {
      onRemember();
      started.current = true;
    }
    onSet(patch, false);
  };
  const done = () => (started.current = false);
  const set = (patch: Partial<Layer>) => onSet(patch);

  return (
    <div className="design-editor__group" onBlur={done} onPointerUp={done}>
      <h3>
        {TYPE_LABELS[l.type]}
        <span className="design-editor__layer-tools">
          <button type="button" className="link-button" onClick={onDuplicate}>
            Duplicate
          </button>
          <button type="button" className="link-button" onClick={onDelete} disabled={l.locked} data-testid="design-delete-layer">
            Delete
          </button>
        </span>
      </h3>
      <label className="field">
        <span>Layer name</span>
        <input value={l.name} maxLength={60} onChange={(e) => live({ name: e.target.value })} />
      </label>

      {l.type === "text" && (
        <>
          <label className="field">
            <span>Text</span>
            <textarea rows={4} value={l.text} maxLength={600} onChange={(e) => live({ text: e.target.value })} data-testid="design-text" />
          </label>
          <div className="design-editor__row">
            <label className="field">
              <span>Font</span>
              <select value={l.font} onChange={(e) => set({ font: e.target.value === "sans" ? "sans" : "serif" })}>
                <option value="serif">Fraunces</option>
                <option value="sans">Work Sans</option>
              </select>
            </label>
            <label className="field">
              <span>Weight</span>
              <select value={l.weight} onChange={(e) => set({ weight: Number(e.target.value) })}>
                {WEIGHTS.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <Range label="Size" value={l.size} min={1.5} max={30} step={0.1} onStart={onRemember} onChange={(n) => onSet({ size: n }, false)} />
          <Range label="Line spacing" value={l.lineHeight} min={0.8} max={2} step={0.02} onStart={onRemember} onChange={(n) => onSet({ lineHeight: n }, false)} />
          <div className="field">
            <span>Align</span>
            <span className="design-editor__seg">
              {(["left", "center", "right"] as const).map((a) => (
                <button key={a} type="button" aria-pressed={l.align === a} onClick={() => set({ align: a })}>
                  {a === "center" ? "Centre" : a[0].toUpperCase() + a.slice(1)}
                </button>
              ))}
            </span>
          </div>
          <label className="checkbox-field">
            <input type="checkbox" checked={l.caps} onChange={(e) => set({ caps: e.target.checked })} /> Capitals
          </label>
          <Field label="Colour">
            <Swatches value={l.color} onPick={(c) => set({ color: c })} />
          </Field>
          <label className="field">
            <span>Rewrite with AI</span>
            <input value={instruction} maxLength={500} placeholder="Optional: shorter, warmer, mention minutes..." onChange={(e) => setInstruction(e.target.value)} />
          </label>
          <button type="button" className="button button-secondary button-small" disabled={busy !== null || !l.text.trim()} onClick={() => onRewrite(l.text, instruction)} data-testid="design-rewrite">
            {busy === "rewrite" ? "Rewriting…" : "Rewrite"}
          </button>
        </>
      )}

      {l.type === "image" && (
        <>
          {l.photo && (
            <>
              <label className="field">
                <span>Alt text</span>
                <input value={l.photo.alt} maxLength={300} onChange={(e) => live({ photo: { ...l.photo!, alt: e.target.value } })} />
              </label>
              <PhotoCreditLine credit={l.photo.credit} />
            </>
          )}
          <span className="design-editor__row">
            <button type="button" className="button button-secondary button-small" onClick={onFindPhoto} data-testid="design-find-photo">
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
                  if (f) onUpload(f);
                }}
              />
            </label>
          </span>
          <div className="field">
            <span>Placement</span>
            <span className="design-editor__seg">
              <button type="button" aria-pressed={l.fit === "cover"} onClick={() => set({ fit: "cover" })}>
                Fill
              </button>
              <button type="button" aria-pressed={l.fit === "contain"} onClick={() => set({ fit: "contain" })}>
                Fit (cut-outs)
              </button>
            </span>
          </div>
          <Range label="Corners" value={l.radius} min={0} max={20} step={0.2} onStart={onRemember} onChange={(n) => onSet({ radius: n }, false)} />
          <Range label="Brightness" value={l.brightness} min={30} max={160} suffix="%" onStart={onRemember} onChange={(n) => onSet({ brightness: n }, false)} />
        </>
      )}

      {(l.type === "shape" || l.type === "logo" || l.type === "dots" || l.type === "auto") && (
        <Field label="Colour">
          <Swatches value={l.color} onPick={(c) => set({ color: c })} />
        </Field>
      )}
      {l.type === "shape" && <Range label="Corners" value={l.radius} min={0} max={50} step={0.2} onStart={onRemember} onChange={(n) => onSet({ radius: n }, false)} />}
      {l.type === "logo" && (
        <div className="field">
          <span>Logo</span>
          <span className="design-editor__seg">
            <button type="button" aria-pressed={l.variant === "lockup"} onClick={() => set({ variant: "lockup" })}>
              Mark and name
            </button>
            <button type="button" aria-pressed={l.variant === "mark"} onClick={() => set({ variant: "mark" })}>
              Mark only
            </button>
          </span>
        </div>
      )}
      {l.type === "auto" && (
        <>
          <label className="field">
            <span>Shows</span>
            <select value={l.what} onChange={(e) => set({ what: e.target.value as "handle" | "counter" | "swipe", name: e.target.value === "handle" ? "Handle" : e.target.value === "counter" ? "Slide number" : "Swipe" })}>
              <option value="handle">The platform&rsquo;s handle</option>
              <option value="counter">The slide number (01 / 05)</option>
              <option value="swipe">Swipe cue</option>
            </select>
          </label>
          <Range label="Size" value={l.size} min={1} max={10} step={0.1} onStart={onRemember} onChange={(n) => onSet({ size: n }, false)} />
          <div className="field">
            <span>Align</span>
            <span className="design-editor__seg">
              {(["left", "center", "right"] as const).map((a) => (
                <button key={a} type="button" aria-pressed={l.align === a} onClick={() => set({ align: a })}>
                  {a === "center" ? "Centre" : a[0].toUpperCase() + a.slice(1)}
                </button>
              ))}
            </span>
          </div>
        </>
      )}
      <Range label="Opacity" value={l.opacity} min={0} max={100} suffix="%" onStart={onRemember} onChange={(n) => onSet({ opacity: n }, false)} />
      {tallMoved && (
        <button type="button" className="link-button" onClick={onResetTall}>
          Put back where the other platforms have it
        </button>
      )}
    </div>
  );
}

function LayoutsDialog({
  post,
  index,
  onClose,
  onApply,
  onError,
}: {
  post: SocialPost;
  index: number;
  onClose: () => void;
  onApply: (d: SlideDesign, kind?: SlideKind) => void;
  onError: (m: string | null) => void;
}) {
  const slide = post.slides[index];
  const [saved, setSaved] = useState<SocialLayout[] | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void listSocialLayouts().then((r) => {
      if (r.ok) setSaved(r.layouts);
      else {
        setSaved([]);
        onError(r.error);
      }
    });
  }, [onError]);

  const words = roleTexts(slide.design);
  const photo = slidePhotos(slide)[0] ?? null;
  const builtIns = useMemo(
    () =>
      SLIDE_KINDS.map((kind) => ({
        kind,
        design: designFromSlide(
          {
            kind,
            number: words.number || (kind === "point" ? String(index + 1) : kind === "quote" ? "73%" : ""),
            kicker: words.kicker,
            title: words.title || "Your title",
            body: words.body,
            photo,
          },
          { template: post.template, theme: post.theme, index }
        ),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slide.id]
  );

  async function save() {
    setBusy(true);
    const r = await saveSocialLayout(name, slide.design);
    setBusy(false);
    if (!r.ok) return onError(r.error);
    setSaved((s) => [r.layout, ...(s ?? [])]);
    setName("");
  }

  const thumb = (d: SlideDesign) => (
    <ScaledSlide scale={120 / 1080} width={1080} height={1350}>
      <LayeredSlide design={d} platform="instagram" index={index} total={post.slides.length} showNumbers={post.showSlideNumbers ?? post.slides.length > 1} />
    </ScaledSlide>
  );

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Layouts" onClick={onClose}>
      <div className="modal design-layouts" onClick={(e) => e.stopPropagation()}>
        <h2>Layouts</h2>
        <p className="card__meta">Applying a layout replaces this slide&rsquo;s design; its words carry over. Undo puts it back.</p>
        <h3>Starting layouts</h3>
        <div className="design-layouts__grid">
          {builtIns.map((b) => (
            <button key={b.kind} type="button" className="design-layouts__item" onClick={() => onApply(cloneDesign(b.design), b.kind)}>
              {thumb(b.design)}
              <span>{SLIDE_KIND_LABELS[b.kind]}</span>
            </button>
          ))}
        </div>
        <h3>Saved layouts</h3>
        {saved === null ? (
          <p className="card__meta">Loading…</p>
        ) : saved.length === 0 ? (
          <p className="card__meta">None yet. Save a slide&rsquo;s design below to use it again.</p>
        ) : (
          <div className="design-layouts__grid">
            {saved.map((s) => (
              <div key={s.id} className="design-layouts__item">
                <button type="button" onClick={() => onApply(cloneDesign(s.design))}>
                  {thumb(s.design)}
                  <span>{s.name}</span>
                </button>
                <button
                  type="button"
                  className="link-button"
                  onClick={async () => {
                    const r = await deleteSocialLayout(s.id);
                    if (!r.ok) return onError(r.error);
                    setSaved((list) => (list ?? []).filter((x) => x.id !== s.id));
                  }}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="design-editor__row" style={{ alignItems: "end" }}>
          <label className="field" style={{ flex: 1 }}>
            <span>Save this slide as a layout</span>
            <input value={name} maxLength={60} placeholder="Name, e.g. Big quote on ink" onChange={(e) => setName(e.target.value)} />
          </label>
          <button type="button" className="button button-secondary" disabled={busy || !name.trim()} onClick={save} data-testid="design-save-layout">
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
        <p className="card__meta">Uploaded photos stay with their post; Unsplash photos are kept in the layout.</p>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button type="button" className="button button-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
