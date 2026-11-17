"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A window that floats over the page (Stratasphere, site-wide): drag it by
 * its title bar, resize it from the bottom-right corner, close it to its
 * button. It remembers where each person left it, in this browser, and
 * can't be dragged out of sight. On a phone there's no room to float, so it
 * fills the screen.
 *
 * `corner` is where it first opens: bottom right everywhere, as the
 * Stratasphere button is.
 */

type Rect = { x: number; y: number; w: number; h: number };

const MIN_W = 320;
const MIN_H = 280;
const MARGIN = 12;
const PHONE = "(max-width: 640px)";

function load(key: string): Rect | null {
  try {
    const v = JSON.parse(window.localStorage.getItem(key) ?? "null") as Rect | null;
    return v && [v.x, v.y, v.w, v.h].every((n) => typeof n === "number" && Number.isFinite(n)) ? v : null;
  } catch {
    return null;
  }
}

function save(key: string, r: Rect) {
  try {
    window.localStorage.setItem(key, JSON.stringify(r));
  } catch {
    // A private window or blocked storage: it just won't remember.
  }
}

/** Kept on screen: at least the title bar reachable, and no bigger than the window. */
export function clampRect(r: Rect, vw: number, vh: number): Rect {
  const w = Math.min(Math.max(r.w, MIN_W), Math.max(MIN_W, vw - MARGIN * 2));
  const h = Math.min(Math.max(r.h, MIN_H), Math.max(MIN_H, vh - MARGIN * 2));
  const x = Math.min(Math.max(r.x, MARGIN), Math.max(MARGIN, vw - w - MARGIN));
  const y = Math.min(Math.max(r.y, MARGIN), Math.max(MARGIN, vh - h - MARGIN));
  return { x, y, w, h };
}

function initial(vw: number, vh: number, rightGap: number): Rect {
  const w = Math.min(420, vw - MARGIN * 2);
  const h = Math.min(Math.round(vh * 0.7), 640);
  return clampRect({ x: vw - w - rightGap, y: vh - h - 24, w, h }, vw, vh);
}

export function FloatingWindow(props: {
  /** localStorage key for where it was left. */
  storageKey: string;
  title: React.ReactNode;
  /** Buttons in the title bar, before Close. */
  actions?: React.ReactNode;
  onClose: () => void;
  label: string;
  testId?: string;
  /** Kept on the page but out of sight, so a question being answered isn't lost when it's closed. */
  hidden?: boolean;
  /** Room left on the right the first time it opens (in a meeting, the People and Chat column). */
  rightGap?: number;
  children: React.ReactNode;
}) {
  const { storageKey } = props;
  const [rect, setRect] = useState<Rect | null>(null);
  const [phone, setPhone] = useState(false);
  const box = useRef<HTMLElement>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  useEffect(() => {
    const mq = window.matchMedia(PHONE);
    const onChange = () => setPhone(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    setRect(clampRect(load(storageKey) ?? initial(vw, vh, props.rightGap ?? 24), vw, vh));
    const onResize = () => setRect((r) => (r ? clampRect(r, window.innerWidth, window.innerHeight) : r));
    window.addEventListener("resize", onResize);
    return () => {
      mq.removeEventListener("change", onChange);
      window.removeEventListener("resize", onResize);
    };
  }, [storageKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Its size after a resize from the corner (CSS `resize`), remembered.
  useEffect(() => {
    const el = box.current;
    if (!el || phone || typeof ResizeObserver === "undefined") return;
    let first = true;
    const ro = new ResizeObserver(() => {
      if (first) {
        first = false;
        return;
      }
      // Hidden (closed but kept), it measures nothing: not a resize.
      if (el.offsetWidth === 0 || el.offsetHeight === 0) return;
      setRect((r) => {
        if (!r) return r;
        const next = clampRect({ ...r, w: el.offsetWidth, h: el.offsetHeight }, window.innerWidth, window.innerHeight);
        save(storageKey, next);
        return next;
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [phone, storageKey, rect === null]); // eslint-disable-line react-hooks/exhaustive-deps

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (phone || !rect || e.button !== 0) return;
      // Buttons and links in the title bar still click.
      if ((e.target as HTMLElement).closest("button, a, input, select, textarea")) return;
      drag.current = { dx: e.clientX - rect.x, dy: e.clientY - rect.y };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      e.preventDefault();
    },
    [phone, rect]
  );
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    setRect((r) => (r ? clampRect({ ...r, x: e.clientX - d.dx, y: e.clientY - d.dy }, window.innerWidth, window.innerHeight) : r));
  }, []);
  const onPointerUp = useCallback(() => {
    if (!drag.current) return;
    drag.current = null;
    setRect((r) => {
      if (r) save(storageKey, r);
      return r;
    });
  }, [storageKey]);

  // The keyboard: arrows move it while the title bar has focus.
  const onKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (phone || !rect) return;
    const step = e.shiftKey ? 40 : 10;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    const next = clampRect({ ...rect, x: rect.x + m[0], y: rect.y + m[1] }, window.innerWidth, window.innerHeight);
    setRect(next);
    save(storageKey, next);
  };

  if (!rect) return null;
  const style = phone ? undefined : { left: rect.x, top: rect.y, width: rect.w, height: rect.h };
  return (
    <aside ref={box} className="float-win" data-phone={phone || undefined} hidden={props.hidden} style={style} role="dialog" aria-label={props.label} data-testid={props.testId}>
      <header
        className="float-win__head"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        tabIndex={phone ? undefined : 0}
        title={phone ? undefined : "Drag to move. Resize from the bottom-right corner."}
        data-testid={props.testId ? `${props.testId}-head` : undefined}
      >
        <strong className="float-win__title">{props.title}</strong>
        <div className="float-win__actions">
          {props.actions}
          <button type="button" className="float-win__close" onClick={props.onClose} aria-label={`Close ${props.label}`} data-testid={props.testId ? `${props.testId}-close` : undefined}>
            &times;
          </button>
        </div>
      </header>
      <div className="float-win__body">{props.children}</div>
    </aside>
  );
}
