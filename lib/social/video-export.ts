import { toCanvas } from "html-to-image";
import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import { BRAND, boxFor, clipTime, layerAt, STILL, type Layer, type SlideDesign, type VideoLayer } from "./design.ts";

/**
 * A moving slide to MP4, in the browser (docs/marketing.md, "Socials
 * editor"). The layers come from the same drawing as the PNG export (the
 * slide on the hidden export stage): runs of layers that don't move are
 * drawn once, each moving layer is drawn on its own, and every frame puts
 * them together with the motion at that moment, with video clips drawn
 * frame by frame. Encoded with WebCodecs (H.264 where the browser has it),
 * 30 frames a second, no sound.
 */

export const FPS = 30;

export class VideoExportError extends Error {
  name = "VideoExportError";
}

export function canExportVideo(): boolean {
  return typeof window !== "undefined" && "VideoEncoder" in window && "VideoFrame" in window;
}

/** The first codec this browser can encode at this size: H.264 (what every platform takes), else VP9. */
async function pickCodec(width: number, height: number): Promise<{ config: VideoEncoderConfig; muxer: "avc" | "vp9" }> {
  const bitrate = 9_000_000;
  const tries: Array<{ codec: string; muxer: "avc" | "vp9" }> = [
    { codec: "avc1.64002a", muxer: "avc" },
    { codec: "avc1.640028", muxer: "avc" },
    { codec: "avc1.4d002a", muxer: "avc" },
    { codec: "avc1.42002a", muxer: "avc" },
    { codec: "vp09.00.40.08", muxer: "vp9" },
  ];
  for (const t of tries) {
    const config: VideoEncoderConfig = { codec: t.codec, width, height, bitrate, framerate: FPS, ...(t.muxer === "avc" ? { avc: { format: "avc" } } : {}) };
    try {
      const { supported } = await VideoEncoder.isConfigSupported(config);
      if (supported) return { config, muxer: t.muxer };
    } catch {
      // Not this one.
    }
  }
  throw new VideoExportError("This browser can't make video files. Use a current version of Chrome, Edge, or Safari.");
}

type Piece = { kind: "still"; image: HTMLCanvasElement } | { kind: "moving"; layer: Layer; image: HTMLCanvasElement } | { kind: "clip"; layer: VideoLayer; video: HTMLVideoElement };

const isMoving = (l: Layer) => l.enter !== "none" || l.exit !== "none";

/** Draw the slide with only these layers showing, on a clear background. */
async function capture(root: HTMLElement, show: Set<string>, width: number, height: number): Promise<HTMLCanvasElement> {
  const els = Array.from(root.querySelectorAll<HTMLElement>("[data-layer]"));
  const before = els.map((el) => el.style.visibility);
  const bg = root.style.background;
  els.forEach((el) => (el.style.visibility = show.has(el.dataset.layer!) ? "visible" : "hidden"));
  root.style.background = "transparent";
  try {
    // The first capture can miss web fonts and pictures; drawing twice is the documented fix.
    await toCanvas(root, { width, height, pixelRatio: 1, cacheBust: false });
    return await toCanvas(root, { width, height, pixelRatio: 1, cacheBust: false });
  } finally {
    els.forEach((el, i) => (el.style.visibility = before[i]));
    root.style.background = bg;
  }
}

function loadClip(src: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.crossOrigin = "anonymous";
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    const timer = setTimeout(() => reject(new VideoExportError("A video clip didn't load. Reload the page and try again.")), 30_000);
    v.addEventListener("loadeddata", () => (clearTimeout(timer), resolve(v)), { once: true });
    v.addEventListener("error", () => (clearTimeout(timer), reject(new VideoExportError("A video clip couldn't be played in this browser."))), { once: true });
    v.src = src;
  });
}

function seek(v: HTMLVideoElement, t: number): Promise<void> {
  const target = Math.min(Math.max(0, t), Math.max(0, (v.duration || t) - 0.02));
  if (Math.abs(v.currentTime - target) < 0.002 && v.readyState >= 2) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => (clearTimeout(timer), resolve());
    const timer = setTimeout(done, 3000);
    v.addEventListener("seeked", done, { once: true });
    v.currentTime = target;
  });
}

/** Where a picture of this size sits in a box, filling it (cover) or fitting inside it (contain, set to the bottom). */
export function placeMedia(mw: number, mh: number, box: { x: number; y: number; w: number; h: number }, fit: "cover" | "contain") {
  const s = fit === "cover" ? Math.max(box.w / mw, box.h / mh) : Math.min(box.w / mw, box.h / mh);
  const w = mw * s;
  const h = mh * s;
  return { x: box.x + (box.w - w) / 2, y: fit === "cover" ? box.y + (box.h - h) / 2 : box.y + box.h - h, w, h };
}

