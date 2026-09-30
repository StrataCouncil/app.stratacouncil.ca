import { StrataSphereNav } from "@/components/StrataSphereNav";
import { currentCorporation, roleLabels, roster, strataLots } from "@/lib/placeholder-data";

const ownerTypeLabels: Record<string, string> = {
  owner: "Owner",
  tenant: "Tenant",
  strata_agent: "Strata agent",
};

const fmt = (n: number) =>
  n.toLocaleString("en-CA", { style: "currency", currency: "CAD" });

/**
 * Strata Lots — the property roll, one row per registered lot (doc02's
 * confirmed field set from the full Neurata handoff): SL#, unit #,
 * owner, parking/bike rack assignment, unit entitlement, and the
 * current monthly strata fee. This is the full 64-unit roll, not just
 * the council seats — Council & Roles is the `isCouncilMember` subset
 * of this same data, kept as its own simpler list for now.
 *
 * Read-only for this pass — editing a lot (reassigning a stall,
 * updating an owner's contact info) isn't wired up yet, same honesty as
 * the rest of this placeholder app.
 */
export default function StrataLotsPage() {
  return (
    <>
      <StrataSphereNav active="lots" />
      <h2 style={{ marginBottom: "0.4rem" }}>Strata lots</h2>
      <p className="card__meta" style={{ marginBottom: "1.25rem" }}>
        {strataLots.length} of {currentCorporation.unitCount} lots shown
        &mdash; the rest aren&rsquo;t seeded in this mock yet, but this is the
        full property-roll shape (doc02).
      </p>

      <div className="roster-table-wrap">
        <table className="roster-table" data-testid="strata-lots-table">
          <thead>
            <tr>
              <th>SL #</th>
              <th>Unit #</th>
              <th>Owner</th>
              <th>Type</th>
              <th>Parking</th>
              <th>Bike rack</th>
              <th data-center="true">Unit entitlement</th>
              <th data-center="true">Strata fee / mo</th>
              <th>Council role</th>
            </tr>
          </thead>
          <tbody>
            {strataLots.map((lot) => {
              const councilMember = roster.find((m) => m.name === lot.ownerName);
              return (
                <tr key={lot.id}>
                  <td>{lot.lotNumber}</td>
                  <td>{lot.unitNumber}</td>
                  <td>
                    {lot.ownerName}
                    <div className="roster-table__meta">{lot.ownerEmail}</div>
                    {lot.councilMemberName && (
                      <div className="roster-table__meta">
                        Council delegate: {lot.councilMemberName} &middot;{" "}
                        {lot.councilMemberEmail}
                      </div>
                    )}
                  </td>
                  <td>{ownerTypeLabels[lot.ownerType]}</td>
                  <td>{lot.parkingStall ?? <span className="roster-table__na">&mdash;</span>}</td>
                  <td>{lot.bikeRack ?? <span className="roster-table__na">&mdash;</span>}</td>
                  <td data-center="true">{lot.unitEntitlement}</td>
                  <td data-center="true">{fmt(lot.strataFees)}</td>
                  <td>
                    {lot.isCouncilMember && councilMember && councilMember.roles.length > 0
                      ? councilMember.roles.map((role) => (
                          <span className="role-tag" key={role}>
                            {roleLabels[role] ?? role}
                          </span>
                        ))
                      : <span className="roster-table__na">&mdash;</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
