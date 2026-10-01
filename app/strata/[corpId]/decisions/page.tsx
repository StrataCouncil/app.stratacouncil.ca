import { SubscribeCta } from "@/components/SubscribeCta";
import { StrataSphereNav } from "@/components/StrataSphereNav";

/**
 * Decision ledger — StrataSphere-gated (doc01 §4a). Not a nav destination
 * any more (see `StrataSphereNav`'s comment) — this route stays for the
 * data/record itself, just unlinked from the sub-nav.
 */
export default function DecisionsPage() {
  return (
    <>
      <StrataSphereNav active="decisions" />
      <h2 style={{ marginBottom: "1rem" }}>Decisions</h2>
      <div className="lock-panel">
        <h2>Your permanent decision record</h2>
        <p>
          Every carried motion, with mover, seconder and vote count &mdash;
          searchable and indexed for the Stratasphere&trade; assistant.
          Unlocks with a subscription.
        </p>
        <SubscribeCta testId="decisions-subscribe-cta" />
      </div>
    </>
  );
}