export interface SlideVideo {
  mp4: Blob;
  /** The last frame, for the still picture and LinkedIn's PDF. */
  still: Blob;
}

/**
 * Make one slide's MP4. `root` is the slide as drawn on the export stage
 * (LayeredSlide, every layer in place).
 */
export async function renderSlideVideo(
  root: HTMLElement,
  design: SlideDesign,
  size: { width: number; height: number },
  onFrame?: (done: number, total: number) => void
): Promise<SlideVideo> {
  if (!canExportVideo()) throw new VideoExportError("This browser can't make video files. Use a current version of Chrome, Edge, or Safari.");
  const { width, height } = size;
  const tall = height > 1500;
  const layers = design.layers.filter((l) => !l.hidden);

  // The pieces, bottom to top: still runs drawn together, moving layers and clips on their own.
  const pieces: Piece[] = [];
  let run = new Set<string>();
  const flush = async () => {
    if (run.size) pieces.push({ kind: "still", image: await capture(root, run, width, height) });
    run = new Set();
  };
  for (const l of layers) {
    if (l.type === "video") {
      await flush();
      if (l.clip?.src) pieces.push({ kind: "clip", layer: l, video: await loadClip(l.clip.src) });
    } else if (isMoving(l)) {
      await flush();
      pieces.push({ kind: "moving", layer: l, image: await capture(root, new Set([l.id]), width, height) });
    } else run.add(l.id);
  }
  await flush();

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false })!;

  /** One frame; `still` draws every layer in place (the still picture). */
  async function draw(t: number, still = false) {
    ctx.save();
    ctx.fillStyle = BRAND[design.bg];
    ctx.fillRect(0, 0, width, height);
    for (const p of pieces) {
      if (p.kind === "still") {
        ctx.drawImage(p.image, 0, 0);
        continue;
      }
      const l = p.layer;
      const m = still ? STILL : layerAt(l, t);
      if (m.opacity <= 0) continue;
      const b = boxFor(design, l, tall);
      const box = { x: (b.x / 100) * width, y: (b.y / 100) * height, w: (b.w / 100) * width, h: (b.h / 100) * height };
      ctx.save();
      const cx = box.x + box.w / 2;
      const cy = box.y + box.h / 2;
      ctx.translate(cx + (m.dx / 100) * width, cy + (m.dy / 100) * height);
      ctx.scale(m.scale, m.scale);
      ctx.translate(-cx, -cy);
      if (p.kind === "moving") {
        ctx.globalAlpha = m.opacity;
        ctx.drawImage(p.image, 0, 0);
      } else {
        const v = p.video;
        await seek(v, clipTime(p.layer, t));
        const radius = (p.layer.radius / 100) * width;
        ctx.beginPath();
        ctx.roundRect(box.x, box.y, box.w, box.h, radius);
        ctx.clip();
        ctx.globalAlpha = (l.opacity / 100) * m.opacity;
        if (p.layer.brightness !== 100) ctx.filter = `brightness(${p.layer.brightness}%)`;
        const at = placeMedia(v.videoWidth || box.w, v.videoHeight || box.h, box, p.layer.fit);
        ctx.drawImage(v, at.x, at.y, at.w, at.h);
      }
      ctx.restore();
    }
    ctx.restore();
  }

  const { config, muxer: muxCodec } = await pickCodec(width, height);
  const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: muxCodec, width, height, frameRate: FPS }, fastStart: "in-memory" });
  let failure: unknown = null;
  const encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => (failure = e) });
  encoder.configure(config);

  const total = Math.max(1, Math.round(design.duration * FPS));
  for (let i = 0; i < total; i++) {
    if (failure) break;
    await draw(i / FPS);
    const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1_000_000) / FPS), duration: Math.round(1_000_000 / FPS) });
    encoder.encode(frame, { keyFrame: i % (FPS * 2) === 0 });
    frame.close();
    // Don't let frames pile up faster than the encoder takes them.
    while (encoder.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 5));
    onFrame?.(i + 1, total);
  }
  if (!failure) await encoder.flush();
  encoder.close();
  for (const p of pieces) if (p.kind === "clip") p.video.removeAttribute("src");
  if (failure) {
    console.error("[video export]", failure);
    throw new VideoExportError("The video didn't finish encoding. Try again, or try another browser.");
  }
  muxer.finalize();
  const mp4 = new Blob([muxer.target.buffer], { type: "video/mp4" });

  // The still: every layer in place, and clips where the slide ends.
  await draw(Math.max(design.duration - 1 / FPS, 0), true);
  const still = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new VideoExportError("The still picture couldn't be drawn."))), "image/png"));
  return { mp4, still };
}
