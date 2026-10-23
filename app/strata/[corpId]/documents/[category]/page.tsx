import Link from "next/link";
import { notFound } from "next/navigation";
import { StrataSphereNav } from "@/components/StrataSphereNav";
import { DocumentUpload } from "@/components/DocumentUpload";
import { GoogleDriveImport } from "@/components/GoogleDriveImport";
import { DocumentList, type DocumentUseLink } from "@/components/DocumentList";
import { HistoricMinutesUpload } from "@/components/meetings/HistoricMinutesUpload";
import { getStrataAccess } from "@/lib/data/strata";
import { documentAttachmentUses, filedCopies, hasUnfingerprintedFiles, listDocuments, type FiledCopy } from "@/lib/data/documents";
import {
  documentCategoryDescriptions,
  documentCategoryLabels,
  isDocumentCategory,
  UNFILED,
  UNFILED_DESCRIPTION,
  UNFILED_LABEL,
} from "@/lib/documents";
import { meetingTypeLabels } from "@/lib/meetings/agenda";
import { queueCorporationFingerprints } from "@/lib/kb/queue";
import { IS_DEMO } from "@/lib/demo";

function shortDate(iso: string) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
}

/**
 * One folder's contents, newest upload first, each with the agenda items
 * it's attached to. Meetings & Records also holds the strata's minutes
 * (finalized ones filed automatically, historic ones uploaded here) and
 * the historic minutes upload, which reads out their decisions.
 *
 * Unfiled (/documents/unfiled) lists documents with no folder, including
 * the agenda attachments filed before 0065. Where one is identical to a
 * document already filed, an admin can keep the filed one and remove the
 * copy; agenda items are pointed at the one kept.
 */
export default async function DocumentCategoryPage({
  params,
}: {
  params: Promise<{ corpId: string; category: string }>;
}) {
  const { corpId, category } = await params;
  const unfiled = category === UNFILED;
  if (!unfiled && !isDocumentCategory(category)) notFound();
  const access = await getStrataAccess(corpId);
  if (!access) notFound();
  const folder = unfiled ? null : isDocumentCategory(category) ? category : null;
  const [documents, uses] = await Promise.all([listDocuments(corpId, folder), documentAttachmentUses(corpId)]);
  const label = folder ? documentCategoryLabels[folder] : UNFILED_LABEL;

  let copies = new Map<string, FiledCopy>();
  if (unfiled) {
    copies = await filedCopies(corpId, documents.map((d) => d.sha256).filter((x): x is string => Boolean(x)));
    if (!IS_DEMO && documents.some((d) => d.hasFile && !d.sha256) && (await hasUnfingerprintedFiles(corpId))) {
      await queueCorporationFingerprints(access.corpId);
    }
  }

  const useLinks: Record<string, DocumentUseLink[]> = {};
  const sameAs: Record<string, FiledCopy> = {};
  for (const doc of documents) {
    const list = uses.get(doc.id);
    if (list?.length) {
      useLinks[doc.id] = list.map((u) => ({
        href: `/strata/${corpId}/meetings/${u.meetingId}`,
        label: `${meetingTypeLabels[u.meetingType]}, ${shortDate(u.meetingDate)}`,
        item: `item ${u.itemNum}: ${u.itemText.length > 60 ? `${u.itemText.slice(0, 57).trimEnd()}…` : u.itemText}`,
      }));
    }
    const copy = doc.sha256 ? copies.get(doc.sha256) : undefined;
    if (copy && copy.id !== doc.id) sameAs[doc.id] = copy;
  }

  return (
    <>
      <StrataSphereNav active="documents" />
      <Link href={`/strata/${corpId}/documents`} className="card__meta" style={{ display: "inline-block", marginBottom: "0.75rem" }}>
        &larr; All folders
      </Link>

      <div className="doc-header">
        <div>
          <h2>{label}</h2>
          <p className="card__meta">
            {folder ? (
              documentCategoryDescriptions[folder]
            ) : (
              <>
                {UNFILED_DESCRIPTION} Files attached to agenda items used to be kept in a separate Agenda Attachments
                folder; they&rsquo;re here now, still attached to their items. Where a file is identical to one already
                filed, an admin can keep the filed one and remove this copy.
              </>
            )}
          </p>
        </div>
        {folder && (
          <div className="doc-header__actions">
            <GoogleDriveImport corpId={corpId} defaultCategory={folder} />
            <DocumentUpload corpId={corpId} defaultCategory={folder} label={`Upload to ${label}`} />
          </div>
        )}
      </div>

      {folder === "meetings_records" && access.canRunMeetings && (
        <HistoricMinutesUpload corpId={corpId} aiAvailable={access.subscribed || !access.freeMeetingUsed} />
      )}

      {documents.length === 0 ? (
        <p className="card__meta">{unfiled ? "Everything is filed." : "Nothing in this folder yet."}</p>
      ) : (
        <DocumentList corpId={corpId} documents={documents} uses={useLinks} sameAs={sameAs} canRemoveCopies={access.isAdmin && !IS_DEMO} />
      )}
    </>
  );
}
