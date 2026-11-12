"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useStrata } from "@/components/StrataContext";
import { navItemsFor } from "@/lib/navigation";
import { RequestSubscriptionButton } from "@/components/RequestSubscriptionButton";
import { STRATASPHERE_PITCH, STRATASPHERE_TITLE } from "@/components/StratasphereValue";
import { SubscriptionPendingNote } from "@/components/SubscriptionPendingNote";

/**
 * The second-level menu inside a strata (2026-11-12): the items of the
 * top-bar section the page belongs to (components/TopNav.tsx).
 *
 *   Your Strata:   Overview, Meetings, Discussions, Documents (free to
 *                  store), Council, Owners, Management (managers and the
 *                  admin), Billing (billing access). Free.
 *   Stratasphere:  Ask (part of the subscription: shown with a lock until
 *                  the strata subscribes).
 *
 * The Library is in Resources (/library), and the decision ledger has no
 * page of its own: Stratasphere reads it behind the scenes.
 *
 * A locked item doesn't navigate; it explains what unlocks it and points
 * the admin at billing (subscribing is admin-only).
 */
function LockIcon() {
  return (
    <svg
      className="substrata-nav__lock"
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

export function StrataSphereNav({ active }: { active: string }) {
  const { corpId, subscribed, pending, canBill, canManage, seesDiscussions } = useStrata();
  const items = navItemsFor(active, { canManage, canBill, seesDiscussions });
  const [prompt, setPrompt] = useState<string | null>(null);

  return (
    <>
      <nav className="substrata-nav" aria-label={items[0]?.section === "stratasphere" ? "Stratasphere" : "Your Strata"}>
        {items.map((item) => {
          const key = item.slug || "home";
          const locked = item.gated && !subscribed;
          if (locked) {
            return (
              <button
                key={key}
                type="button"
                className="substrata-nav__locked"
                data-active={active === key}
                data-desktop-only={item.phone ? undefined : "true"}
                aria-disabled="true"
                onClick={() => setPrompt(item.label)}
                data-testid={`nav-locked-${key}`}
              >
                {item.label}
                <LockIcon />
                <span className="visually-hidden"> (requires a subscription)</span>
              </button>
            );
          }
          return (
            <Link
              key={key}
              href={`/strata/${corpId}${item.slug ? `/${item.slug}` : ""}`}
              data-active={active === key}
              // Ask works on phones (ScreenGate).
              data-desktop-only={item.phone ? undefined : "true"}
              data-testid={`nav-${key}`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      {prompt && (
        <SubscribePrompt
          corpId={corpId}
          canBill={canBill}
          pending={pending}
          onClose={() => setPrompt(null)}
        />
      )}
    </>
  );
}

function SubscribePrompt({
  corpId,
  canBill,
  pending,
  onClose,
}: {
  corpId: string;
  canBill: boolean;
  pending: boolean;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="subscribe-prompt-title"
        onClick={(e) => e.stopPropagation()}
        data-testid="subscribe-prompt"
      >
        <h2 id="subscribe-prompt-title">{pending ? "Stratasphere™ is on its way" : STRATASPHERE_TITLE}</h2>
        {pending ? <SubscriptionPendingNote /> : <p>{STRATASPHERE_PITCH}</p>}
        {!canBill && !pending && (
          <p className="card__meta">
            Only your strata&rsquo;s admin can subscribe. Request it and we&rsquo;ll email them for you.
          </p>
        )}
        <div className="role-editor__actions">
          <button ref={closeRef} type="button" className="button button-secondary" onClick={onClose}>
            {pending ? "OK" : "Not now"}
          </button>
          {pending ? null : canBill ? (
            <Link
              href={`/strata/${corpId}/billing?step=plan`}
              className="button button-primary"
              data-testid="subscribe-prompt-billing"
            >
              Subscribe
            </Link>
          ) : (
            <RequestSubscriptionButton corpId={corpId} />
          )}
        </div>
      </div>
    </div>
  );
}
