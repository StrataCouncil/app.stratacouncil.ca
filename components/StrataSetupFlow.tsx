"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  createStrataPlanUpload,
  lookupStrata,
  requestToJoin,
  submitCreationRequest,
  type LookupResult,
} from "@/app/strata/actions";
import { createClient } from "@/lib/supabase/client";
import { jurisdictions } from "@/lib/strata";

/**
 * The connect-a-strata flow on /strata (doc01 §4): Strata Plan number
 * first, then one of two paths.
 *
 *   - Already on the platform → request to join. No upload, no form —
 *     the corporation's admin approves it from Council & Roles.
 *   - Not on the platform → upload the Strata Plan, enter its identity
 *     fields, attest, submit for Super Admin review. Nothing is created
 *     until that review approves it.
 *
 * Strata Plan parsing isn't built: the plan details are typed in by hand
 * (and said so on screen), and the reviewer checks them against the
 * uploaded PDF. When parsing exists it pre-fills the same fields.
 */

type UploadState =
  | { status: "idle" }
  | { status: "uploading"; fileName: string }
  | { status: "done"; fileName: string; path: string }
  | { status: "error"; error: string };

const ATTESTATION_TEXT =
  "I confirm that I am an owner, council member, or authorized agent of this strata corporation, and that the information above is accurate to the best of my knowledge.";

