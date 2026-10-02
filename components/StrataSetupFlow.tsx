"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  createStrataPlanUpload,
  parseStrataPlan,
  lookupStrata,
  requestToJoin,
  submitCreationRequest,
  type LookupResult,
} from "@/app/strata/actions";
import { createClient } from "@/lib/supabase/client";
import { jurisdictions } from "@/lib/strata";
import { legalNameFor } from "@/lib/strata-plan";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { hasPostalCode } from "@/lib/postal";

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

type ParseState =
  | { status: "idle" | "reading" | "no_text" | "failed" }
  | { status: "parsed"; lots: number; unitEntitlementTotal: number | null; filedYear: number | null }
  | { status: "wrong_plan"; found: string[] }
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
  const [parse, setParse] = useState<ParseState>({ status: "idle" });
  const [legalName, setLegalName] = useState(() => legalNameFor(strataPlanNumber));
  const [buildingName, setBuildingName] = useState("");
  const [address, setAddress] = useState("");
  const [addressVerified, setAddressVerified] = useState(false);
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

    // Read the plan: check it's this strata's plan, and take the lot count from it.
    setParse({ status: "reading" });
    const result = await parseStrataPlan(strataPlanNumber, ticket.path);
    if (!result.ok) setParse({ status: "error", error: result.error });
    else if (result.status === "parsed" && result.lots)
      setParse({
        status: "parsed",
        lots: result.lots,
        unitEntitlementTotal: result.unitEntitlementTotal,
        filedYear: result.filedYear,
      });
    else if (result.status === "wrong_plan") setParse({ status: "wrong_plan", found: result.found });
    else setParse({ status: result.status === "no_text" ? "no_text" : "failed" });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (upload.status !== "done") {
      setError("Upload the Strata Plan first.");
      return;
    }
    if (!hasPostalCode(address)) {
      setError("Add the postal code to the corporation's civic address.");
      return;
    }
    if (!hasPostalCode(attestAddress)) {
      setError("Add the postal code to your mailing address.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await submitCreationRequest({
      strataPlanNumber,
      legalName,
      buildingName,
      address,
      addressVerified,
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
        <PlanReading parse={parse} strataPlanNumber={strataPlanNumber} />
        <div className="setup-form__row">
          <div className="field">
            <label htmlFor="cr-sp">Strata Plan number</label>
            <input id="cr-sp" type="text" value={strataPlanNumber} readOnly />
          </div>
          <div className="field">
            <label htmlFor="cr-units">Number of strata lots</label>
            {parse.status === "parsed" ? (
              <>
                <input id="cr-units" type="text" value={parse.lots} readOnly data-testid="parsed-lots" />
                <span className="field__hint">Read from the plan.</span>
              </>
            ) : parse.status === "no_text" || parse.status === "failed" ? (
              <>
                <input
                  id="cr-units"
                  type="number"
                  min={1}
                  max={5000}
                  value={unitCount}
                  onChange={(e) => setUnitCount(e.target.value)}
                  required
                  data-testid="manual-lots"
                />
                <span className="field__hint">From the plan&rsquo;s Schedule of Unit Entitlement. Our team checks it.</span>
              </>
            ) : (
              <input id="cr-units" type="text" value="" placeholder="Read from the plan" readOnly />
            )}
          </div>
        </div>
        <div className="field">
          <label htmlFor="cr-legal-name">Legal name</label>
          <input
            id="cr-legal-name"
            type="text"
            value={legalName}
            onChange={(e) => setLegalName(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="cr-building">
            Building name <span className="field__optional">(optional)</span>
          </label>
          <input
            id="cr-building"
            type="text"
            value={buildingName}
            onChange={(e) => setBuildingName(e.target.value)}
            maxLength={200}
            placeholder="e.g. The Mackenzie"
            data-testid="building-name"
          />
          <span className="field__hint">The name people know the building by. It isn&rsquo;t on the Strata Plan, and you can change it later.</span>
        </div>
        <div className="field">
          <label htmlFor="cr-jurisdiction">Province or territory</label>
          <select id="cr-jurisdiction" value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)}>
            {jurisdictions.map((j) => (
              <option key={j.code} value={j.code}>
                {j.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="cr-address">Civic address</label>
          <AddressAutocomplete
            id="cr-address"
            value={address}
            jurisdiction={jurisdiction}
            onChange={(a, verified) => {
              setAddress(a);
              setAddressVerified(verified);
            }}
          />
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
          <AddressAutocomplete
            id="at-address"
            value={attestAddress}
            jurisdiction={jurisdiction}
            placeholder="Start typing your mailing address"
            onChange={(a) => setAttestAddress(a)}
          />
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
        disabled={
          submitting ||
          upload.status !== "done" ||
          !attestConfirmed ||
          parse.status === "reading" ||
          parse.status === "wrong_plan" ||
          parse.status === "error" ||
          parse.status === "idle"
        }
        data-testid="creation-request-submit"
      >
        {submitting ? "Submitting…" : "Submit for review"}
      </button>
    </form>
  );
}

/** What reading the uploaded plan found, shown above the plan details. */
function PlanReading({ parse, strataPlanNumber }: { parse: ParseState; strataPlanNumber: string }) {
  switch (parse.status) {
    case "idle":
      return <p className="sync-note">Upload the plan above. We read the number of strata lots from it.</p>;
    case "reading":
      return (
        <p className="sync-note" role="status" data-testid="plan-reading">
          Reading your Strata Plan&hellip; this can take up to a minute for a large plan.
        </p>
      );
    case "parsed":
      return (
        <p className="sync-note sync-note--ok" role="status" data-testid="plan-parsed">
          Strata Plan {strataPlanNumber} read: {parse.lots} strata lots
          {parse.unitEntitlementTotal ? `, total unit entitlement ${parse.unitEntitlementTotal.toLocaleString("en-CA")}` : ""}
          {parse.filedYear ? `, filed ${parse.filedYear}` : ""}.
        </p>
      );
    case "wrong_plan":
      return (
        <p className="roster-invites__error" role="alert" data-testid="plan-wrong">
          That file doesn&rsquo;t look like the Strata Plan for {strataPlanNumber}
          {parse.found.length ? ` (it mentions ${parse.found.join(", ")})` : ""}. Upload the right plan.
        </p>
      );
    case "no_text":
      return (
        <p className="sync-note" role="status" data-testid="plan-scanned">
          This plan is a scanned image, so it can&rsquo;t be read automatically. Enter the number of strata lots from the
          plan; our team checks it before the strata is created.
        </p>
      );
    case "failed":
      return (
        <p className="sync-note" role="status" data-testid="plan-unread">
          We couldn&rsquo;t find the number of strata lots in this plan. Enter it from the plan; our team checks it before
          the strata is created.
        </p>
      );
    case "error":
      return <p className="roster-invites__error" role="alert">{parse.error}</p>;
  }
}
