"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { AdminCorporation } from "@/lib/data/admin";

const subscriptionLabels: Record<AdminCorporation["subscriptionStatus"], string> = {
  active: "Stratasphere™ active",
  none: "Free tier",
  deactivated: "Deactivated",
};

/**
 * The Super Admin console's entry point (`/admin`): search by SP# or
 * building name, list every corporation on the platform, drill into a
 * read-only detail page. Deliberately not another StrataSwitcher-style
 * dropdown scoped to "corporations I belong to" — this is the opposite
 * scope, every corporation, independent of whether this profile holds
 * any `corporation_role_assignments` row for it at all (doc01 §1).
 */
export function AdminCorporationSearch({ corporations }: { corporations: AdminCorporation[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return corporations;
    return corporations.filter((c) =>
      [c.strataPlanNumber, c.buildingName ?? "", c.legalName, c.address]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [corporations, query]);

  return (
    <div data-testid="admin-corp-search">
      <input
        type="search"
        className="kb-search"
        placeholder="Search by SP# or building name…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        data-testid="admin-search-input"
      />

      {filtered.length === 0 ? (
        <p className="card__meta" data-testid="admin-search-empty">
          No corporation matches &ldquo;{query}&rdquo;.
        </p>
      ) : (
        <div className="roster-table-wrap">
          <table className="roster-table" data-testid="admin-corp-table">
            <thead>
              <tr>
                <th>Strata Plan</th>
                <th>Building</th>
                <th>Jurisdiction</th>
                <th data-center="true">Units</th>
                <th>Status</th>
                <th aria-label="Open" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/admin/${c.id}`} data-testid={`admin-corp-row-${c.id}`}>
                      {c.strataPlanNumber}
                    </Link>
                  </td>
                  <td>
                    {c.buildingName ?? c.legalName}
                    <div className="roster-table__meta">{c.address}</div>
                  </td>
                  <td>{c.jurisdiction}</td>
                  <td data-center="true">{c.unitCount}</td>
                  <td>
                    <span className={`pill ${c.subscriptionStatus === "active" ? "" : "pill--locked"}`}>
                      {subscriptionLabels[c.subscriptionStatus]}
                    </span>
                    {c.stripeSandbox && <span className="pill stripe-mode__pill" style={{ marginLeft: "0.35rem" }}>Sandbox</span>}
                  </td>
                  <td>
                    <Link href={`/strata/${c.id}`} className="link-button" data-testid={`admin-open-strata-${c.id}`}>
                      Open strata
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
