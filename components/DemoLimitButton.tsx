"use client";

import { showDemoLimit } from "@/lib/demo-client";

/** In the demo, where a control would go past what the demo allows: opens the sign-up message instead. */
export function DemoLimitButton({ reason, className, children, testId }: { reason: string; className?: string; children: React.ReactNode; testId?: string }) {
  return (
    <button type="button" className={className} onClick={() => showDemoLimit(reason)} data-testid={testId}>
      {children}
    </button>
  );
}
