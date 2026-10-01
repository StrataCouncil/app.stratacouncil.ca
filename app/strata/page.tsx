import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { getConnectedCorporations } from "@/lib/data/corporations";

/**
 * Zero-corporation state (doc03 "Zero, one, and many connections") — the
 * "Set up your strata" CTA.
 *
 * Now actually checks the signed-in user's real `corporation_memberships`
 * and redirects straight to `/strata/[corpId]` if they have one, instead
 * of always showing this screen regardless of real connection state.
 *
 * The SP# lookup below is still a UI shell, not wired to a real
 * lookup/upload/review backend yet — that's the corp-creation pipeline
 * (doc01 §1), real work for a later pass, not this one.
 */
export default async function StrataSetupPage() {
  const corporations = await getConnectedCorporations();
  if (corporations.length > 0) {
    redirect(`/strata/${corporations[0].id}`);
  }

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
            <button className="button button-primary" disabled title="Not wired up yet — real work" data-testid="sp-lookup-submit">
              Look up my strata
            </button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
