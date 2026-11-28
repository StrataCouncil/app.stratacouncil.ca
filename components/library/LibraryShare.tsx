"use client";

import { useState } from "react";

/**
 * Share and Print for a Library item. Share opens the phone's share sheet;
 * on a computer it copies the link. Someone without an account who opens
 * the link signs up and lands back on the item (the `next` carried through
 * sign-up, lib/auth/auth-links.ts). Print is the browser's own dialog,
 * which can also save a PDF; the print styles keep just the item, its
 * sources, and its address (app/globals.css, "A printed playbook").
 */
export function LibraryShare({ url, title }: { url: string; title: string }) {
  const [note, setNote] = useState("");

  async function share() {
    setNote("");
    const phone = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
    if (phone && typeof navigator.share === "function") {
      try {
        await navigator.share({ title, url });
      } catch {
        // Closing the share sheet isn't an error worth showing.
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setNote("Link copied.");
    } catch {
      setNote(`Copy this link: ${url}`);
    }
  }

  return (
    <div className="lib-share" data-testid="library-share">
      <button type="button" className="button button-secondary button-small" onClick={share} data-testid="library-share-button">
        Share
      </button>
      <button type="button" className="button button-secondary button-small" onClick={() => window.print()} data-testid="library-print-button">
        Print
      </button>
      {note && (
        <span className="lib-share__note" role="status" data-testid="library-share-note">
          {note}
        </span>
      )}
    </div>
  );
}
