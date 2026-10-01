import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { getAllCorporations } from "@/lib/data/admin";
import { getCurrentProfile } from "@/lib/data/profile";
import { createClient } from "@/lib/supabase/server";
import { corporationRoleLabels, isCorporationRole } from "@/lib/strata";

const subscriptionLabels: Record<string, string> = {
  active: "Stratasphere™ active",
  none: "Free tier, never subscribed",
  deactivated: "Deactivated",
};

/**
 * Read-only corp detail view inside the Super Admin console — privileged
 * data access, not impersonation. This profile never appears in the
 * corp's own roster or membership list just by viewing this page, and
 * nothing here is editable; a Super Admin who needs to actually change
 * something (unit count, a StrataSphere reactivation) does that through
 * the specific reviewed action it is, not a general edit mode bolted
 * onto this page (doc01 §1).
 *
 * The roster comes from `corporation_member_directory()` and
 * `corporation_role_assignments`, both of which allow a Super Admin to
 * read (0010).
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
  const [{ data: members }, { data: roleRows }] = await Promise.all([
    supabase.rpc("corporation_member_directory", { p_corporation_id: corpId }),
    supabase
      .from("corporation_role_assignments")
      .select("user_id, role")
      .eq("corporation_id", corpId),
  ]);

  const roster = ((members ?? []) as {
    user_id: string;
    full_name: string | null;
    email: string | null;
    status: string;
  }[]).map((m) => ({
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
          &larr; Admin console
        </Link>

        <div className="page-header">
          <span className="pill pill--locked">{corporation.strataPlanNumber}</span>
          <h1 style={{ marginTop: "0.6rem" }}>{corporation.buildingName ?? corporation.legalName}</h1>
          <p>{corporation.address}</p>
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
                      {member.name}
                      <div className="roster-table__meta">{member.email}</div>
                      {member.status !== "active" && <span className="pill pill--locked">Invited</span>}
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
      </div>
    </AppShell>
  );
}
