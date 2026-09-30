import Link from "next/link";
import { notFound } from "next/navigation";
import { StrataSphereNav } from "@/components/StrataSphereNav";
import {
  currentCorporation,
  documentCategoryDescriptions,
  documentCategoryLabels,
  documents,
  type DocumentCategory,
} from "@/lib/placeholder-data";

export function generateStaticParams() {
  return Object.keys(documentCategoryLabels).map((category) => ({ category }));
}

/** One folder's contents — a flat list, newest upload first. */
export default async function DocumentCategoryPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const { category } = await params;
  const label = documentCategoryLabels[category as DocumentCategory];
  if (!label) notFound();

  const folderDocuments = documents.filter((d) => d.category === category);

  return (
    <>
      <StrataSphereNav active="documents" />

      <Link
        href={`/strata/${currentCorporation.id}/documents`}
        className="card__meta"
        style={{ display: "inline-block", marginBottom: "0.75rem" }}
      >
        &larr; All folders
      </Link>

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap", marginBottom: "1.5rem" }}>
        <div>
          <h2>{label}</h2>
          <p className="card__meta" style={{ marginTop: "0.3rem" }}>
            {documentCategoryDescriptions[category as DocumentCategory]}
          </p>
        </div>
        <button className="button button-secondary" data-testid="upload-to-category">
          Upload to {label}
        </button>
      </div>

      {folderDocuments.length === 0 ? (
        <p className="card__meta">Nothing in this folder yet.</p>
      ) : (
        <div className="module-list" data-testid="document-list">
          {folderDocuments.map((doc) => (
            <div className="module-row" key={doc.id}>
              <div>
                <div className="module-row__title">{doc.title}</div>
                <div className="module-row__meta">
                  Uploaded by {doc.uploadedBy} &middot; {doc.uploadedAt}
                </div>
              </div>
              <button className="button button-secondary button-small" data-testid={`open-document-${doc.id}`}>
                Open
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
