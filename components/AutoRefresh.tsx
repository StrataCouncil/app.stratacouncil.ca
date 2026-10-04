"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Keeps a page's server data fresh without a browser refresh (note 4,
 * 2026-10-05): re-fetches every `seconds` while the tab is visible, and
 * as soon as the tab is shown again. router.refresh() re-renders the
 * server components only; what someone is typing, and any open dialog,
 * stay as they are.
 */
export function AutoRefresh({ seconds = 20 }: { seconds?: number }) {
  const router = useRouter();

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const timer = window.setInterval(tick, seconds * 1000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [router, seconds]);

  return null;
}
