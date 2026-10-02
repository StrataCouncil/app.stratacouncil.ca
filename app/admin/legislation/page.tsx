import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { LegislationLibrary } from "@/components/LegislationLibrary";
import { listLegislation } from "@/lib/data/legislation";

/**
 * The legislation library (doc04 §5): Super Admins only. Everything
 * Stratasphere says about the law comes from what's loaded here.
 */
export default async function LegislationPage() {
  const entries = await listLegislation();
  if (!entries) notFound();

  return (
    <AppShell active="admin">
      <div className="wrap page">
        <p className="roster-table__meta" style={{ marginBottom: "0.5rem" }}>
          <Link href="/admin">Super Admin console</Link>
        </p>
        <div className="page-header">
          <h1>Legislation library</h1>
          <p>
            BC Acts, regulations and official guidance that Stratasphere quotes and cites for every strata on the
            platform. It explains the law only from what&rsquo;s here, never from memory, so keep each entry current:
            when BC Laws publishes a newer version, upload it and delete the old one.
          </p>
        </div>
        <LegislationLibrary entries={entries} />
      </div>
    </AppShell>
  );
}
