"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
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
  DESIGN_LIMITS,
  designMoves,
  ENTRANCE_LABELS,
  ENTRANCES,
  EXIT_LABELS,
  EXITS,
  lastMoveEnd,
  LAYOUT_KEYS,
  LAYOUT_KINDS,
  LAYOUT_LABELS,
  layoutDesign,
  newLayer,
  newLayerId,
  roleTexts,
  withRoleTexts,
  WEIGHTS,
  type Box,
  type BrandColor,
  type Entrance,
  type Exit,
  type Layer,
  type LayerType,
  type SlideDesign,
} from "@/lib/social/design";
import { PLATFORM_INFO, PLATFORMS, SLIDE_KIND_LABELS, SLIDE_KINDS, slidePhotos, type Platform, type SlideKind, type SocialClip, type SocialPhoto, type SocialPost, type SocialSlide } from "@/lib/social/post";

/**
 * The Socials editor's workspace (docs/marketing.md, "Socials editor"), on
 * one grid: slides | add and layers | canvas | settings, with the timeline
 * under the canvas. The canvas is the export's own drawing (LayeredSlide),
 * scaled down, so what you see is what's exported. TikTok (9:16) keeps its
 * own positions for layers moved while it's shown.
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

const TYPE_LABELS: Record<LayerType, string> = { text: "Text", image: "Photo", shape: "Shape", logo: "Logo", dots: "Pattern", auto: "Fills itself", video: "Video" };

/** Simple line icons, 24-unit grid. */
const ICONS: Record<LayerType | "layouts", string> = {
  text: "M5 6V4h14v2M12 4v16M9 20h6",
  image: "M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15.5 9.5h.01",
  video: "M4 6h11v12H4zM15 10l5-3v10l-5-3",
  shape: "M5 5h14v14H5z",
  logo: "M6 18V8l6 6V4M18 6v10l-6-6v10",
  dots: "M6 6h.01M12 6h.01M18 6h.01M6 12h.01M12 12h.01M18 12h.01M6 18h.01M12 18h.01M18 18h.01",
  auto: "M16 12a4 4 0 1 1-1.2-2.8M16 8v5a2 2 0 0 0 4 0v-1a8 8 0 1 0-3.2 6.4",
  layouts: "M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z",
};
const ADDABLE: Array<{ type: LayerType; label: string }> = [
  { type: "text", label: "Text" },
  { type: "image", label: "Photo" },
  { type: "video", label: "Video" },
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
  /** The same for video: the Pixabay picker, or an upload (MP4 or MOV). */
  findClip: (query: string) => Promise<SocialClip | null>;
  uploadClip: (file: File) => Promise<SocialClip | null>;
  /** The slide strip (the first column). */
  slides: ReactNode;
  /** The slide's own panel when no layer is selected: rewriting its words with AI. */
  slidePanel: ReactNode;
  /** A note under the canvas (X's four pictures). */
  note?: ReactNode;
}

