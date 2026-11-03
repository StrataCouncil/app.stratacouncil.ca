import Link from "next/link";
import { RequestSubscriptionButton } from "@/components/RequestSubscriptionButton";
import { SubscriptionPendingNote } from "@/components/SubscriptionPendingNote";

/** The first discussion is free; more need a subscription. Everything already here stays open to council. */
export function DiscussionsLock({ corpId, pending, canBill }: { corpId: string; pending: boolean; canBill: boolean }) {
  return (
    <div className="lock-panel" style={{ marginBottom: "2rem" }} data-testid="discussions-lock">
      <h2>More discussions with Stratasphere&trade;</h2>
      <p>
        Your free discussion has been used. A subscription lets council start as many as it needs. Every discussion already here,
        and its record in Documents, stays available either way.
      </p>
      {pending ? (
        <SubscriptionPendingNote />
      ) : canBill ? (
        <Link href={`/strata/${corpId}/billing`} className="button button-primary">
          See plans
        </Link>
      ) : (
        <RequestSubscriptionButton corpId={corpId} />
      )}
    </div>
  );
}
