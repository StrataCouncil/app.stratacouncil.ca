import { notFound } from "next/navigation";
import { AdminTabs } from "@/components/AdminTabs";
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
        <AdminTabs active="legislation" />
        <div className="page-header">
          <h1>Legislation Library</h1>
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
