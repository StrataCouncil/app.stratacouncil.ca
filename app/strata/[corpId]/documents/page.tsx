import Link from "next/link";
import { notFound } from "next/navigation";
import { StrataSphereNav } from "@/components/StrataSphereNav";
import { DocumentUpload } from "@/components/DocumentUpload";
import { getStrataAccess } from "@/lib/data/strata";
import { documentCountsByCategory } from "@/lib/data/documents";
import { documentCategories, documentCategoryDescriptions, documentCategoryLabels } from "@/lib/documents";

/**
 * Documents — upload, browse and download are free for every member,
 * permanently (doc01 §4a, resolved 2026-09-30). Only the AI layer built on
 * top (search, Meeting Mode, the assistant) is part of the subscription.
 *
 * Nine fixed folders (doc01 §4); Agenda Attachments fills itself from the
 * agenda flow and isn't offered in the upload picker.
 */
export default async function DocumentsPage({ params }: { params: Promise<{ corpId: string }> }) {
  const { corpId } = await params;
  const access = await getStrataAccess(corpId);
  if (!access) notFound();
  const { counts, uncategorized } = await documentCountsByCategory(corpId);

  return (
    <>
      <StrataSphereNav active="documents" />
      <div className="doc-header">
        <div>
          <h2>Documents</h2>
          <p className="card__meta">
            Bylaws, minutes, financials and more. Uploading is free, and every
            PDF, Word and text file is indexed so Stratasphere&trade; can use it.
          </p>
        </div>
        <DocumentUpload corpId={corpId} />
      </div>

      <div className="grid-cards" data-testid="document-folders">
        {documentCategories.map((category) => {
          const count = counts[category];
          return (
            <Link key={category} href={`/strata/${corpId}/documents/${category}`} className="card folder-card">
              <svg className="folder-card__icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.379a1.5 1.5 0 0 1 1.06.44l1.122 1.12a1.5 1.5 0 0 0 1.06.44H19.5A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5v-11Z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
              </svg>
              <h3>{documentCategoryLabels[category]}</h3>
              <p>{documentCategoryDescriptions[category]}</p>
              <span className="card__meta">
                {count} document{count === 1 ? "" : "s"}
              </span>
            </Link>
          );
        })}
      </div>
      {uncategorized > 0 && (
        <p className="card__meta" style={{ marginTop: "1rem" }}>
          {uncategorized} older document{uncategorized === 1 ? " isn't" : "s aren't"} in a folder yet.
        </p>
      )}

      <div className="sync-note" data-testid="cloud-sync-note">
        <div>
          <strong>Sync with a cloud drive</strong>
          <p>
            Mirror this repository against Dropbox or Google Drive instead of
            uploading by hand. Coming later.
          </p>
        </div>
        <button className="button button-secondary" disabled data-testid="connect-cloud-drive-cta">
          Connect a drive
        </button>
      </div>
    </>
  );
}
