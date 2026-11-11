/**
 * Stock video from Pixabay (server only; PIXABAY_API_KEY). Follows their
 * API terms (pixabay.com/api/docs): results are cached for 24 hours, the
 * picker says the clips are from Pixabay, and a chosen clip is copied into
 * our own storage rather than linked (no permanent hotlinking). Requests
 * stay well under 100 a minute: one per search page, one per clip chosen.
 */
const API = "https://pixabay.com/api/videos/";
const CACHE_MS = 24 * 60 * 60 * 1000;

export class VideoError extends Error {}

export interface StockClip {
  id: number;
  tags: string;
  /** Seconds. */
  duration: number;
  /** A still to show in the picker, and a small file to preview on hover. */
  thumbUrl: string;
  previewUrl: string;
  /** The file we'd copy: the largest under the size cap. */
  url: string;
  width: number;
  height: number;
  size: number;
  user: string;
  pageUrl: string;
}

/** The largest file we copy into storage (bytes): enough for 1080p clips of a minute or so. */
export const MAX_CLIP_BYTES = 120 * 1024 * 1024;

const cache = new Map<string, { at: number; clips: StockClip[]; totalPages: number }>();

type Rendition = { url?: string; width?: number; height?: number; size?: number; thumbnail?: string };
export interface PixabayHit {
  id: number;
  pageURL: string;
  tags?: string;
  duration?: number;
  user?: string;
  videos?: Partial<Record<"large" | "medium" | "small" | "tiny", Rendition>>;
}

const fromPixabay = (u: unknown): string => {
  try {
    const url = new URL(String(u));
    return url.protocol === "https:" && (url.hostname === "pixabay.com" || url.hostname.endsWith(".pixabay.com")) ? url.toString() : "";
  } catch {
    return "";
  }
};

/** A search result as we use it, or null if it's missing what we need. Pure, so it's tested. */
export function toStockClip(h: PixabayHit): StockClip | null {
  const v = h.videos ?? {};
  // The sharpest file under the cap: large is 1080p or more, medium usually 720p.
  const file = (["large", "medium", "small"] as const).map((k) => v[k]).find((r) => r?.url && fromPixabay(r.url) && (r.size ?? 0) > 0 && (r.size ?? 0) <= MAX_CLIP_BYTES);
  const pageUrl = fromPixabay(h.pageURL);
  if (!file || !pageUrl || !(Number(h.duration) > 0)) return null;
  const thumb = fromPixabay(v.tiny?.thumbnail || v.small?.thumbnail || v.medium?.thumbnail || "");
  return {
    id: Number(h.id),
    tags: String(h.tags ?? "").slice(0, 200),
    duration: Number(h.duration),
    thumbUrl: thumb,
    previewUrl: fromPixabay(v.tiny?.url || v.small?.url || "") || fromPixabay(file.url),
    url: fromPixabay(file.url),
    width: Number(file.width) || 0,
    height: Number(file.height) || 0,
    size: Number(file.size) || 0,
    user: String(h.user ?? "Pixabay").slice(0, 120) || "Pixabay",
    pageUrl,
  };
}

function key() {
  const k = process.env.PIXABAY_API_KEY;
  if (!k) throw new VideoError("Stock video isn't set up yet (missing Pixabay key).");
  return k;
}

async function ask(params: Record<string, string>) {
  const res = await fetch(`${API}?${new URLSearchParams({ key: key(), safesearch: "true", ...params })}`, { cache: "no-store" });
  if (!res.ok) {
    console.error("[pixabay]", res.status);
    if (res.status === 400 || res.status === 401 || res.status === 403) throw new VideoError("Pixabay didn't accept the request. Check PIXABAY_API_KEY.");
    if (res.status === 429) throw new VideoError("Too many video searches in the last minute. Try again shortly.");
    throw new VideoError("Video search didn't work. Try again.");
  }
  return (await res.json()) as { totalHits?: number; hits?: PixabayHit[] };
}

export async function searchClips(query: string, page = 1): Promise<{ clips: StockClip[]; totalPages: number }> {
  const q = query.trim().slice(0, 100);
  if (!q) return { clips: [], totalPages: 0 };
  const cacheKey = `${q.toLowerCase()}|${page}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit;
  const data = await ask({ q, page: String(page), per_page: "18" });
  const clips = (data.hits ?? []).flatMap((h) => toStockClip(h) ?? []);
  const result = { at: Date.now(), clips, totalPages: Math.min(25, Math.ceil((data.totalHits ?? 0) / 18)) };
  cache.set(cacheKey, result);
  if (cache.size > 300) cache.delete(cache.keys().next().value!);
  return result;
}

/** One clip by its id, asked of Pixabay again so the file we copy is theirs (never a link sent by the browser). */
export async function getClip(id: number): Promise<StockClip> {
  if (!Number.isSafeInteger(id) || id <= 0) throw new VideoError("That clip isn't available.");
  const data = await ask({ id: String(id) });
  const clip = data.hits?.[0] ? toStockClip(data.hits[0]) : null;
  if (!clip) throw new VideoError("That clip isn't available, or it's too large to use.");
  return clip;
}

/** Download a clip's file (from Pixabay only), up to the size cap. */
export async function downloadClip(clip: StockClip): Promise<ArrayBuffer> {
  const url = fromPixabay(clip.url);
  if (!url) throw new VideoError("That clip isn't available.");
  const res = await fetch(url, { cache: "no-store", redirect: "follow" });
  if (!res.ok || !res.body) throw new VideoError("Couldn't download the clip from Pixabay. Try again.");
  if (Number(res.headers.get("content-length") ?? 0) > MAX_CLIP_BYTES) throw new VideoError("That clip is too large to use.");
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_CLIP_BYTES) throw new VideoError("That clip is too large to use.");
  return buf;
}
