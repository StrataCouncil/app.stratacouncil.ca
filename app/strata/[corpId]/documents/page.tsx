import Link from "next/link";
import { StrataSphereNav } from "@/components/StrataSphereNav";
import { getStrataAccess } from "@/lib/data/strata";
import {
  documentCategoryDescriptions,
  documentCategoryLabels,
  documents,
  type DocumentCategory,
} from "@/lib/placeholder-data";

const categories = Object.keys(documentCategoryLabels) as DocumentCategory[];

/**
 * Documents — upload is always free and encouraged pre-subscription
 * (doc01 §4b); full browse/search of the indexed repository is gated.
 * Both states render here rather than hiding the page entirely.
 *
 * Folder structure is a fixed set of 9 named folders (see
 * `documentCategoryLabels`) rather than one flat list.
 */
export default async function DocumentsPage({
  params,
}: {
  params: Promise<{ corpId: string }>;
}) {
  const { corpId } = await params;
  const subscribed = (await getStrataAccess(corpId))?.subscribed ?? false;

  return (
    <>
      <StrataSphereNav active="documents" />
      <h2 style={{ marginBottom: "1rem" }}>Documents</h2>

      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <h3>Upload a document</h3>
        <p>
          Bylaws, minutes, financials and more &mdash; upload is free and
          indexed immediately, whether or not you&rsquo;ve subscribed yet.
        </p>
        <button className="button button-secondary" style={{ alignSelf: "flex-start" }} data-testid="upload-document">
          Upload document
        </button>
      </div>

      {subscribed ? (
        <>
          <div className="grid-cards" data-testid="document-folders">
            {categories.map((category) => {
              const count = documents.filter((d) => d.category === category).length;
              return (
                <Link
                  key={category}
                  href={`/strata/${corpId}/documents/${category}`}
                  className="card folder-card"
                >
                  <svg
                    className="folder-card__icon"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden="true"
                  >
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

          <div className="sync-note" data-testid="cloud-sync-note">
            <div>
              <strong>Sync with a cloud drive</strong>
              <p>
                Mirror this repository against Dropbox or Google Drive
                instead of uploading manually &mdash; planned, not built yet
                (doc03 Stage 7).
              </p>
            </div>
            <button className="button button-secondary" disabled data-testid="connect-cloud-drive-cta">
              Connect a drive
            </button>
          </div>
        </>
      ) : (
        <div className="lock-panel">
          <h2>Full document browsing needs Stratasphere&trade;</h2>
          <p>
            Your uploads are safe and already indexed. Subscribe to search
            and browse the full repository, and to use it with Meeting Mode
            and the Stratasphere&trade; assistant.
          </p>
          <Link
            href={`/strata/${corpId}/billing`}
            className="button button-primary"
            data-testid="documents-subscribe-cta"
          >
            Subscribe to Stratasphere&trade;
          </Link>
        </div>
      )}
    </>
  );
}
