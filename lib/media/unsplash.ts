/**
 * Stock photos from Unsplash (server only; UNSPLASH_ACCESS_KEY). Follows
 * their API guidelines: an author searches and chooses every photo (no
 * automatic picking), photos are shown from Unsplash's own image URLs,
 * choosing one triggers its download event, and every photo is credited
 * "Photo by <name> on Unsplash" with both linked.
 */
const API = "https://api.unsplash.com";
const UTM = "utm_source=stratacouncil&utm_medium=referral";

export class PhotoError extends Error {}

export interface StockPhoto {
  id: string;
  description: string;
  thumbUrl: string;
  url: string;
  width: number;
  height: number;
  photographer: string;
  profileUrl: string;
  photoUrl: string;
  downloadLocation: string;
}

/** Recent searches, so reopening a screen doesn't search again. */
const cache = new Map<string, { at: number; photos: StockPhoto[]; totalPages: number }>();
const CACHE_MS = 60 * 60 * 1000;

function headers() {
  const k = process.env.UNSPLASH_ACCESS_KEY;
  if (!k) throw new PhotoError("Photo search isn't set up yet (missing Unsplash key).");
  return { Authorization: `Client-ID ${k}`, "Accept-Version": "v1" };
}

export function withUtm(url: string) {
  return url + (url.includes("?") ? "&" : "?") + UTM;
}

export async function searchPhotos(query: string, page = 1): Promise<{ photos: StockPhoto[]; totalPages: number }> {
  const q = query.trim().slice(0, 100);
  if (!q) return { photos: [], totalPages: 0 };
  const cacheKey = `${q.toLowerCase()}|${page}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit;

  const params = new URLSearchParams({ query: q, page: String(page), per_page: "12", orientation: "landscape", content_filter: "high" });
  const res = await fetch(`${API}/search/photos?${params}`, { headers: headers(), cache: "no-store" });
  if (!res.ok) {
    console.error("[unsplash search]", res.status);
    if (res.status === 401) throw new PhotoError("Unsplash didn't accept the key. Check UNSPLASH_ACCESS_KEY.");
    if (res.status === 403 || res.status === 429) throw new PhotoError("The hourly photo-search limit is used up. Try again later.");
    throw new PhotoError("Photo search didn't work. Try again.");
  }
  const data = (await res.json()) as {
    total_pages?: number;
    results?: {
      id: string;
      description: string | null;
      alt_description: string | null;
      width: number;
      height: number;
      urls: { small: string; regular: string };
      links: { html: string; download_location: string };
      user: { name: string; links: { html: string } };
    }[];
  };
  const photos = (data.results ?? []).map((p) => ({
    id: p.id,
    description: (p.alt_description || p.description || "").slice(0, 300),
    thumbUrl: p.urls.small,
    url: p.urls.regular,
    width: p.width,
    height: p.height,
    photographer: p.user.name,
    profileUrl: withUtm(p.user.links.html),
    photoUrl: withUtm(p.links.html),
    downloadLocation: p.links.download_location,
  }));
  const result = { at: Date.now(), photos, totalPages: data.total_pages ?? 0 };
  if (cache.size > 200) cache.delete(cache.keys().next().value as string);
  cache.set(cacheKey, result);
  return result;
}

/** Tell Unsplash a photo was used (required when an author chooses one). */
export async function trackPhotoUse(downloadLocation: string) {
  let url: URL;
  try {
    url = new URL(downloadLocation);
  } catch {
    throw new PhotoError("That photo isn't valid.");
  }
  if (url.protocol !== "https:" || url.hostname !== "api.unsplash.com" || !url.pathname.startsWith("/photos/")) {
    throw new PhotoError("That photo isn't valid.");
  }
  const res = await fetch(url, { headers: headers(), cache: "no-store" });
  if (!res.ok) console.error("[unsplash download]", res.status);
}
