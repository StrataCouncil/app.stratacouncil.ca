"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import { searchStockPhotos } from "@/app/admin/training/actions";
import type { StockPhoto } from "@/lib/media/unsplash";
import type { PhotoCredit } from "@/lib/training/slides";

export interface PickedPhoto {
  src: string;
  alt: string;
  credit: PhotoCredit;
  /** Unsplash's download event for the photo: triggered when it's put on a slide. */
  downloadLocation: string;
}

/**
 * Search Unsplash and choose a photo. Nothing is searched until an author
 * opens the picker (it starts with the suggested words), and nothing is
 * used until they choose a photo; putting it on a slide tells Unsplash it
 * was used.
 */
export function PhotoPicker({
  moduleId,
  initialQuery,
  onPick,
  onClose,
}: {
  moduleId: string;
  initialQuery: string;
  onPick: (p: PickedPhoto) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [searched, setSearched] = useState("");
  const [photos, setPhotos] = useState<StockPhoto[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search(q: string, p: number) {
    if (!q.trim()) return;
    setBusy(true);
    setError(null);
    const r = await searchStockPhotos(moduleId, q, p);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setPhotos(p === 1 ? r.photos : (prev) => [...prev, ...r.photos]);
    setPage(p);
    setTotalPages(r.totalPages);
    setSearched(q);
  }

  // Run the suggested search once when the picker opens: the author opened it to look.
  useEffect(() => {
    if (initialQuery.trim()) void search(initialQuery, 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function choose(p: StockPhoto) {
    onPick({
      src: p.url,
      alt: p.description,
      credit: { source: "unsplash", name: p.photographer, profileUrl: p.profileUrl, photoUrl: p.photoUrl },
      downloadLocation: p.downloadLocation,
    });
  }

  return (
    <Modal title="Find a photo" onClose={onClose} wide>
      <form
        className="photo-picker__search"
        onSubmit={(e) => {
          e.preventDefault();
          void search(query, 1);
        }}
      >
        <input value={query} maxLength={100} autoFocus placeholder="e.g. people at meeting table" onChange={(e) => setQuery(e.target.value)} aria-label="Search photos" />
        <button className="button button-primary button-small" disabled={busy || !query.trim()}>
          Search
        </button>
      </form>
      {error && (
        <p className="form-alert" role="alert">
          {error}
        </p>
      )}
      {searched && !busy && photos.length === 0 && !error && <p className="card__meta">No photos for &ldquo;{searched}&rdquo;. Try other words.</p>}
      <div className="photo-picker__grid">
        {photos.map((p) => (
          <figure key={p.id} className="photo-picker__item">
            <button type="button" onClick={() => choose(p)} disabled={busy} aria-label={`Use this photo: ${p.description || "photo"} by ${p.photographer}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.thumbUrl} alt={p.description} loading="lazy" />
            </button>
            <figcaption>
              <a href={p.profileUrl} target="_blank" rel="noreferrer">
                {p.photographer}
              </a>
            </figcaption>
          </figure>
        ))}
      </div>
      <div className="photo-picker__foot">
        <span className="card__meta">
          Photos from{" "}
          <a href="https://unsplash.com/?utm_source=stratacouncil&utm_medium=referral" target="_blank" rel="noreferrer">
            Unsplash
          </a>
          , credited to the photographer wherever they appear.
        </span>
        {page < totalPages && (
          <button type="button" className="button button-secondary button-small" disabled={busy} onClick={() => search(searched, page + 1)}>
            {busy ? "Loading…" : "More photos"}
          </button>
        )}
      </div>
    </Modal>
  );
}

/** "Photo by Name on Unsplash", both linked: shown under every stock photo, in the builder and to learners. */
export function PhotoCreditLine({ credit }: { credit: PhotoCredit | null }) {
  if (!credit) return null;
  return (
    <span className="photo-credit">
      Photo by{" "}
      <a href={credit.profileUrl} target="_blank" rel="noreferrer">
        {credit.name}
      </a>{" "}
      on{" "}
      <a href="https://unsplash.com/?utm_source=stratacouncil&utm_medium=referral" target="_blank" rel="noreferrer">
        Unsplash
      </a>
    </span>
  );
}
