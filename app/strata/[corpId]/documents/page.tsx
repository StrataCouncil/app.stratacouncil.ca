import Link from "next/link";
import { notFound } from "next/navigation";
import { StrataSphereNav } from "@/components/StrataSphereNav";
import { DocumentUpload } from "@/components/DocumentUpload";
import { DocumentExportRequest } from "@/components/DocumentExportRequest";
import { GoogleDriveImport } from "@/components/GoogleDriveImport";
import { getStrataAccess } from "@/lib/data/strata";
import { documentCountsByCategory, hasUnfingerprintedFiles } from "@/lib/data/documents";
import {
  documentCategories,
  documentCategoryDescriptions,
  documentCategoryLabels,
  UNFILED,
  UNFILED_DESCRIPTION,
  UNFILED_LABEL,
} from "@/lib/documents";
import { queueCorporationFingerprints } from "@/lib/kb/queue";
import { IS_DEMO } from "@/lib/demo";

/**
 * Documents — upload, browse and download are free for every member,
 * permanently (doc01 §4a, resolved 2026-09-30). Only the AI layer built on
 * top (search, Meeting Mode, the assistant) is part of the subscription.
 *
 * Eight fixed folders (doc01 §4). Agenda attachments are filed in them
 * like any other document (0065); anything not in a folder yet shows as
 * Unfiled, first, until someone moves it.
 */
export default async function DocumentsPage({ params }: { params: Promise<{ corpId: string }> }) {
  const { corpId } = await params;
  const access = await getStrataAccess(corpId);
  if (!access) notFound();
  const { counts, uncategorized } = await documentCountsByCategory(corpId);
  // Files stored before fingerprints existed get one in the background, so
  // identical copies can be found (at most once a day per strata).
  if (!IS_DEMO && (await hasUnfingerprintedFiles(corpId))) await queueCorporationFingerprints(access.corpId);

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
        <div className="doc-header__actions">
          <GoogleDriveImport corpId={corpId} />
          <DocumentUpload corpId={corpId} />
        </div>
      </div>

      <div className="grid-cards" data-testid="document-folders">
        {uncategorized > 0 && (
          <Link href={`/strata/${corpId}/documents/${UNFILED}`} className="card folder-card folder-card--unfiled" data-testid="folder-unfiled">
            <FolderIcon />
            <h3>{UNFILED_LABEL}</h3>
            <p>{UNFILED_DESCRIPTION}</p>
            <span className="card__meta">
              {uncategorized} document{uncategorized === 1 ? "" : "s"} to file
            </span>
          </Link>
        )}
        {documentCategories.map((category) => {
          const count = counts[category];
          return (
            <Link key={category} href={`/strata/${corpId}/documents/${category}`} className="card folder-card">
              <FolderIcon />
              <h3>{documentCategoryLabels[category]}</h3>
              <p>{documentCategoryDescriptions[category]}</p>
              <span className="card__meta">
                {count} document{count === 1 ? "" : "s"}
              </span>
            </Link>
          );
        })}
      </div>

      {access.isAdmin && <DocumentExportRequest corpId={corpId} />}
    </>
  );
}

function FolderIcon() {
  return (
    <svg className="folder-card__icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.379a1.5 1.5 0 0 1 1.06.44l1.122 1.12a1.5 1.5 0 0 0 1.06.44H19.5A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5v-11Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}
