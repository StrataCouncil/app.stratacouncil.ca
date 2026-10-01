"use client";

import { usePathname, useRouter } from "next/navigation";

/** Period picker for Account Statements: puts the choice in the URL so the
 * server page loads that period's invoices from Stripe. */
export function StatementsPeriodSelect({ value }: { value: string | null }) {
  const router = useRouter();
  const pathname = usePathname();

  const months: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 24; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: d.toLocaleDateString("en-CA", { year: "numeric", month: "long" }),
    });
  }

  return (
    <select
      className="billing-period-select"
      aria-label="Statement period"
      value={value ?? ""}
      onChange={(e) => router.replace(`${pathname}?period=${e.target.value}`, { scroll: false })}
      data-testid="statements-period"
    >
      <option value="" disabled>
        Select period…
      </option>
      <option value="all">All time</option>
      <option value="ytd">Year to date</option>
      <option value="12">Last 12 months</option>
      {months.map((m) => (
        <option key={m.value} value={m.value}>
          {m.label}
        </option>
      ))}
    </select>
  );
}
