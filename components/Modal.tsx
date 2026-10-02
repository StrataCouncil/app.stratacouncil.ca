"use client";

import { useEffect, useRef } from "react";

/** A centered dialog over a dimmed page. Escape or a click outside closes it. */
export function Modal({
  title,
  onClose,
  children,
  testId,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  testId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Callers usually pass a fresh onClose on every render; keep the latest
  // one here so the effect below runs once. (Re-running it refocused the
  // dialog on every keystroke, pulling the cursor out of its inputs.)
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    // Focus the dialog when it opens, unless something inside already has focus (autoFocus).
    if (!ref.current?.contains(document.activeElement)) ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="modal-backdrop" onClick={() => close.current()}>
      <div
        ref={ref}
        tabIndex={-1}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        data-testid={testId}
      >
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}