export function StrataSetupFlow({
  defaultFullName,
  defaultEmail,
}: {
  defaultFullName: string;
  defaultEmail: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [lookup, setLookup] = useState<LookupResult | null>(null);
  const [lookupPending, startLookup] = useTransition();
  const [joinState, setJoinState] = useState<"idle" | "sending" | "sent" | string>("idle");

  function runLookup(e: React.FormEvent) {
    e.preventDefault();
    setJoinState("idle");
    startLookup(async () => {
      setLookup(await lookupStrata(query));
    });
  }

  async function join(strataPlanNumber: string) {
    setJoinState("sending");
    const result = await requestToJoin(strataPlanNumber);
    if (result.ok) {
      setJoinState("sent");
      router.refresh();
    } else {
      setJoinState(result.error);
    }
  }

  return (
    <>
      <form className="auth-card" style={{ maxWidth: 480, margin: 0 }} onSubmit={runLookup}>
        <div className="field">
          <label htmlFor="sp-number">Strata plan number</label>
          <input
            id="sp-number"
            name="sp-number"
            type="text"
            placeholder="e.g. BCS-4821"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            data-testid="sp-lookup-input"
            autoComplete="off"
          />
          <span className="field__hint">
            We&rsquo;ll check if your strata is already on the platform.
          </span>
        </div>
        <button
          type="submit"
          className="button button-primary"
          disabled={lookupPending || !query.trim()}
          data-testid="sp-lookup-submit"
        >
          {lookupPending ? "Looking up…" : "Look up my strata"}
        </button>
      </form>

      {lookup?.status === "invalid" && (
        <p className="roster-invites__error" data-testid="sp-lookup-invalid">
          That doesn&rsquo;t look like a Strata Plan number. It&rsquo;s letters
          then digits, like BCS-4821 or EPS 9048.
        </p>
      )}

      {lookup?.status === "found" && (
        <div className="card setup-result" data-testid="sp-lookup-found">
          <span className="pill">{lookup.strataPlanNumber}</span>
          <h3>{lookup.name} is already on StrataCouncil.ca</h3>
          {lookup.membershipStatus === "active" ? (
            <Link href={`/strata/${lookup.strataPlanNumber}`} className="button button-primary">
              Open Stratasphere&trade;
            </Link>
          ) : lookup.membershipStatus === "invited" ? (
            <p>You&rsquo;ve been invited to this strata &mdash; accept the invitation above.</p>
          ) : lookup.pendingJoinRequest || joinState === "sent" ? (
            <p data-testid="join-request-pending">
              Your request to join is waiting on this strata&rsquo;s admin.
              You&rsquo;ll have access as soon as they approve it.
            </p>
          ) : (
            <>
              <p>
                Ask to join, and this strata&rsquo;s admin will approve or
                deny your request. If you know the admin, they can also
                invite you directly by email.
              </p>
              <button
                className="button button-primary"
                onClick={() => join(lookup.strataPlanNumber)}
                disabled={joinState === "sending"}
                data-testid="join-request-submit"
              >
                {joinState === "sending" ? "Sending…" : "Request to join"}
              </button>
              {joinState !== "idle" && joinState !== "sending" && (
                <p className="roster-invites__error">{joinState}</p>
              )}
            </>
          )}
        </div>
      )}

      {lookup?.status === "not_found" && lookup.pendingCreationRequestByOther && (
        <div className="card setup-result" data-testid="creation-request-pending-other">
          <span className="pill">{lookup.strataPlanNumber}</span>
          <h3>Someone has already asked to add this strata</h3>
          <p>
            Their request is being reviewed now. Once it&rsquo;s approved,
            look up {lookup.strataPlanNumber} again and you&rsquo;ll be able to
            request to join &mdash; or ask whoever set it up to invite you.
          </p>
        </div>
      )}

      {lookup?.status === "not_found" &&
        !lookup.pendingCreationRequestByOther &&
        (lookup.pendingCreationRequest ? (
          <div className="card setup-result" data-testid="creation-request-pending">
            <span className="pill">{lookup.strataPlanNumber}</span>
            <h3>Your request to add this strata is being reviewed</h3>
            <p>We&rsquo;ll set it up as soon as it&rsquo;s been checked against the Strata Plan you uploaded.</p>
          </div>
        ) : (
          <CreationRequestForm
            key={lookup.strataPlanNumber}
            strataPlanNumber={lookup.strataPlanNumber}
            defaultFullName={defaultFullName}
            defaultEmail={defaultEmail}
            onSubmitted={() => router.refresh()}
          />
        ))}
    </>
  );
}

function CreationRequestForm({
  strataPlanNumber,
  defaultFullName,
  defaultEmail,
  onSubmitted,
}: {
  strataPlanNumber: string;
  defaultFullName: string;
  defaultEmail: string;
  onSubmitted: () => void;
}) {
  const [upload, setUpload] = useState<UploadState>({ status: "idle" });
  const [legalName, setLegalName] = useState("");
  const [address, setAddress] = useState("");
  const [unitCount, setUnitCount] = useState("");
  const [jurisdiction, setJurisdiction] = useState("BC");
  const [attestFullName, setAttestFullName] = useState(defaultFullName);
  const [attestAddress, setAttestAddress] = useState("");
  const [attestEmail, setAttestEmail] = useState(defaultEmail);
  const [attestPhone, setAttestPhone] = useState("");
  const [attestConfirmed, setAttestConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setUpload({ status: "uploading", fileName: file.name });
    const ticket = await createStrataPlanUpload({ name: file.name, size: file.size, type: file.type });
    if (!ticket.ok) {
      setUpload({ status: "error", error: ticket.error });
      return;
    }
    const { error: uploadError } = await createClient()
      .storage.from("strata-plans")
      .uploadToSignedUrl(ticket.path, ticket.token, file, { contentType: "application/pdf" });
    if (uploadError) {
      setUpload({ status: "error", error: "The upload didn't finish. Please try again." });
      return;
    }
    setUpload({ status: "done", fileName: file.name, path: ticket.path });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (upload.status !== "done") {
      setError("Upload the Strata Plan first.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await submitCreationRequest({
      strataPlanNumber,
      legalName,
      address,
      unitCount: Number(unitCount),
      jurisdiction,
      planStoragePath: upload.path,
      planFileName: upload.fileName,
      attestationFullName: attestFullName,
      attestationAddress: attestAddress,
      attestationEmail: attestEmail,
      attestationPhone: attestPhone,
      attestationConfirmed: attestConfirmed,
    });
    setSubmitting(false);
    if (result.ok) {
      setSubmitted(true);
      onSubmitted();
    } else {
      setError(result.error);
    }
  }

  if (submitted) {
    return (
      <div className="card setup-result" data-testid="creation-request-submitted">
        <span className="pill">{strataPlanNumber}</span>
        <h3>Request submitted</h3>
        <p>
          Our team will check your details against the Strata Plan you
          uploaded. Once approved, the strata is created and you&rsquo;re its
          admin &mdash; you&rsquo;ll see it here.
        </p>
      </div>
    );
  }

  return (
    <form className="card setup-form" onSubmit={submit} data-testid="creation-request-form">
      <span className="pill">{strataPlanNumber}</span>
      <h3>{strataPlanNumber} isn&rsquo;t on StrataCouncil.ca yet</h3>
      <p>
        Add it by uploading its Strata Plan and confirming a few details.
        Every new strata is reviewed by our team before it&rsquo;s created.
      </p>

      <fieldset className="setup-form__section">
        <legend>1. Strata Plan</legend>
        <div className="field">
          <label htmlFor="strata-plan-file">Strata Plan PDF, as filed with the LTSA</label>
          <input
            id="strata-plan-file"
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => handleFile(e.target.files?.[0])}
            disabled={upload.status === "uploading"}
            data-testid="strata-plan-file"
          />
          {upload.status === "uploading" && <span className="field__hint">Uploading {upload.fileName}…</span>}
          {upload.status === "done" && (
            <span className="field__hint" data-testid="strata-plan-uploaded">
              Uploaded {upload.fileName}
            </span>
          )}
          {upload.status === "error" && <span className="roster-invites__error">{upload.error}</span>}
        </div>
      </fieldset>

      <fieldset className="setup-form__section">
        <legend>2. Plan details</legend>
        <div className="sync-note" data-testid="parsing-not-built-notice">
          Reading these from the Strata Plan automatically isn&rsquo;t built
          yet &mdash; please enter them from the plan. Our team checks them
          against your upload before anything is created.
        </div>
        <div className="field">
          <label htmlFor="cr-sp">Strata Plan number</label>
          <input id="cr-sp" type="text" value={strataPlanNumber} readOnly />
        </div>
        <div className="field">
          <label htmlFor="cr-legal-name">Legal name</label>
          <input
            id="cr-legal-name"
            type="text"
            placeholder={`The Owners, Strata Plan ${strataPlanNumber}`}
            value={legalName}
            onChange={(e) => setLegalName(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="cr-address">Civic address</label>
          <input id="cr-address" type="text" value={address} onChange={(e) => setAddress(e.target.value)} required />
        </div>
        <div className="setup-form__row">
          <div className="field">
            <label htmlFor="cr-units">Number of strata lots</label>
            <input
              id="cr-units"
              type="number"
              min={1}
              value={unitCount}
              onChange={(e) => setUnitCount(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="cr-jurisdiction">Jurisdiction</label>
            <select id="cr-jurisdiction" value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)}>
              {jurisdictions.map((j) => (
                <option key={j.code} value={j.code}>
                  {j.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </fieldset>

      <fieldset className="setup-form__section">
        <legend>3. Attestation</legend>
        <div className="field">
          <label htmlFor="at-name">Your full name</label>
          <input id="at-name" type="text" value={attestFullName} onChange={(e) => setAttestFullName(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="at-address">Your mailing address</label>
          <input id="at-address" type="text" value={attestAddress} onChange={(e) => setAttestAddress(e.target.value)} required />
        </div>
        <div className="setup-form__row">
          <div className="field">
            <label htmlFor="at-email">Email</label>
            <input id="at-email" type="email" value={attestEmail} onChange={(e) => setAttestEmail(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="at-phone">Phone</label>
            <input id="at-phone" type="tel" value={attestPhone} onChange={(e) => setAttestPhone(e.target.value)} required />
          </div>
        </div>
        <div className="field field--checkbox">
          <label>
            <input
              type="checkbox"
              checked={attestConfirmed}
              onChange={(e) => setAttestConfirmed(e.target.checked)}
              data-testid="attestation-confirm"
            />
            <span>{ATTESTATION_TEXT}</span>
          </label>
        </div>
      </fieldset>

      {error && (
        <p className="roster-invites__error" data-testid="creation-request-error">
          {error}
        </p>
      )}

      <button
        type="submit"
        className="button button-primary"
        disabled={submitting || upload.status !== "done" || !attestConfirmed}
        data-testid="creation-request-submit"
      >
        {submitting ? "Submitting…" : "Submit for review"}
      </button>
    </form>
  );
}
