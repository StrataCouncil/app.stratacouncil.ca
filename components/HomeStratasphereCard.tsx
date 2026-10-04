import Link from "next/link";
import { RequestSubscriptionButton } from "@/components/RequestSubscriptionButton";

type Action = { kind: "connect" } | { kind: "plans"; corpId: string } | { kind: "request"; corpId: string };

/**
 * What Stratasphere does, on Home, for people whose strata isn't
 * subscribed (note 3, 2026-10-05). The button fits who's looking: connect
 * first, see plans (an admin), or ask the admin (anyone else).
 */
export function HomeStratasphereCard({ action }: { action: Action }) {
  return (
    <section className="card home-stratasphere" data-testid="home-stratasphere">
      <div>
        <span className="home-news__kicker">Stratasphere&trade;</span>
        <h2>Answers from your own strata&rsquo;s records</h2>
        <p>
          Ask a question and get an answer drawn from your bylaws, minutes, decisions and BC strata law, with the sources
          shown. Meeting Mode runs your agenda, records motions and votes, and drafts the minutes. Your strata&rsquo;s
          first meeting is free.
        </p>
      </div>
      <div className="home-stratasphere__action">
        {action.kind === "connect" ? (
          <Link href="/strata" className="button button-primary">
            Connect to a strata
          </Link>
        ) : action.kind === "plans" ? (
          <Link href={`/strata/${action.corpId}/billing`} className="button button-primary">
            See plans
          </Link>
        ) : (
          <RequestSubscriptionButton corpId={action.corpId} />
        )}
      </div>
    </section>
  );
}
