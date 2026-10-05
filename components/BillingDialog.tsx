"use client";

import { useRouter } from "next/navigation";
import { Modal } from "@/components/Modal";

/**
 * Subscribing, in one focused dialog (2026-10-05): nothing else on the
 * page competes with it. Escape or Cancel closes it; a click outside
 * doesn't, so a half-done payment isn't lost to a stray click. Each step's
 * progress is saved as it's completed, so reopening picks up from there.
 */
export function BillingDialog({
  closeHref,
  title = "Subscribe to Stratasphere™",
  children,
}: {
  closeHref: string;
  title?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  return (
    <Modal title={title} onClose={() => router.push(closeHref)} wide closeOnBackdrop={false} testId="billing-dialog">
      {children}
    </Modal>
  );
}
