/**
 * Opens the demo's sign-up message (components/DemoGuard.tsx) from
 * anywhere in the browser: a limit reached, an upload tried, a locked
 * agenda item clicked. `reason` goes in the activity log. Does nothing
 * outside the demo, where DemoGuard isn't mounted.
 */
export function showDemoLimit(reason: string) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("demo-limit", { detail: { reason } }));
}

/** True for a server action's answer that hit a demo limit (lib/demo.ts demoLimitFail). */
export function isDemoLimit(res: unknown): boolean {
  return Boolean(res && typeof res === "object" && (res as { demoLimit?: boolean }).demoLimit);
}
