import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminTabs } from "@/components/AdminTabs";
import { AppShell } from "@/components/AppShell";
import { NewLibraryItem } from "@/components/library/NewLibraryItem";
import { listLibraryDrafts } from "@/lib/data/library";
import { knowledgeResourceKindLabels } from "@/lib/placeholder-data";

/**
 * The Library (0049): playbooks, guides and templates for every strata,
 * written here and published to each strata's Knowledge Library. The
 * sample articles stay there, labelled "Sample", until they're replaced.
 */
export default async function LibraryAdminPage() {
  const items = await listLibraryDrafts();
  if (!items) notFound();
  const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });

  return (
    <AppShell active="admin">
      <div className="wrap page">
        <AdminTabs active="library" />
        <div className="page-header">
          <h1>Library</h1>
          <p>
            Playbooks, guides and templates for every strata. Paste a draft and the AI puts it in the Library&rsquo;s format
            and flags the legal statements to check against the Legislation Library. Members see an item once it&rsquo;s
            published. Templates are for subscribers.
          </p>
        </div>

        <NewLibraryItem />

        {items.length === 0 ? (
          <p className="roster-notice" style={{ marginTop: "1.5rem" }}>
            Nothing here yet. Members see the sample articles until items are published.
          </p>
        ) : (
          <div className="roster-table-wrap" style={{ marginTop: "1.5rem" }}>
          <table className="roster-table" data-testid="library-items">
            <thead>
              <tr>
                <th scope="col">Title</th>
                <th scope="col">Kind</th>
                <th scope="col">Status</th>
                <th scope="col">Edited</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <td>
                    <Link href={`/admin/library/${i.id}`}>{i.title || "Untitled"}</Link>
                  </td>
                  <td>{knowledgeResourceKindLabels[i.kind]}</td>
                  <td>
                    {i.publishedAt ? (
                      <span className={`pill ${i.changed ? "pill--accent" : ""}`}>
                        {i.changed ? "Published, with changes" : "Published"}
                      </span>
                    ) : (
                      <span className="pill pill--locked">Draft</span>
                    )}
                  </td>
                  <td className="card__meta">{fmt(i.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
