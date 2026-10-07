"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { DEMO_LIMIT_MESSAGE, SIGNUP_URL } from "@/lib/demo";

/**
 * Mounted on every page of the demo site (AppShell). Three jobs:
 *
 * - The sign-up message, opened by showDemoLimit() (lib/demo-client.ts)
 *   whenever a visitor reaches a limit.
 * - No uploads: only the demo's own materials are there, so choosing a
 *   file anywhere opens the message instead of the file picker.
 * - The activity log (app/api/demo/activity): pages and how long each was
 *   open, clicks, messages shown and errors, sent every few seconds and
 *   when the page closes. Never what's typed into a field.
 */
type LogEvent = { kind: string; path: string; detail?: Record<string, unknown>; at: string };

const ENDPOINT = "/api/demo/activity";

function describe(el: Element): Record<string, unknown> {
  const text = (el.getAttribute("aria-label") || (el as HTMLElement).innerText || el.getAttribute("title") || "").replace(/\s+/g, " ").trim();
  const out: Record<string, unknown> = { label: text.slice(0, 80), tag: el.tagName.toLowerCase() };
  const testId = el.getAttribute("data-testid");
  if (testId) out.testid = testId;
  const href = el.getAttribute("href");
  if (href) out.href = href.slice(0, 300);
  return out;
}

export function DemoGuard() {
  const pathname = usePathname();
  const [reason, setReason] = useState<string | null>(null);
  const queue = useRef<LogEvent[]>([]);
  const page = useRef<{ path: string; since: number } | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const record = (kind: string, detail?: Record<string, unknown>, path?: string) => {
    queue.current.push({ kind, path: path ?? window.location.pathname, detail, at: new Date().toISOString() });
    if (queue.current.length > 200) queue.current.splice(0, queue.current.length - 200);
  };

  // Send what's queued: fetch while the page is open, a beacon as it closes.
  useEffect(() => {
    const flush = (closing = false) => {
      if (!queue.current.length) return;
      const events = queue.current.splice(0, 50);
      const body = JSON.stringify({ events });
      if (closing && navigator.sendBeacon) navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }));
      else void fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => undefined);
    };
    const timer = window.setInterval(() => flush(), 5000);
    const onHide = () => {
      if (page.current) record("leave", { seconds: Math.round((Date.now() - page.current.since) / 1000) }, page.current.path);
      page.current = null;
      flush(true);
    };
    const onShow = () => {
      if (!page.current) {
        page.current = { path: window.location.pathname, since: Date.now() };
        record("view", { returned: true });
      }
    };
    const onVisibility = () => (document.visibilityState === "hidden" ? onHide() : onShow());
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
      flush(true);
    };
  }, []);

  // Each page, and how long it stayed open.
  useEffect(() => {
    const prev = page.current;
    if (prev && prev.path !== pathname) record("leave", { seconds: Math.round((Date.now() - prev.since) / 1000) }, prev.path);
    if (!prev || prev.path !== pathname) {
      page.current = { path: pathname, since: Date.now() };
      record("view", document.referrer && !prev ? { from: document.referrer.slice(0, 300) } : undefined, pathname);
    }
  }, [pathname]);

  // Clicks, uploads, messages on screen, errors.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (!target) return;
      if (target instanceof HTMLInputElement && target.type === "file") {
        e.preventDefault();
        e.stopPropagation();
        record("click", { label: "Choose a file", tag: "input", testid: target.getAttribute("data-testid") ?? undefined });
        setReason("upload");
        return;
      }
      const el = target.closest("a, button, [role=button], summary, select, label, input[type=checkbox], input[type=radio]");
      if (el && !el.closest("[data-demo-guard]")) record("click", describe(el));
    };
    const seen = new WeakMap<Element, string>();
    const checkAlerts = () => {
      document.querySelectorAll("[role=alert]").forEach((el) => {
        const text = (el as HTMLElement).innerText.replace(/\s+/g, " ").trim();
        if (text && seen.get(el) !== text) {
          seen.set(el, text);
          record("alert", { text: text.slice(0, 300) });
        }
      });
    };
    const observer = new MutationObserver(checkAlerts);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    const onError = (e: ErrorEvent) => record("error", { message: String(e.message).slice(0, 300) });
    const onRejection = (e: PromiseRejectionEvent) => record("error", { message: String(e.reason?.message ?? e.reason).slice(0, 300) });
    const onLimit = (e: Event) => setReason(((e as CustomEvent).detail?.reason as string) || "limit");
    document.addEventListener("click", onClick, true);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("demo-limit", onLimit as EventListener);
    return () => {
      observer.disconnect();
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("demo-limit", onLimit as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!reason) return;
    record("limit", { reason });
    closeRef.current?.focus();
    // First, and only this dialog: Escape shouldn't also close the one beneath it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setReason(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [reason]);

  if (!reason) return null;
  return (
    <div className="modal-backdrop" onClick={() => setReason(null)} data-demo-guard>
      <div
        className="modal demo-limit"
        role="dialog"
        aria-modal="true"
        aria-labelledby="demo-limit-title"
        onClick={(e) => e.stopPropagation()}
        data-testid="demo-limit"
      >
        <h2 id="demo-limit-title">{DEMO_LIMIT_MESSAGE}</h2>
        <p className="card__meta">
          {reason === "upload"
            ? "The demo has its own fictional documents. With an account, you upload your strata's own."
            : "This is as far as the demo goes. Your own account has no such limits."}
        </p>
        <div className="role-editor__actions">
          <button ref={closeRef} type="button" className="button button-secondary" onClick={() => setReason(null)}>
            Keep exploring
          </button>
          <a href={SIGNUP_URL} className="button button-primary" data-testid="demo-limit-signup" onClick={() => record("click", { label: "Create your free account", reason })}>
            Create your free account
          </a>
        </div>
      </div>
    </div>
  );
}
