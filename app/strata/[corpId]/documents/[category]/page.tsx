import Link from "next/link";
import { notFound } from "next/navigation";
import { StrataSphereNav } from "@/components/StrataSphereNav";
import { DocumentUpload } from "@/components/DocumentUpload";
import { DocumentList } from "@/components/DocumentList";
import { getStrataAccess } from "@/lib/data/strata";
import { listDocuments } from "@/lib/data/documents";
import { documentCategoryDescriptions, documentCategoryLabels, isDocumentCategory } from "@/lib/documents";

/** One folder's contents, newest upload first. */
export default async function DocumentCategoryPage({
  params,
}: {
  params: Promise<{ corpId: string; category: string }>;
}) {
  const { corpId, category } = await params;
  if (!isDocumentCategory(category)) notFound();
  if (!(await getStrataAccess(corpId))) notFound();
  const documents = await listDocuments(corpId, category);
  const label = documentCategoryLabels[category];

  return (
    <>
      <StrataSphereNav active="documents" />
      <Link href={`/strata/${corpId}/documents`} className="card__meta" style={{ display: "inline-block", marginBottom: "0.75rem" }}>
        &larr; All folders
      </Link>

      <div className="doc-header">
        <div>
          <h2>{label}</h2>
          <p className="card__meta">{documentCategoryDescriptions[category]}</p>
        </div>
        {category !== "agenda_attachments" && (
          <DocumentUpload corpId={corpId} defaultCategory={category} label={`Upload to ${label}`} />
        )}
      </div>

      {documents.length === 0 ? (
        <p className="card__meta">Nothing in this folder yet.</p>
      ) : (
        <DocumentList corpId={corpId} documents={documents} />
      )}
    </>
  );
}
