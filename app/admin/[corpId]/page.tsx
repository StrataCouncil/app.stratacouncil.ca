import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { MemberAvatar } from "@/components/MemberAvatar";
import { AdminDecisionLedger } from "@/components/AdminDecisionLedger";
import { signAvatarPaths } from "@/lib/data/avatars";
import { getAllCorporations } from "@/lib/data/admin";
import { getStrataDashboard } from "@/lib/data/admin-dashboard";
import { documentCategoryLabels, isDocumentCategory } from "@/lib/documents";
import { getCurrentProfile } from "@/lib/data/profile";
import { createClient } from "@/lib/supabase/server";
import { corporationRoleLabels, isCorporationRole } from "@/lib/strata";
import { meetingTypeLabels, type MeetingType } from "@/lib/meetings/agenda";

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
  searchParams,
}: {
  params: Promise<{ corpId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile?.isSuperAdmin) notFound();

  const { corpId } = await params;
  const tab = (await searchParams).tab === "ledger" ? "ledger" : "dashboard";
  const corporation = (await getAllCorporations()).find((c) => c.id === corpId);
  if (!corporation) notFound();
  const dash = await getStrataDashboard(corpId);

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

        <nav className="substrata-nav" aria-label="Strata console">
          <Link href={`/admin/${corpId}`} data-active={tab === "dashboard"} data-testid="admin-tab-dashboard">
            Dashboard
          </Link>
          <Link href={`/admin/${corpId}?tab=ledger`} data-active={tab === "ledger"} data-testid="admin-tab-ledger">
            Decision ledger
          </Link>
        </nav>

        {tab === "dashboard" && dash && (
          <>
            <div className="admin-stats" data-testid="admin-dashboard">
              <Stat title="People" main={`${dash.people.active} active`}>
                {dash.people.invited ? `${dash.people.invited} invited · ` : ""}
                {dash.people.pendingInvites} pending invites · {dash.people.pendingJoinRequests} join requests
              </Stat>
              <Stat title="Owner roster" main={`${dash.lots.named} of ${corporation.unitCount} lots named`}>
                {dash.lots.total} lots on the roster
              </Stat>
              <Stat title="Documents" main={`${dash.documents.total} uploaded`}>
                {dash.documents.indexed} indexed
                {dash.documents.inProgress ? ` · ${dash.documents.inProgress} indexing` : ""}
                {dash.documents.problems ? ` · ${dash.documents.problems} need attention` : ""}
                {dash.documents.lastUploadedAt ? ` · last ${day(dash.documents.lastUploadedAt)}` : ""}
              </Stat>
              <Stat title="Meetings" main={`${dash.meetings.total} total`}>
                {dash.meetings.adjourned} held · {dash.meetings.draft} draft
                {dash.meetings.live ? ` · ${dash.meetings.live} in progress` : ""}
                {dash.meetings.noQuorum ? ` · ${dash.meetings.noQuorum} without quorum` : ""}
                {dash.meetings.lastHeldAt ? ` · last held ${day(dash.meetings.lastHeldAt)}` : ""}
                {dash.meetings.nextDate ? ` · next ${dash.meetings.nextDate}` : ""}
              </Stat>
              <Stat title="Decision ledger" main={`${dash.decisions.total} decisions`}>
                {dash.decisions.lastDecidedAt ? `Latest ${day(dash.decisions.lastDecidedAt)}` : "None yet"}
              </Stat>
              <Stat
                title="Subscription"
                main={dash.subscription.status === "active" ? "Active" : dash.subscription.status === "deactivated" ? "Deactivated" : "Not subscribed"}
              >
                {dash.subscription.interval ? `${dash.subscription.interval === "annual" ? "Annual" : "Monthly"} · ` : ""}
                {dash.subscription.activatedAt ? `since ${day(dash.subscription.activatedAt)} · ` : ""}
                Free meeting {dash.subscription.freeMeetingUsed ? "used" : "not yet used"}
              </Stat>
              <Stat title="Stratasphere, last 30 days" main={`${dash.usage.questions30} questions`}>
                {usd(dash.usage.cost30Usd)} estimated · {dash.usage.users30} {dash.usage.users30 === 1 ? "person" : "people"}
              </Stat>
              <Stat title="Stratasphere, all time" main={`${dash.usage.questions} questions`}>
                {usd(dash.usage.costUsd)} estimated · {dash.usage.meetingQuestions} in meetings · {dash.conversations} conversations
                {dash.usage.lastAt ? ` · last ${day(dash.usage.lastAt)}` : ""}
              </Stat>
            </div>
            <p className="card__meta" style={{ margin: "-1rem 0 2rem" }}>
              {corporation.legalName} &middot; {corporation.jurisdiction} &middot; {corporation.unitCount} units
              {dash.createdAt ? <> &middot; on StrataCouncil.ca since {day(dash.createdAt)}</> : null}. Usage costs are
              estimates at list price, from the logged token counts.
            </p>

            {dash.documents.byCategory.length > 0 && (
              <>
                <h2 style={{ marginBottom: "1rem" }}>Documents by folder</h2>
                <div className="admin-folders">
                  {dash.documents.byCategory.map((c) => (
                    <span className="admin-folder" key={c.category}>
                      {isDocumentCategory(c.category) ? documentCategoryLabels[c.category] : "Uncategorized"} <strong>{c.count}</strong>
                    </span>
                  ))}
                </div>
              </>
            )}

            <h2 style={{ margin: "2rem 0 1rem" }}>Members and roles</h2>
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

          </>
        )}

        {tab === "ledger" && (
          <>
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
          </>
        )}
      </div>
    </AppShell>
  );
}

function Stat({ title, main, children }: { title: string; main: string; children?: React.ReactNode }) {
  return (
    <div className="card admin-stat">
      <h3>{title}</h3>
      <p className="admin-stat__main">{main}</p>
      {children ? <p className="card__meta">{children}</p> : null}
    </div>
  );
}

const day = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
const usd = (n: number) => n.toLocaleString("en-CA", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
