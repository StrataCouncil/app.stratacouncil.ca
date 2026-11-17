import Link from "next/link";

/**
 * Discussions and Directives (0097), side by side in the Discussions tab.
 * A manager who isn't on council sees Directives only.
 */
export function DiscussionsTabs({
  corpId,
  active,
  seesDiscussions,
  openDirectives,
}: {
  corpId: string;
  active: "discussions" | "directives";
  seesDiscussions: boolean;
  /** Shown beside the Directives tab when there are any. */
  openDirectives?: number;
}) {
  return (
    <nav className="subtabs" aria-label="Discussions and directives" data-testid="discussions-tabs">
      {seesDiscussions && (
        <Link href={`/strata/${corpId}/discussions`} data-active={active === "discussions"} aria-current={active === "discussions" ? "page" : undefined} data-testid="tab-discussions">
          Discussions
        </Link>
      )}
      <Link
        href={`/strata/${corpId}/discussions/directives`}
        data-active={active === "directives"}
        aria-current={active === "directives" ? "page" : undefined}
        data-testid="tab-directives"
      >
        Directives
        {openDirectives ? <span className="subtabs__count">{openDirectives}</span> : null}
      </Link>
    </nav>
  );
}
