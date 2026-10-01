import { StrataSphereNav } from "@/components/StrataSphereNav";
import { OwnerRoster } from "@/components/OwnerRoster";
import { getOwnerRoster } from "@/lib/data/owners";

/**
 * Strata Lots — the owner/lot roster (`owners_and_council`, doc02 §2/§2a):
 * one row per lot on the Strata Plan, pre-seeded when the corporation was
 * approved. Free (doc03 Stage 5), visible to every connected member,
 * maintained by the admin by CSV upload or direct edit
 * (components/OwnerRoster.tsx). It's also step 1 of the first-meeting
 * checklist (doc03 Stage 5a): Meeting Mode attendance is keyed on these
 * lot numbers.
 */
export default async function StrataLotsPage({
  params,
}: {
  params: Promise<{ corpId: string }>;
}) {
  const { corpId } = await params;
  const roster = await getOwnerRoster(corpId);

  const filled = roster?.lots.filter((l) => l.fullName).length ?? 0;

  return (
    <>
      <StrataSphereNav active="lots" />
      <h2 style={{ marginBottom: "0.4rem" }}>Strata lots</h2>

      {!roster ? (
        <p className="roster-notice">Couldn&rsquo;t load the roster. Try refreshing the page.</p>
      ) : (
        <>
          <p className="card__meta" style={{ marginBottom: "1.25rem" }} data-testid="strata-lots-summary">
            {roster.lots.length} {roster.lots.length === 1 ? "lot" : "lots"} on the Strata Plan
            {roster.lots.length > 0 && <> &middot; {filled} with an owner recorded</>}
          </p>
          <OwnerRoster corporationId={corpId} lots={roster.lots} isAdmin={roster.isAdmin} />
        </>
      )}
    </>
  );
}
