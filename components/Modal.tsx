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
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
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
