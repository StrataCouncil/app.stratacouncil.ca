import { notFound } from "next/navigation";
import { AdminTabs } from "@/components/AdminTabs";
import { AppShell } from "@/components/AppShell";
import { CitationCheck } from "@/components/CitationCheck";
import { LegislationLibrary } from "@/components/LegislationLibrary";
import { listLegislation } from "@/lib/data/legislation";

/**
 * The Knowledge Base (doc04 §5): Super Admins only. Everything
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
          <h1>Knowledge Base</h1>
          <p>
            BC Acts, regulations, and official guidance that Stratasphere quotes and cites for every strata on the
            platform. It explains the law only from what&rsquo;s here, never from memory. Acts and regulations are read
            from BC Laws and updated automatically when BC Laws publishes a newer version; give each one its BC Laws link
            with Edit. Guidance without a BC Laws page is uploaded, with its published date.
          </p>
        </div>
        <LegislationLibrary entries={entries} />
        <CitationCheck />
      </div>
    </AppShell>
  );
}
