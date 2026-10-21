"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Logo } from "@/components/Logo";
import { Modal } from "@/components/Modal";
import { saveInvestorNote } from "@/app/investors/actions";
import { INVESTORS_EMAIL, MEETING_URL } from "@/lib/investors/briefing";

type Props = {
  deck: { id: string; pageCount: number; aspect: number };
  slides: string[];
  notes: Record<number, string>;
  startPage: number;
  viewer: { name: string; email: string };
  shareUrl: string;
};

// Viewing time is reported every few seconds while the tab is visible and
// someone has used it in the last few minutes, so an open, idle tab adds nothing.
const REPORT_EVERY_MS = 10_000;
const IDLE_AFTER_MS = 3 * 60_000;

/**
 * The investor briefing (0061): one slide at a time, moved freely with the
 * arrows, the keyboard, a swipe or the slide strip. Notes under each slide
 * save as the investor types. Each slide carries a light watermark with
 * the viewer's email in its bottom-right corner, where the deck has no text.
 */
export function InvestorBriefing({ deck, slides, notes: initialNotes, startPage, viewer, shareUrl }: Props) {
  const [page, setPage] = useState(startPage);
  const [notes, setNotes] = useState<Record<number, string>>(initialNotes);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [sharing, setSharing] = useState(false);
  const [copied, setCopied] = useState(false);
  const total = deck.pageCount;

  const go = useCallback((n: number) => setPage(Math.min(total, Math.max(1, n))), [total]);

  // Keyboard: arrows, Page Up/Down, Home/End (not while typing a note).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.isContentEditable)) return;
      if (document.querySelector(".modal")) return;
      if (e.key === "ArrowRight" || e.key === "PageDown") go(page + 1);
      else if (e.key === "ArrowLeft" || e.key === "PageUp") go(page - 1);
      else if (e.key === "Home") go(1);
      else if (e.key === "End") go(total);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [page, total, go]);

  // Swipe on phones and tablets.
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY });
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touch.current;
    touch.current = null;
    if (!start) return;
    const dx = e.changedTouches[0].clientX - start.x;
    const dy = e.changedTouches[0].clientY - start.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(page + (dx < 0 ? 1 : -1));
  };

  // Viewing time.
  const pageRef = useRef(page);
  const since = useRef(Date.now());
  const lastActive = useRef(Date.now());
  const report = useCallback(
    (beacon = false) => {
      const now = Date.now();
      const counted = document.visibilityState === "visible" && now - lastActive.current < IDLE_AFTER_MS;
      const seconds = counted ? Math.round((now - since.current) / 1000) : 0;
      since.current = now;
      if (seconds <= 0) return;
      const body = JSON.stringify({ deckId: deck.id, page: pageRef.current, seconds: Math.min(seconds, 120) });
      if (beacon && navigator.sendBeacon) navigator.sendBeacon("/api/investors/track", new Blob([body], { type: "application/json" }));
      else fetch("/api/investors/track", { method: "POST", body, keepalive: true, headers: { "Content-Type": "application/json" } }).catch(() => {});
    },
    [deck.id]
  );
  useEffect(() => {
    // Changing slides closes off the time on the previous one.
    if (pageRef.current !== page) report();
    pageRef.current = page;
    since.current = Date.now();
  }, [page, report]);
  useEffect(() => {
    const active = () => (lastActive.current = Date.now());
    const onVisibility = () => {
      if (document.visibilityState === "hidden") report(true);
      else since.current = Date.now();
    };
    const timer = setInterval(() => report(), REPORT_EVERY_MS);
    const events = ["pointermove", "pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const;
    events.forEach((ev) => window.addEventListener(ev, active, { passive: true }));
    const onHide = () => report(true);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onHide);
    return () => {
      clearInterval(timer);
      events.forEach((ev) => window.removeEventListener(ev, active));
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onHide);
    };
  }, [report]);

  // Notes save shortly after typing stops, and before leaving the slide.
  const pending = useRef<{ page: number; body: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const p = pending.current;
    pending.current = null;
    if (!p) return;
    setSaveState("saving");
    const res = await saveInvestorNote(deck.id, p.page, p.body).catch(() => ({ ok: false }));
    setSaveState(res.ok ? "saved" : "error");
  }, [deck.id]);
  const onNote = (value: string) => {
    setNotes((n) => ({ ...n, [page]: value }));
    pending.current = { page, body: value };
    setSaveState("idle");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 800);
  };
  useEffect(() => {
    void flush();
  }, [page, flush]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const mark = `Confidential · ${viewer.email}`;

  return (
    <div className="investor-briefing" onContextMenu={(e) => (e.target as HTMLElement).closest(".investor-slide") && e.preventDefault()}>
      <header className="investor-bar">
        <div className="investor-bar__brand">
          <Logo className="investor-bar__mark" />
          <span>StrataCouncil.ca</span>
          <span className="investor-bar__label">Investor briefing</span>
        </div>
        <nav className="investor-bar__actions" aria-label="Contact">
          <a href={`mailto:${INVESTORS_EMAIL}?subject=${encodeURIComponent("StrataCouncil.ca investor briefing")}`} data-testid="investor-email">
            {INVESTORS_EMAIL}
          </a>
          <a href={MEETING_URL} target="_blank" rel="noopener noreferrer" className="button button-secondary button-small" data-testid="investor-meeting">
            Book a meeting
          </a>
          <button type="button" className="button button-primary button-small" onClick={() => setSharing(true)} data-testid="investor-share">
            Share
          </button>
        </nav>
      </header>

      <main className="investor-stage">
        <div
          className="investor-slide"
          style={{ aspectRatio: String(deck.aspect) }}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          data-testid="investor-slide"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={slides[page - 1]} alt={`Slide ${page} of ${total}`} draggable={false} />
          <span className="investor-slide__mark" aria-hidden="true">
            {mark}
          </span>
          <button type="button" className="investor-slide__nav investor-slide__nav--prev" onClick={() => go(page - 1)} disabled={page === 1} aria-label="Previous slide">
            &#8249;
          </button>
          <button type="button" className="investor-slide__nav investor-slide__nav--next" onClick={() => go(page + 1)} disabled={page === total} aria-label="Next slide">
            &#8250;
          </button>
        </div>

        <div className="investor-controls">
          <button type="button" className="button button-secondary button-small" onClick={() => go(page - 1)} disabled={page === 1}>
            Previous
          </button>
          <span className="investor-controls__count" data-testid="investor-count">
            Slide {page} of {total}
          </span>
          <button type="button" className="button button-secondary button-small" onClick={() => go(page + 1)} disabled={page === total}>
            Next
          </button>
        </div>

        <ol className="investor-strip" aria-label="All slides">
          {slides.map((src, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => go(i + 1)}
                aria-current={page === i + 1 ? "true" : undefined}
                aria-label={`Slide ${i + 1}${notes[i + 1]?.trim() ? ", has notes" : ""}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="" draggable={false} loading="lazy" />
                <span>{i + 1}</span>
                {notes[i + 1]?.trim() && <i className="investor-strip__dot" aria-hidden="true" />}
              </button>
            </li>
          ))}
        </ol>

        <section className="investor-notes">
          <label htmlFor="investor-note">
            Your questions and comments on slide {page}
            <span className="investor-notes__state" aria-live="polite">
              {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : saveState === "error" ? "Not saved. Please try again." : ""}
            </span>
          </label>
          <textarea
            id="investor-note"
            value={notes[page] ?? ""}
            onChange={(e) => onNote(e.target.value)}
            onBlur={() => void flush()}
            maxLength={5000}
            rows={4}
            placeholder="Anything you would like to ask or note about this slide. Saved automatically, and kept for your next visit."
            data-testid="investor-note"
          />
          <p className="investor-notes__fine">
            We read your notes. To reach us directly, email <a href={`mailto:${INVESTORS_EMAIL}`}>{INVESTORS_EMAIL}</a> or{" "}
            <a href={MEETING_URL} target="_blank" rel="noopener noreferrer">
              book a meeting
            </a>
            .
          </p>
        </section>
      </main>

      {sharing && (
        <Modal title="Share the briefing" onClose={() => setSharing(false)} testId="investor-share-dialog">
          <p>
            Send a colleague this link. They will sign up just as you did, accept the same terms, and receive their own
            personal link.
          </p>
          <div className="investor-share">
            <input readOnly value={shareUrl} onFocus={(e) => e.currentTarget.select()} aria-label="Sign-up link" />
            <button type="button" className="button button-primary button-small" onClick={copy}>
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
          <div className="modal__actions">
            <a
              className="button button-secondary"
              href={`mailto:?subject=${encodeURIComponent("StrataCouncil.ca investor briefing")}&body=${encodeURIComponent(`You may be interested in the StrataCouncil.ca investor briefing. Sign up here for your own link:\n\n${shareUrl}`)}`}
            >
              Share by email
            </a>
            <button type="button" className="button button-secondary" onClick={() => setSharing(false)}>
              Close
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
