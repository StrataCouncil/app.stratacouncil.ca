"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useStrata } from "@/components/StrataContext";
import { RequestSubscriptionButton } from "@/components/RequestSubscriptionButton";

/**
 * StrataSphere sub-nav (doc03 "second level"): free sections show fully
 * open, gated sections stay visible but greyed with a lock — the tab
 * should read as "your strata's home, some of it unlocked, some of it
 * not," never as a paywall that hides things. Clicking a locked section
 * doesn't navigate; it explains what unlocks it and points the admin at
 * billing (subscribing is admin-only, doc01 §7 item 7).
 *
 * No standalone "Decisions" item — the decision ledger feeds the AI's
 * context and has no browse surface (doc01 §4a). No "Calendar" either —
 * not built in V1 (doc01 §7 item 21).
 */
const allItems: Array<{ slug: string; label: string; gated: boolean; managersOnly?: boolean; adminsOnly?: boolean }> = [
  { slug: "guides", label: "Knowledge Library", gated: false },
  { slug: "", label: "Council & Roles", gated: false },
  { slug: "lots", label: "Strata Lots", gated: false },
  { slug: "documents", label: "Documents", gated: false },
  { slug: "minutes", label: "Minutes", gated: false },
  { slug: "meetings", label: "Meetings", gated: false },
  { slug: "assistant", label: "Stratasphere™", gated: true },
  // Billing is admin-only (doc01 §7 item 7); others never see the tab.
  { slug: "billing", label: "Billing", gated: false, adminsOnly: true },
  // Only the Admin and the Manager role see this one at all.
  { slug: "management", label: "Management", gated: false, managersOnly: true },
];

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
  const { corpId, subscribed, isAdmin, canManage } = useStrata();
  const items = allItems.filter((i) => (!i.managersOnly || canManage) && (!i.adminsOnly || isAdmin));
  const [prompt, setPrompt] = useState<string | null>(null);

  return (
    <>
      <nav className="substrata-nav" aria-label="Stratasphere">
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
                data-desktop-only="true"
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
              data-desktop-only={item.slug === "guides" ? undefined : "true"}
              data-testid={`nav-${key}`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      {prompt && (
        <SubscribePrompt
          feature={prompt}
          corpId={corpId}
          isAdmin={isAdmin}
          onClose={() => setPrompt(null)}
        />
      )}
    </>
  );
}

function SubscribePrompt({
  feature,
  corpId,
  isAdmin,
  onClose,
}: {
  feature: string;
  corpId: string;
  isAdmin: boolean;
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
        <h2 id="subscribe-prompt-title">{feature} needs a subscription</h2>
        <p>
          The Stratasphere&trade; AI assistant, searching your documents, and
          running meetings beyond your one free meeting all come with a
          Stratasphere&trade; subscription. Roles, the roster, documents and
          the Knowledge Library stay free either way.
        </p>
        {!isAdmin && (
          <p className="card__meta">
            Only your strata&rsquo;s admin can subscribe. Request it and we&rsquo;ll email them for you.
          </p>
        )}
        <div className="role-editor__actions">
          <button ref={closeRef} type="button" className="button button-secondary" onClick={onClose}>
            Not now
          </button>
          {isAdmin ? (
            <Link
              href={`/strata/${corpId}/billing?step=plan`}
              className="button button-primary"
              data-testid="subscribe-prompt-billing"
            >
              See plans
            </Link>
          ) : (
            <RequestSubscriptionButton corpId={corpId} />
          )}
        </div>
      </div>
    </div>
  );
}
