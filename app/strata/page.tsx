import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { getConnectedCorporations } from "@/lib/data/corporations";
import { createClient } from "@/lib/supabase/server";

/**
 * Zero-corporation state (doc03 "Zero, one, and many connections") — the
 * "Set up your strata" CTA.
 *
 * TEMPORARY: renders raw debug info (signed-in user id/email, the real
 * query result) directly on the page instead of only logging server-side
 * — Vercel's log UI was too much friction to debug through live. Remove
 * this block once the redirect bug is confirmed fixed.
 */
export default async function StrataSetupPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const corporations = await getConnectedCorporations();
  if (corporations.length > 0) {
    redirect(`/strata/${corporations[0].id}`);
  }

  return (
    <AppShell>
      <div className="wrap page">
        <div
          style={{
            background: "#fff3cd",
            border: "1px solid #d4a017",
            borderRadius: 8,
            padding: "1rem",
            margin: "1rem 0",
            fontFamily: "monospace",
            fontSize: "0.85rem",
            whiteSpace: "pre-wrap",
          }}
        >
          {"DEBUG (temporary)\n"}
          {`signed in as: ${user ? `${user.id} / ${user.email}` : "NO USER"}\n`}
          {`connected corporations found: ${corporations.length}\n`}
          {JSON.stringify(corporations, null, 2)}
        </div>

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
