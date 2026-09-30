import Link from "next/link";
import { AppShell } from "@/components/AppShell";

/**
 * Zero-corporation state (doc03 "Zero, one, and many connections") — the
 * "Set up your strata" CTA. A real build would only render this when the
 * signed-in user has no `corporation_memberships` rows; once one exists
 * this route is effectively replaced by redirecting straight into
 * `/strata/[corpId]`.
 *
 * The SP# lookup below is a UI shell for doc01 §1's "lookup-first, not
 * upload-first" flow: match an existing corp routes into a join request;
 * no match prompts a Strata Plan upload that becomes a pending, manually
 * reviewed creation request.
 *
 * Desktop-gated like the rest of /strata — see the layout for `/strata/
 * [corpId]` for why.
 */
export default function StrataSetupPage() {
  return (
    <AppShell>
      <div className="wrap page">
        <div className="screen-gate-notice">
          <span className="pill pill--locked">Desktop required</span>
          <h2>Stratasphere&trade; is best experienced on a larger screen</h2>
          <p>
            Setting up your strata involves uploading a document and a
            short form &mdash; easier on a desktop or laptop. Please
            switch devices to continue.
          </p>
          <Link href="/training" className="button button-secondary">
            Go to Council Training
          </Link>
        </div>

        <div className="screen-gate-content">
          <div className="page-header">
            <h1>Set up your strata on Stratasphere&trade;</h1>
            <p>
              Connecting is free and doesn&rsquo;t require any training to be
              completed first. Enter your strata plan number to get started.
            </p>
          </div>

          <div className="auth-card" style={{ maxWidth: 480, margin: 0 }}>
            <div className="field">
              <label htmlFor="sp-number">Strata plan number</label>
              <input id="sp-number" name="sp-number" type="text" placeholder="e.g. BCS-4821" data-testid="sp-lookup-input" />
              <span className="field__hint">
                We&rsquo;ll check if your strata is already on the platform.
              </span>
            </div>
            <button className="button button-primary" data-testid="sp-lookup-submit">
              Look up my strata
            </button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
