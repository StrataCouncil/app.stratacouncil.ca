import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { CreationRequestReview } from "@/components/CreationRequestReview";
import { getCreationRequest } from "@/lib/data/admin";
import { getCurrentProfile } from "@/lib/data/profile";

const statusLabels = { pending: "Pending review", approved: "Approved", denied: "Denied" } as const;

/**
 * One `corporation_creation_requests` row, for Super Admin review (doc01
 * §4): the uploaded Strata Plan, the requester's attestation, and the
 * plan details to verify and approve (components/CreationRequestReview).
 */
export default async function CreationRequestPage({
  params,
}: {
  params: Promise<{ requestId: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile?.isSuperAdmin) notFound();

  const { requestId } = await params;
  const request = await getCreationRequest(requestId);
  if (!request) notFound();

  return (
    <AppShell active="admin">
      <div className="wrap page">
        <Link href="/admin" className="kb-article__back">
          &larr; Super Admin console
        </Link>

        <div className="page-header">
          <span className={`pill ${request.status === "pending" ? "" : "pill--locked"}`}>
            {statusLabels[request.status]}
          </span>
          <h1 style={{ marginTop: "0.6rem" }}>
            New corporation request: {request.strataPlanNumber}
          </h1>
          <p>
            Requested by {request.requesterName} ({request.requesterEmail}) on{" "}
            {new Date(request.requestedAt).toLocaleDateString("en-CA")}
          </p>
        </div>

        <div className="grid-cards" style={{ marginBottom: "2rem" }}>
          <div className="card">
            <h3>Uploaded Strata Plan</h3>
            {request.planUrl ? (
              <>
                <p>{request.planTitle}</p>
                <a
                  href={request.planUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="button button-secondary button-small"
                  style={{ alignSelf: "flex-start" }}
                  data-testid="review-plan-link"
                >
                  Open PDF
                </a>
                <p className="card__meta">Link valid for 30 minutes.</p>
              </>
            ) : (
              <p>No plan file is attached to this request.</p>
            )}
          </div>
          <div className="card" data-testid="review-attestation">
            <h3>Attestation</h3>
            <p style={{ margin: 0 }}>
              {request.attestation.fullName}
              <br />
              {request.attestation.address}
              <br />
              {request.attestation.email} &middot; {request.attestation.phone}
            </p>
            <p className="card__meta">
              {request.attestation.confirmed && request.attestation.confirmedAt
                ? `Confirmed ${new Date(request.attestation.confirmedAt).toLocaleString("en-CA")}`
                : "Not confirmed"}
            </p>
          </div>
        </div>

        {request.corporationAlreadyExists && (
          <p className="roster-invites__error" style={{ marginBottom: "1rem" }}>
            {request.strataPlanNumber} is already on the platform. Deny this
            request &mdash; the requester can ask to join it instead.
          </p>
        )}

        {request.status === "pending" ? (
          <CreationRequestReview request={request} />
        ) : (
          <p className="roster-notice">
            {statusLabels[request.status]}
            {request.resolvedAt && ` on ${new Date(request.resolvedAt).toLocaleDateString("en-CA")}`}.
            {request.status === "approved" && (
              <>
                {" "}
                <Link href={`/admin/${request.strataPlanNumber}`}>View corporation</Link>
              </>
            )}
          </p>
        )}
      </div>
    </AppShell>
  );
}
