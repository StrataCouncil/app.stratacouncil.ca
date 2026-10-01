import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { StrataSetupFlow } from "@/components/StrataSetupFlow";
import { getConnectedCorporations } from "@/lib/data/corporations";
import { getCurrentProfile } from "@/lib/data/profile";
import { createClient } from "@/lib/supabase/server";
import { acceptInvite } from "./actions";

/**
 * Connect a strata (doc03 "Zero, one, and many connections"). With no
 * connected corporation this is the landing page; with one or more, it
 * redirects into the first — unless `?connect=1` (the switcher's
 * "+ Connect another strata"), which shows the flow anyway.
 *
 * Shows, in order: invites waiting for this account (accept here if the
 * email link expired), the user's own open requests, then the SP# lookup
 * (components/StrataSetupFlow.tsx).
 *
 * TEMPORARY: renders raw debug info (signed-in user id/email, the real
 * query result) directly on the page instead of only logging server-side
 * — Vercel's log UI was too much friction to debug through live. Remove
 * this block once the redirect bug is confirmed fixed.
 */

const requestStatusLabels: Record<string, string> = {
  pending: "Waiting for review",
  approved: "Approved",
  denied: "Not approved",
};

export default async function StrataSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ connect?: string; error?: string }>;
}) {
  const { connect, error: errorMessage } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const corporations = await getConnectedCorporations();
  if (corporations.length > 0 && !connect) {
    redirect(`/strata/${corporations[0].id}`);
  }

  const [profile, invites, creationRequests, joinRequests] = await Promise.all([
    getCurrentProfile(),
    supabase.rpc("my_pending_invites"),
    supabase
      .from("corporation_creation_requests")
      .select("id, parsed_strata_plan_number, parsed_legal_name, status, requested_at")
      .order("requested_at", { ascending: false })
      .limit(10),
    supabase
      .from("corporation_join_requests")
      .select("id, corporation_id, status, requested_at")
      .order("requested_at", { ascending: false })
      .limit(10),
  ]);

  const pendingInvites = (invites.data ?? []) as {
    id: string;
    corporation_id: string;
    legal_name: string;
    building_name: string | null;
    invited_by_name: string | null;
  }[];

  // Approved requests already show up as a connected strata; only list
  // what's still open or was turned down.
  const openRequests = [
    ...(creationRequests.data ?? [])
      .filter((r) => r.status !== "approved")
      .map((r) => ({
        id: r.id,
        label: `Add ${r.parsed_strata_plan_number}${r.parsed_legal_name ? ` — ${r.parsed_legal_name}` : ""}`,
        status: r.status,
        requestedAt: r.requested_at,
      })),
    ...(joinRequests.data ?? [])
      .filter((r) => r.status !== "approved")
      .map((r) => ({
        id: r.id,
        label: `Join ${r.corporation_id}`,
        status: r.status,
        requestedAt: r.requested_at,
      })),
  ].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));

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
            <h1>
              {corporations.length > 0
                ? "Connect another strata"
                : "Set up your strata on Stratasphere™"}
            </h1>
            <p>
              Connecting is free and doesn&rsquo;t require any training to be
              completed first. Enter your strata plan number to get started.
            </p>
          </div>

          {errorMessage && (
            <p className="roster-invites__error" data-testid="strata-error" style={{ marginBottom: "1rem" }}>
              {errorMessage}
            </p>
          )}

          {pendingInvites.length > 0 && (
            <div className="card roster-invites setup-requests" data-testid="my-pending-invites">
              <h3>You&rsquo;ve been invited</h3>
              <ul className="roster-invites__list">
                {pendingInvites.map((invite) => (
                  <li key={invite.id}>
                    <div>
                      <span className="roster-invites__email">
                        {invite.building_name || invite.legal_name}
                      </span>
                      <span className="card__meta">
                        {invite.corporation_id}
                        {invite.invited_by_name && <> &middot; invited by {invite.invited_by_name}</>}
                      </span>
                    </div>
                    <form action={acceptInvite.bind(null, invite.id)}>
                      <button
                        type="submit"
                        className="button button-primary button-small"
                        data-testid={`accept-invite-${invite.id}`}
                      >
                        Accept
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {openRequests.length > 0 && (
            <div className="card roster-invites setup-requests" data-testid="my-open-requests">
              <h3>Your requests</h3>
              <ul className="roster-invites__list">
                {openRequests.map((request) => (
                  <li key={request.id}>
                    <div>
                      <span className="roster-invites__email">{request.label}</span>
                      <span className="card__meta">
                        Requested {new Date(request.requestedAt).toLocaleDateString("en-CA")}
                      </span>
                    </div>
                    <span className={`pill ${request.status === "pending" ? "" : "pill--locked"}`}>
                      {requestStatusLabels[request.status] ?? request.status}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <StrataSetupFlow
            defaultFullName={profile?.fullName ?? ""}
            defaultEmail={profile?.email ?? ""}
          />
        </div>
      </div>
    </AppShell>
  );
}
