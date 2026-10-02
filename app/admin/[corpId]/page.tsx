import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { MemberAvatar } from "@/components/MemberAvatar";
import { AdminDecisionLedger } from "@/components/AdminDecisionLedger";
import { signAvatarPaths } from "@/lib/data/avatars";
import { getAllCorporations } from "@/lib/data/admin";
import { getCurrentProfile } from "@/lib/data/profile";
import { createClient } from "@/lib/supabase/server";
import { corporationRoleLabels, isCorporationRole } from "@/lib/strata";
import { meetingTypeLabels, type MeetingType } from "@/lib/meetings/agenda";

const subscriptionLabels: Record<string, string> = {
  active: "Stratasphere™ active",
  none: "Free tier, never subscribed",
  deactivated: "Deactivated",
};

/**
 * Corp detail view inside the Super Admin console. "Open this strata as
 * its admin" goes to the strata itself, where a Super Admin has full admin
 * control (0021) without becoming a member: this profile never appears in
 * the corp's own roster or membership list.
 *
 * The roster comes from `corporation_member_directory()` and
 * `corporation_role_assignments`, both of which allow a Super Admin to
 * read (0010). The decision ledger is readable for support (0017).
 */
export default async function AdminCorporationDetailPage({
  params,
}: {
  params: Promise<{ corpId: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile?.isSuperAdmin) notFound();

  const { corpId } = await params;
  const corporation = (await getAllCorporations()).find((c) => c.id === corpId);
  if (!corporation) notFound();

  const supabase = await createClient();
  const [{ data: members }, { data: roleRows }, { data: decisionRows, error: decisionsError }] = await Promise.all([
    supabase.rpc("corporation_member_directory", { p_corporation_id: corpId }),
    supabase
      .from("corporation_role_assignments")
      .select("user_id, role")
      .eq("corporation_id", corpId),
    supabase
      .from("decisions")
      .select("id, title, motion_text, mover, seconder, votes_for, votes_against, votes_abstain, decided_at, meeting_type, source")
      .eq("corporation_id", corpId)
      .order("decided_at", { ascending: false })
      .limit(5000),
  ]);
  if (decisionsError) console.error("[admin decisions]", decisionsError.message);
  const decisions = (decisionRows ?? []) as {
    id: string;
    title: string | null;
    motion_text: string | null;
    mover: string | null;
    seconder: string | null;
    votes_for: number | null;
    votes_against: number | null;
    votes_abstain: number | null;
    decided_at: string;
    meeting_type: string | null;
    source: string;
  }[];

  const directory = (members ?? []) as {
    user_id: string;
    full_name: string | null;
    email: string | null;
    status: string;
    avatar_path: string | null;
  }[];
  const avatars = await signAvatarPaths(directory.map((m) => m.avatar_path));
  const roster = directory.map((m) => ({
    avatarUrl: m.avatar_path ? avatars.get(m.avatar_path) ?? null : null,
    id: m.user_id,
    name: m.full_name || m.email || "Unnamed member",
    email: m.email ?? "",
    status: m.status,
    roles: (roleRows ?? [])
      .filter((r) => r.user_id === m.user_id)
      .map((r) => r.role)
      .filter(isCorporationRole),
  }));
  const activeCount = roster.filter((m) => m.status === "active").length;

  return (
    <AppShell active="admin">
      <div className="wrap page">
        <Link href="/admin" className="kb-article__back">
          &larr; Super Admin console
        </Link>

        <div className="page-header">
          <span className="pill pill--locked">{corporation.strataPlanNumber}</span>
          <h1 style={{ marginTop: "0.6rem" }}>{corporation.buildingName ?? corporation.legalName}</h1>
          <p>{corporation.address}</p>
          <p style={{ marginTop: "1rem" }}>
            <Link
              href={`/strata/${corporation.strataPlanNumber}`}
              className="button button-primary"
              data-testid="admin-open-strata"
            >
              Open this strata as its admin
            </Link>
          </p>
        </div>

        <div className="grid-cards" style={{ marginBottom: "2.5rem" }}>
          <div className="card">
            <h3>Corporation</h3>
            <p>{corporation.legalName}</p>
            <p style={{ marginTop: "-0.5rem" }}>
              Jurisdiction: {corporation.jurisdiction} &middot; {corporation.unitCount} units
            </p>
          </div>
          <div className="card">
            <h3>Subscription</h3>
            <p>{subscriptionLabels[corporation.subscriptionStatus]}</p>
            <p style={{ marginTop: "-0.5rem" }}>
              Free meeting {corporation.freeMeetingUsed ? "used" : "not yet used"}
            </p>
          </div>
          <div className="card">
            <h3>Roster</h3>
            <p>{activeCount} connected {activeCount === 1 ? "member" : "members"}</p>
          </div>
        </div>

        <h2 style={{ marginBottom: "1rem" }}>Roster</h2>
        {roster.length === 0 ? (
          <p className="roster-notice">No members.</p>
        ) : (
          <div className="roster-table-wrap">
            <table className="roster-table" data-testid="admin-roster-table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Roles</th>
                </tr>
              </thead>
              <tbody>
                {roster.map((member) => (
                  <tr key={member.id}>
                    <td>
                      <div className="roster-member">
                        <MemberAvatar name={member.name} url={member.avatarUrl} />
                        <div>
                          {member.name}
                          <div className="roster-table__meta">{member.email}</div>
                          {member.status !== "active" && <span className="pill pill--locked">Invited</span>}
                        </div>
                      </div>
                    </td>
                    <td>
                      {member.roles.length === 0 ? (
                        <span className="roster-table__na">&mdash;</span>
                      ) : (
                        member.roles.map((role) => (
                          <span className="role-tag" key={role}>
                            {corporationRoleLabels[role]}
                          </span>
                        ))
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <h2 style={{ margin: "2.5rem 0 1rem" }}>Decision ledger</h2>
        <AdminDecisionLedger
          decisions={decisions.map((d) => ({
            id: d.id,
            date: d.decided_at.slice(0, 10),
            title: d.title || "Untitled motion",
            motionText: d.motion_text,
            mover: d.mover,
            seconder: d.seconder,
            votes: `${d.votes_for ?? "—"} / ${d.votes_against ?? "—"} / ${d.votes_abstain ?? "—"}`,
            source: d.source === "historic_minutes" ? "Historic minutes" : (meetingTypeLabels[d.meeting_type as MeetingType] ?? "Meeting"),
          }))}
        />
      </div>
    </AppShell>
  );
}
