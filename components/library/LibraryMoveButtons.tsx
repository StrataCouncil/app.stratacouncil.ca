"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { moveLibraryItem } from "@/app/admin/library/actions";

/** Up and down arrows on the console's Library list: members see the same order. */
export function LibraryMoveButtons({ id, first, last }: { id: string; first: boolean; last: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const move = (direction: -1 | 1) =>
    start(async () => {
      const r = await moveLibraryItem(id, direction);
      setError(r.ok ? null : r.error);
      if (r.ok) router.refresh();
    });
  return (
    <span className="text-actions">
      <button type="button" className="be-icon" disabled={pending || first} onClick={() => move(-1)} aria-label="Move up">
        &uarr;
      </button>
      <button type="button" className="be-icon" disabled={pending || last} onClick={() => move(1)} aria-label="Move down">
        &darr;
      </button>
      {error && (
        <span className="card__meta" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
