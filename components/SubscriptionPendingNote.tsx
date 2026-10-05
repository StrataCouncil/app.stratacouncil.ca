"use client";

import Link from "next/link";
import { useOptionalStrata } from "@/components/StrataContext";

/**
 * In place of every Subscribe and Request button while a subscription is
 * pending (Stripe confirming the first payment, 0030): says so, rather
 * than asking anyone to subscribe again. Admins get a link to Billing,
 * where the payment's state and any next step are shown.
 */
export function SubscriptionPendingNote({ corpId: corpIdProp, isAdmin: isAdminProp }: { corpId?: string; isAdmin?: boolean }) {
  const strata = useOptionalStrata();
  const corpId = corpIdProp ?? strata?.corpId;
  const isAdmin = isAdminProp ?? strata?.isAdmin ?? false;
  return (
    <div className="subscription-pending" role="status" data-testid="subscription-pending-note">
      <strong>Subscription pending</strong>
      <span>
        {isAdmin
          ? "Stripe is confirming the first payment. A pre-authorized debit can take a few business days. Stratasphere™ unlocks on its own once it’s through."
          : "Your strata’s admin has subscribed, and Stripe is confirming the first payment. Stratasphere™ unlocks on its own once it’s through."}
      </span>
      {isAdmin && corpId && (
        <Link href={`/strata/${corpId}/billing`} className="link-button">
          View billing
        </Link>
      )}
    </div>
  );
}
