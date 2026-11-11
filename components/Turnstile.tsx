"use client";

import { useEffect, useRef } from "react";

/**
 * Cloudflare Turnstile, the bot check on forms that send email
 * (lib/security/turnstile.ts). Usually invisible: it only shows a checkbox
 * when Cloudflare isn't sure. It puts a one-time token in the form as
 * `cf-turnstile-response`.
 *
 * Without NEXT_PUBLIC_TURNSTILE_SITE_KEY (local development, tests) it
 * renders nothing and the form works as before.
 *
 * `resetKey`: change it after each submit (the form's result) to get a
 * fresh token, since a token is good for one check only.
 */

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let loading: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = SCRIPT;
      s.async = true;
      s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("Turnstile didn't load.")));
      s.onerror = () => {
        loading = null;
        reject(new Error("Turnstile didn't load."));
      };
      document.head.appendChild(s);
    });
  }
  return loading;
}

export function Turnstile({ action, resetKey }: { action: string; resetKey?: unknown }) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const box = useRef<HTMLDivElement>(null);
  const id = useRef<string | null>(null);

  useEffect(() => {
    if (!siteKey || !box.current) return;
    let gone = false;
    loadTurnstile()
      .then((t) => {
        if (gone || !box.current) return;
        id.current = t.render(box.current, { sitekey: siteKey, action, appearance: "interaction-only", theme: "light" });
      })
      .catch((err) => console.warn("[turnstile]", err instanceof Error ? err.message : err));
    return () => {
      gone = true;
      if (id.current && window.turnstile) window.turnstile.remove(id.current);
      id.current = null;
    };
  }, [siteKey, action]);

  useEffect(() => {
    if (id.current && window.turnstile) window.turnstile.reset(id.current);
  }, [resetKey]);

  if (!siteKey) return null;
  return <div ref={box} className="turnstile" data-testid="turnstile" />;
}
