"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import { copySocialClip, searchSocialClips } from "@/app/admin/marketing/socials/actions";
import type { StockClip } from "@/lib/media/pixabay";
import type { SocialClip } from "@/lib/social/post";

/**
 * Search Pixabay's free stock video and choose a clip for a slide. Nothing
 * is searched until the picker opens (with the slide's suggested words);
 * choosing a clip copies it into the post's own folder, so the post never
 * links to Pixabay's files. Previews play on hover, muted.
 */
export function ClipPicker({ postId, initialQuery, onPick, onClose }: { postId: string; initialQuery: string; onPick: (c: SocialClip) => void; onClose: () => void }) {
  const [query, setQuery] = useState(initialQuery);
  const [searched, setSearched] = useState("");
  const [clips, setClips] = useState<StockClip[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [busy, setBusy] = useState<"search" | number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function search(q: string, p: number) {
    if (!q.trim()) return;
    setBusy("search");
    setError(null);
    const r = await searchSocialClips(q, p);
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setClips(p === 1 ? r.clips : (prev) => [...prev, ...r.clips]);
    setPage(p);
    setTotalPages(r.totalPages);
    setSearched(q);
  }

  useEffect(() => {
    if (initialQuery.trim()) void search(initialQuery, 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function choose(c: StockClip) {
    setBusy(c.id);
    setError(null);
    const r = await copySocialClip(postId, c.id);
    setBusy(null);
    if (!r.ok) return setError(r.error);
    onPick(r.clip);
  }

  return (
    <Modal title="Find a video clip" onClose={onClose} wide closeOnBackdrop={busy === null}>
      <form
        className="photo-picker__search"
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void search(query, 1);
        }}
      >
        <input value={query} maxLength={100} autoFocus placeholder="e.g. city apartment building" onChange={(e) => setQuery(e.target.value)} aria-label="Search video clips" />
        <button className="button button-primary button-small" disabled={busy !== null || !query.trim()}>
          Search
        </button>
      </form>
      {error && (
        <p className="form-alert" role="alert">
          {error}
        </p>
      )}
      {typeof busy === "number" && <p className="card__meta">Copying the clip into this post&hellip; (large clips take a moment)</p>}
      {searched && busy !== "search" && clips.length === 0 && !error && <p className="card__meta">No clips for &ldquo;{searched}&rdquo;. Try other words.</p>}
      <div className="photo-picker__grid" data-testid="clip-picker-grid">
        {clips.map((c) => (
          <figure key={c.id} className="photo-picker__item clip-picker__item">
            <button type="button" onClick={() => choose(c)} disabled={busy !== null} aria-label={`Use this clip: ${c.tags || "video"} by ${c.user}, ${Math.round(c.duration)} seconds`}>
              <video
                src={c.previewUrl}
                poster={c.thumbUrl || undefined}
                muted
                loop
                playsInline
                preload="none"
                onMouseEnter={(e) => void e.currentTarget.play().catch(() => undefined)}
                onMouseLeave={(e) => e.currentTarget.pause()}
              />
              <span className="clip-picker__length">{Math.round(c.duration)} s</span>
            </button>
            <figcaption>
              <a href={c.pageUrl} target="_blank" rel="noreferrer">
                {c.user}
              </a>
            </figcaption>
          </figure>
        ))}
      </div>
      <div className="photo-picker__foot">
        <span className="card__meta">
          Videos from{" "}
          <a href="https://pixabay.com/" target="_blank" rel="noreferrer">
            Pixabay
          </a>
          , free to use. A chosen clip is copied into this post.
        </span>
        <span className="photo-picker__actions">
          {page < totalPages && (
            <button type="button" className="button button-secondary button-small" disabled={busy !== null} onClick={() => search(searched, page + 1)}>
              {busy === "search" ? "Loading…" : "More clips"}
            </button>
          )}
        </span>
      </div>
    </Modal>
  );
}