export function DesignEditor({ post, index, platform, onPlatform, onChange, onError, findPhoto, uploadPhoto, findClip, uploadClip, slides, slidePanel, note }: DesignEditorProps) {
  const slide = post.slides[index];
  const design = slide.design!;
  // The design as it is now, for changes that land later (a photo or clip
  // chosen in a picker): building from the design as it was when the picker
  // opened would undo whatever happened in between, like adding the frame.
  const latest = useRef(design);
  latest.current = design;
  const info = PLATFORM_INFO[platform];
  const tall = info.height > 1500;
  const stageRef = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState({ w: 480, h: 640 });
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setRoom({ w: Math.max(220, entry.contentRect.width - 32), h: Math.max(360, Math.min(760, window.innerHeight - 300)) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scale = Math.min(room.w / info.width, room.h / info.height);
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

  // ── Play (the slide's movement and clips, as the video export will have them) ──
  const [time, setTime] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const duration = design.duration;
  useEffect(() => {
    if (!playing) return;
    const from = performance.now() - (time ?? 0) * 1000;
    let raf = 0;
    const tick = (now: number) => {
      const t = (now - from) / 1000;
      if (t >= duration) {
        setPlaying(false);
        setTime(null);
        return;
      }
      setTime(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // Starting from where the playhead is; `time` itself moves every frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, duration]);
  useEffect(() => {
    setPlaying(false);
    setTime(null);
  }, [slide.id]);

  // ── Changes and undo ────────────────────────────────────────────────
  const remember = useCallback(() => {
    past.current.push({ slideId: slide.id, design: latest.current });
    if (past.current.length > 100) past.current.shift();
    future.current = [];
    bump((n) => n + 1);
  }, [slide.id]);

  /** Keep the slide's own words in step with the text layers that hold them. */
  const fieldsFor = (d: SlideDesign): Partial<SocialSlide> => {
    const words = roleTexts(d);
    const present = new Set(d.layers.flatMap((l) => (l.type === "text" && l.role ? [l.role] : [])));
    return Object.fromEntries(Object.entries(words).filter(([k]) => present.has(k as keyof typeof words)));
  };

  function change(next: SlideDesign, record = true) {
    if (record) remember();
    latest.current = next;
    onChange(next, fieldsFor(next));
  }
  function setLayer(id: string, patch: Partial<Layer>, record = true) {
    const d = latest.current;
    change({ ...d, layers: d.layers.map((l) => (l.id === id ? ({ ...l, ...patch } as Layer) : l)) }, record);
  }
  function undo() {
    const last = past.current.pop();
    if (!last) return;
    if (last.slideId === slide.id) {
      future.current.push({ slideId: slide.id, design: latest.current });
      latest.current = last.design;
      onChange(last.design, fieldsFor(last.design));
    }
    bump((n) => n + 1);
  }
  function redo() {
    const next = future.current.pop();
    if (!next || next.slideId !== slide.id) return;
    past.current.push({ slideId: slide.id, design: latest.current });
    latest.current = next.design;
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
    const d = latest.current;
    const box = { x: round(b.x), y: round(b.y), w: round(b.w), h: round(b.h) };
    if (tall) return { ...d, tall: { ...d.tall, [id]: box } };
    return { ...d, layers: d.layers.map((l) => (l.id === id ? ({ ...l, ...box } as Layer) : l)) };
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
    change(placeBox(d.id, b), false);
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
      if (document.querySelector(".modal")) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (e.key === "Escape") return setSelected(null);
      if (!layer || layer.locked) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        removeLayer(layer.id);
      } else if (e.key.startsWith("Arrow")) {
        e.preventDefault();
        const step = e.shiftKey ? 2 : 0.5;
        const b = boxFor(latest.current, layer, tall);
        change(
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
    const l = newLayer(type, latest.current.bg);
    change({ ...latest.current, layers: [...latest.current.layers, l] });
    setSelected(l.id);
    if (type === "image") void choosePhoto(l.id, slide.photoQuery || slide.title);
    if (type === "video") void chooseClip(l.id, slide.photoQuery || slide.title);
  }
  function removeLayer(id: string) {
    const d = latest.current;
    const { [id]: _gone, ...tallRest } = d.tall;
    void _gone;
    change({ ...d, layers: d.layers.filter((l) => l.id !== id), tall: tallRest });
    setSelected(null);
  }
  function duplicate(id: string) {
    const d = latest.current;
    const l = d.layers.find((x) => x.id === id);
    if (!l) return;
    const copy = { ...l, id: newLayerId(), name: `${l.name} copy`, x: l.x + 2, y: l.y + 2, locked: false } as Layer;
    const at = d.layers.indexOf(l) + 1;
    change({ ...d, layers: [...d.layers.slice(0, at), copy, ...d.layers.slice(at)] });
    setSelected(copy.id);
  }
  function move(id: string, dir: 1 | -1) {
    const d = latest.current;
    const i = d.layers.findIndex((l) => l.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= d.layers.length) return;
    const layers = [...d.layers];
    [layers[i], layers[j]] = [layers[j], layers[i]];
    change({ ...d, layers });
  }
  function resetTall(id: string) {
    const d = latest.current;
    const { [id]: _gone, ...rest } = d.tall;
    void _gone;
    change({ ...d, tall: rest });
  }

  async function choosePhoto(id: string, query: string) {
    const photo = await findPhoto(query);
    if (photo && latest.current.layers.some((l) => l.id === id)) setLayer(id, { photo } as Partial<Layer>);
  }
  async function uploadTo(id: string, file: File) {
    setBusy("upload");
    const photo = await uploadPhoto(file);
    setBusy(null);
    if (photo) setLayer(id, { photo, fit: photo.fit === "cutout" ? "contain" : "cover" } as Partial<Layer>);
  }
  async function chooseClip(id: string, query: string) {
    const clip = await findClip(query);
    if (clip && latest.current.layers.some((l) => l.id === id)) setClip(id, clip);
  }
  async function uploadClipTo(id: string, file: File) {
    setBusy("upload");
    const clip = await uploadClip(file);
    setBusy(null);
    if (clip) setClip(id, clip);
  }
  function setClip(id: string, clip: SocialClip) {
    const trimEnd = Math.min(clip.duration, Math.max(1, latest.current.duration));
    setLayer(id, { clip, trimStart: 0, trimEnd } as Partial<Layer>);
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
  const canUndo = past.current.some((h) => h.slideId === slide.id);
  const canRedo = future.current.some((h) => h.slideId === slide.id);

  return (
    <div className="se-work">
      <nav className="se-col se-col--slides" aria-label="Slides">
        {slides}
      </nav>

      <aside className="se-col se-panel" aria-label="Add and layers">
        <div className="se-panel__head">
          <h3>Add</h3>
        </div>
        <div className="se-add">
          {ADDABLE.map((a) => (
            <button key={a.type} type="button" className="se-add__tile" onClick={() => addLayer(a.type)} data-testid={`design-add-${a.type}`}>
              <Icon d={ICONS[a.type]} size={18} />
              <span>{a.label}</span>
            </button>
          ))}
          <button type="button" className="se-add__tile" onClick={() => setLayoutsOpen(true)} data-testid="design-layouts">
            <Icon d={ICONS.layouts} size={18} />
            <span>Layouts</span>
          </button>
        </div>
        <div className="se-panel__head se-panel__head--rule">
          <h3>Layers</h3>
        </div>
        <ul className="se-layers" data-testid="design-layers">
          {[...design.layers].reverse().map((l) => (
            <li key={l.id} data-active={l.id === selected} data-hidden={l.hidden}>
              <button type="button" className="se-layers__name" onClick={() => setSelected(l.id === selected ? null : l.id)}>
                <Icon d={ICONS[l.type]} size={14} />
                <span>{l.name}</span>
              </button>
              <span className="se-icons se-layers__tools">
                <button type="button" className="se-icon se-icon--hover" title="Bring forward" aria-label={`Bring ${l.name} forward`} onClick={() => move(l.id, 1)}>
                  <Icon d="M12 19V5M6 11l6-6 6 6" />
                </button>
                <button type="button" className="se-icon se-icon--hover" title="Send back" aria-label={`Send ${l.name} back`} onClick={() => move(l.id, -1)}>
                  <Icon d="M12 5v14M6 13l6 6 6-6" />
                </button>
                <button type="button" className="se-icon" data-on={l.hidden} title={l.hidden ? "Show" : "Hide"} aria-label={`${l.hidden ? "Show" : "Hide"} ${l.name}`} aria-pressed={l.hidden} onClick={() => setLayer(l.id, { hidden: !l.hidden })}>
                  <Icon d={l.hidden ? "M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.2A9.7 9.7 0 0 1 12 5c6 0 9.5 7 9.5 7a17 17 0 0 1-3.2 4.1M6.6 6.6A16.6 16.6 0 0 0 2.5 12S6 19 12 19a9.4 9.4 0 0 0 5.4-1.6" : "M2.5 12S6 5 12 5s9.5 7 9.5 7S18 19 12 19 2.5 12 2.5 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"} />
                </button>
                <button type="button" className="se-icon" data-on={l.locked} title={l.locked ? "Unlock" : "Lock"} aria-label={`${l.locked ? "Unlock" : "Lock"} ${l.name}`} aria-pressed={l.locked} onClick={() => setLayer(l.id, { locked: !l.locked })}>
                  <Icon d={l.locked ? "M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4" : "M6 11h12v10H6zM8 11V7a4 4 0 0 1 7.5-1.9"} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      </aside>

      <section className="se-col se-stage" ref={stageRef} aria-label="Slide">
        <div className="se-stage__bar">
          <div className="se-seg" role="tablist" aria-label="Show as">
            {PLATFORMS.map((p) => (
              <button key={p} type="button" role="tab" aria-selected={platform === p} data-active={platform === p} onClick={() => onPlatform(p)}>
                {PLATFORM_INFO[p].label}
              </button>
            ))}
          </div>
          <span className="se-icons">
            <button type="button" className="se-icon" data-on={showSafe} aria-pressed={showSafe} title="Safe areas: where the platform covers the slide" onClick={() => setShowSafe((v) => !v)}>
              <Icon d="M4 4h16v16H4zM4 15h16M16 4v11" />
            </button>
            <button type="button" className="se-icon" data-on={snap} aria-pressed={snap} title="Snap to centre" onClick={() => setSnap((v) => !v)}>
              <Icon d="M12 3v18M3 12h18M8 8h8v8H8z" />
            </button>
            <span className="se-icons__gap" />
            <button type="button" className="se-icon" title="Undo" aria-label="Undo" onClick={undo} disabled={!canUndo}>
              <Icon d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" />
            </button>
            <button type="button" className="se-icon" title="Redo" aria-label="Redo" onClick={redo} disabled={!canRedo}>
              <Icon d="M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3" />
            </button>
          </span>
        </div>
        <div className="se-stage__area">
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
                interaction={playing ? undefined : { selectedId: selected, scale, onPointerDown: onLayerDown }}
                time={time ?? undefined}
                playing={playing}
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
          {tall && <p className="se-note">Moves made here apply to TikTok only.</p>}
          {note}
        </div>
      </section>

      <aside className="se-col se-panel se-col--settings" aria-label="Settings">
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
            onFindPhoto={() => (layer.type === "video" ? chooseClip(layer.id, slide.photoQuery || slide.title) : choosePhoto(layer.id, slide.photoQuery || slide.title))}
            onUpload={(f) => (layer.type === "video" ? uploadClipTo(layer.id, f) : uploadTo(layer.id, f))}
            onRewrite={(text, instruction) => rewrite(layer.id, text, instruction)}
            duration={duration}
          />
        ) : (
          <div className="se-inspector">
            <div className="se-panel__head">
              <h3>Slide {index + 1}</h3>
            </div>
            <Field label="Background">
              <Swatches value={design.bg} onPick={(c) => change({ ...latest.current, bg: c })} />
            </Field>
            {slidePanel}
            <p className="se-hint">Select a layer on the slide or in Layers to change it.</p>
          </div>
        )}
      </aside>

      <Timeline
        design={design}
        selected={selected}
        time={time}
        playing={playing}
        onSelect={setSelected}
        onPlay={() => {
          if (playing) {
            setPlaying(false);
            setTime(null);
          } else {
            setTime(0);
            setPlaying(true);
          }
        }}
        onScrub={(t) => {
          setPlaying(false);
          setTime(t);
        }}
        onDuration={(n) => change({ ...latest.current, duration: n })}
        onRemember={remember}
        onTiming={(id, patch) => setLayer(id, patch as Partial<Layer>, false)}
      />

      {layoutsOpen && (
        <LayoutsDialog
          post={post}
          index={index}
          onClose={() => setLayoutsOpen(false)}
          onError={onError}
          onApply={(d, kind) => {
            remember();
            // Carry over only the words this slide has: a layout's own
            // placeholder (a list number, say) stays when the slide has none.
            const texts = Object.fromEntries(Object.entries(fieldsFor(latest.current)).filter(([, v]) => typeof v === "string" && v.trim()));
            const next = withRoleTexts(d, texts);
            latest.current = next;
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
const clamp = (n: number, min: number, max: number) => (Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n * 100) / 100)) : min);

type Timing = { enterAt?: number; enterFor?: number; exitAt?: number; exitFor?: number };

/**
 * The slide's timeline: Play, its length, a playhead to drag, and each
 * layer's entrance and exit as bars (drag one to move it, its edge to
 * change how long it takes). With a layer selected, only that layer; with
 * none, every layer that moves.
 */
function Timeline({
  design,
  selected,
  time,
  playing,
  onSelect,
  onPlay,
  onScrub,
  onDuration,
  onRemember,
  onTiming,
}: {
  design: SlideDesign;
  selected: string | null;
  time: number | null;
  playing: boolean;
  onSelect: (id: string | null) => void;
  onPlay: () => void;
  onScrub: (t: number) => void;
  onDuration: (n: number) => void;
  onRemember: () => void;
  onTiming: (id: string, patch: Timing) => void;
}) {
  const duration = design.duration;
  const moves = designMoves(design);
  const late = lastMoveEnd(design) > duration + 0.01;
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; which: "enter" | "exit"; mode: "move" | "length"; x: number; at: number; length: number; w: number } | null>(null);
  const visible = design.layers.filter((l) => !l.hidden);
  const rows = selected ? visible.filter((l) => l.id === selected) : [...visible].reverse().filter((l) => l.enter !== "none" || l.exit !== "none" || (l.type === "video" && l.clip));
  const pct = (t: number) => `${Math.min(100, Math.max(0, (t / duration) * 100))}%`;

  function down(e: ReactPointerEvent, id: string, which: "enter" | "exit", mode: "move" | "length", at: number, length: number) {
    e.stopPropagation();
    const w = track.current?.getBoundingClientRect().width ?? 1;
    drag.current = { id, which, mode, x: e.clientX, at, length, w };
    onRemember();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function move(e: ReactPointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dt = ((e.clientX - d.x) / d.w) * duration;
    const snap = (n: number) => Math.round(n * 20) / 20;
    const at = snap(Math.min(duration - 0.1, Math.max(0, d.at + dt)));
    const length = snap(Math.min(5, Math.max(0.1, d.length + dt)));
    if (d.which === "enter") onTiming(d.id, d.mode === "move" ? { enterAt: at } : { enterFor: length });
    else onTiming(d.id, d.mode === "move" ? { exitAt: at } : { exitFor: length });
  }
  function scrub(e: ReactPointerEvent) {
    const r = track.current?.getBoundingClientRect();
    if (!r) return;
    onScrub(Math.min(duration, Math.max(0, ((e.clientX - r.left) / r.width) * duration)));
  }
  const ticks = Math.floor(duration) + 1;

  return (
    <section className="se-timeline" data-testid="design-timeline" aria-label="Timeline">
      <div className="se-timeline__bar">
        <button type="button" className="se-play" onClick={onPlay} aria-label={playing ? "Stop" : "Play"} data-testid="design-play">
          <Icon d={playing ? "M7 6h3v12H7zM14 6h3v12h-3z" : "M8 5l11 7-11 7z"} size={16} />
        </button>
        <span className="se-timeline__clock">
          {(time ?? 0).toFixed(1)}
          <span> / </span>
          <label className="se-unit" title="Slide length">
            <input
              type="number"
              min={1}
              max={DESIGN_LIMITS.duration}
              step={0.5}
              value={duration}
              onChange={(e) => onDuration(clamp(Number(e.target.value), 1, DESIGN_LIMITS.duration))}
              aria-label="Slide length in seconds"
              data-testid="design-duration"
            />
            s
          </label>
        </span>
        <span className="se-hint">{moves ? "Exports as video" : "Still: exports as a picture"}</span>
        {selected && (
          <button type="button" className="link-button se-timeline__all" onClick={() => onSelect(null)}>
            Show all layers
          </button>
        )}
      </div>
      {late && <p className="form-error">Something moves after the slide ends. Make the slide longer, or move it earlier.</p>}
      <div className="se-timeline__grid" onPointerMove={move} onPointerUp={() => (drag.current = null)} onPointerCancel={() => (drag.current = null)}>
        <span />
        <div className="se-timeline__ruler" ref={track} onPointerDown={scrub} title="Drag to see a moment">
          {Array.from({ length: ticks }, (_, i) => (
            <span key={i} style={{ left: pct(i) }} data-edge={i === 0 ? "start" : i === ticks - 1 && i === duration ? "end" : undefined}>
              {i}s
            </span>
          ))}
          {time !== null && <i className="se-timeline__head" style={{ left: pct(time) }} />}
        </div>
        {rows.length === 0 && (
          <>
            <span />
            <p className="se-hint se-timeline__empty">
              {selected ? "This layer doesn't move. Give it an entrance or an exit under Motion." : "Nothing moves yet. Select a layer and give it an entrance or an exit."}
            </p>
          </>
        )}
        {rows.map((l) => {
          const inEnd = l.enter === "none" ? 0 : l.enterAt + l.enterFor;
          const outStart = l.exit === "none" ? duration : l.exitAt;
          return (
            <div key={l.id} className="se-timeline__row" data-active={l.id === selected}>
              <button type="button" className="se-timeline__name" onClick={() => onSelect(l.id)}>
                {l.name}
              </button>
              <div className="se-timeline__track">
                <span className="se-timeline__on" style={{ left: pct(l.enter === "none" ? 0 : l.enterAt), width: `calc(${pct(Math.max(0, (l.exit === "none" ? duration : l.exitAt + l.exitFor) - (l.enter === "none" ? 0 : l.enterAt)))})` }} />
                {l.enter !== "none" && (
                  <span className="se-timeline__move se-timeline__move--in" style={{ left: pct(l.enterAt), width: pct(l.enterFor) }} onPointerDown={(e) => down(e, l.id, "enter", "move", l.enterAt, l.enterFor)} title={`${ENTRANCE_LABELS[l.enter]}: ${l.enterAt} s, takes ${l.enterFor} s`}>
                    <span>{ENTRANCE_LABELS[l.enter]}</span>
                    <b onPointerDown={(e) => down(e, l.id, "enter", "length", l.enterAt, l.enterFor)} aria-hidden />
                  </span>
                )}
                {l.exit !== "none" && (
                  <span className="se-timeline__move se-timeline__move--out" style={{ left: pct(l.exitAt), width: pct(l.exitFor) }} onPointerDown={(e) => down(e, l.id, "exit", "move", l.exitAt, l.exitFor)} title={`${EXIT_LABELS[l.exit]}: ${l.exitAt} s, takes ${l.exitFor} s`}>
                    <span>{EXIT_LABELS[l.exit]}</span>
                    <b onPointerDown={(e) => down(e, l.id, "exit", "length", l.exitAt, l.exitFor)} aria-hidden />
                  </span>
                )}
                {inEnd > outStart && <span className="se-timeline__clash" title="The exit starts before the entrance ends" />}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Icon({ d, size = 15 }: { d: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

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
  duration,
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
  duration: number;
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
    <div className="se-inspector" onBlur={done} onPointerUp={done}>
      <div className="se-panel__head">
        <h3>{TYPE_LABELS[l.type]}</h3>
        <span className="se-icons">
          <button type="button" className="se-icon" title="Duplicate" aria-label="Duplicate this layer" onClick={onDuplicate}>
            <Icon d="M8 8h12v12H8zM4 16V4h12" />
          </button>
          <button type="button" className="se-icon" title="Delete" aria-label="Delete this layer" onClick={onDelete} disabled={l.locked} data-testid="design-delete-layer">
            <Icon d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
          </button>
        </span>
      </div>
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

      {l.type === "video" && (
        <>
          {l.clip?.credit && (
            <p className="card__meta">
              Video by{" "}
              <a href={l.clip.credit.pageUrl} target="_blank" rel="noreferrer">
                {l.clip.credit.name}
              </a>{" "}
              on Pixabay
            </p>
          )}
          <span className="design-editor__row">
            <button type="button" className="button button-secondary button-small" onClick={onFindPhoto} data-testid="design-find-clip">
              Find a clip
            </button>
            <label className="button button-secondary button-small">
              {busy === "upload" ? "Uploading…" : "Upload"}
              <input
                type="file"
                accept="video/mp4,video/quicktime"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) onUpload(f);
                }}
              />
            </label>
          </span>
          {l.clip && (
            <>
              <Range label="Starts at" value={l.trimStart} min={0} max={Math.max(0, l.clip.duration - 0.5)} step={0.1} suffix=" s" onStart={onRemember} onChange={(n) => onSet({ trimStart: n, trimEnd: Math.max(l.trimEnd, n + 0.5) } as Partial<Layer>, false)} />
              <Range label="Ends at" value={l.trimEnd} min={Math.min(l.clip.duration, l.trimStart + 0.5)} max={l.clip.duration} step={0.1} suffix=" s" onStart={onRemember} onChange={(n) => onSet({ trimEnd: n } as Partial<Layer>, false)} />
              <p className="card__meta">
                Uses {round(l.trimEnd - l.trimStart)} s of the {round(l.clip.duration)} s clip
                {l.trimEnd - l.trimStart < duration - 0.05 ? ", looped to fill the slide" : ""}. No sound.
              </p>
            </>
          )}
          <div className="field">
            <span>Placement</span>
            <span className="design-editor__seg">
              <button type="button" aria-pressed={l.fit === "cover"} onClick={() => set({ fit: "cover" } as Partial<Layer>)}>
                Fill
              </button>
              <button type="button" aria-pressed={l.fit === "contain"} onClick={() => set({ fit: "contain" } as Partial<Layer>)}>
                Fit
              </button>
            </span>
          </div>
          <Range label="Corners" value={l.radius} min={0} max={20} step={0.2} onStart={onRemember} onChange={(n) => onSet({ radius: n } as Partial<Layer>, false)} />
          <Range label="Brightness" value={l.brightness} min={30} max={160} suffix="%" onStart={onRemember} onChange={(n) => onSet({ brightness: n } as Partial<Layer>, false)} />
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
      <h4 className="se-subhead">Motion</h4>
      <MotionField
        label="Entrance"
        options={ENTRANCES.map((k) => [k, ENTRANCE_LABELS[k]])}
        value={l.enter}
        at={l.enterAt}
        length={l.enterFor}
        duration={duration}
        onKind={(k) => set({ enter: k as Entrance })}
        onTiming={(at, length) => set({ enterAt: at, enterFor: length })}
        testId="design-entrance"
      />
      <MotionField
        label="Exit"
        options={EXITS.map((k) => [k, EXIT_LABELS[k]])}
        value={l.exit}
        at={l.exitAt}
        length={l.exitFor}
        duration={duration}
        // A new exit ends with the slide.
        onKind={(k) => set(l.exit === "none" && k !== "none" ? { exit: k as Exit, exitAt: Math.max(0, round(duration - l.exitFor)) } : { exit: k as Exit })}
        onTiming={(at, length) => set({ exitAt: at, exitFor: length })}
        testId="design-exit"
      />
      {tallMoved && (
        <button type="button" className="link-button" onClick={onResetTall}>
          Put back where the other platforms have it
        </button>
      )}
    </div>
  );
}

/** An entrance or exit: its kind, and when it starts and how long it takes. */
function MotionField({
  label,
  options,
  value,
  at,
  length,
  duration,
  onKind,
  onTiming,
  testId,
}: {
  label: string;
  options: Array<[string, string]>;
  value: string;
  at: number;
  length: number;
  duration: number;
  onKind: (k: string) => void;
  onTiming: (at: number, length: number) => void;
  testId: string;
}) {
  return (
    <div className="se-motion">
      <label className="field">
        <span>{label}</span>
        <select value={value} onChange={(e) => onKind(e.target.value)} data-testid={testId}>
          {options.map(([k, text]) => (
            <option key={k} value={k}>
              {text}
            </option>
          ))}
        </select>
      </label>
      {value !== "none" && (
        <div className="se-motion__timing">
          <label className="field">
            <span>Starts</span>
            <span className="se-unit">
              <input type="number" min={0} max={duration} step={0.1} value={at} onChange={(e) => onTiming(clamp(Number(e.target.value), 0, duration), length)} />s
            </span>
          </label>
          <label className="field">
            <span>Takes</span>
            <span className="se-unit">
              <input type="number" min={0.1} max={5} step={0.1} value={length} onChange={(e) => onTiming(at, clamp(Number(e.target.value), 0.1, 5))} />s
            </span>
          </label>
        </div>
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
  const more = useMemo(
    () => LAYOUT_KEYS.map((key) => ({ key, design: layoutDesign(key, { ...words, photo }, slide.design?.bg ?? "cream") })),
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
        <h3>More layouts</h3>
        <div className="design-layouts__grid" data-testid="design-more-layouts">
          {more.map((m) => (
            <button key={m.key} type="button" className="design-layouts__item" onClick={() => onApply(cloneDesign(m.design), LAYOUT_KINDS[m.key])}>
              {thumb(m.design)}
              <span>{LAYOUT_LABELS[m.key]}</span>
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
