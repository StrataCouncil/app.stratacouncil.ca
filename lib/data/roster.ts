import { getCredentialsFor } from "@/lib/data/training";
import { createClient } from "@/lib/supabase/server";
import { EMAIL_RE, isCorporationRole, type CorporationRole } from "@/lib/strata";
import { isStrataAdmin } from "@/lib/auth/strata-admin";
import { signAvatarPaths } from "@/lib/data/avatars";

/**
 * Members, invites and join requests for the Council page
 * (doc01 §1, §3). Everything goes through the signed-in user's
 * RLS-scoped client:
 *
 *   - members: `corporation_member_directory()` (0010) — memberships
 *     joined to profiles, which plain RLS can't do since profiles is
 *     read-own-row only.
 *   - roles: `corporation_role_assignments`, readable by any member.
 *   - invites / join requests: admin-only under RLS; for a non-admin
 *     these simply come back empty, and `isAdmin` is false.
 */
export interface RosterMember {
  userId: string;
  fullName: string;
  email: string;
  status: "active" | "invited";
  joinedAt: string | null;
  /** The "Can run meetings" switch; admin and secretary hold it through their role regardless. */
  canRunMeetings: boolean;
  /** The "Billing" switch (0046); the admin has billing through the role regardless. */
  canManageBilling: boolean;
  /** The strata lot this member is tied to (council members need one). */
  lotNumber: string | null;
  roles: CorporationRole[];
  /** Signed link to their profile picture, if they've added one. */
  avatarUrl: string | null;
  /** Council Training credentials held (track codes). */
  credentials: string[];
  /** Invited from a council lot (0051): the council role they'll get on accepting ("council" when the lot has none). */
  invitedCouncilRole?: string;
}

/**
 * Someone listed but with no account yet, shown on Council as "Not
 * invited yet" and invitable from there when they have an email: a
 * council member typed on the Owners page (a lot marked as council,
 * 0051), or a manager listed on the Management tab (0052).
 */
export interface UninvitedCouncilMember {
  kind: "council" | "manager";
  /** Unique on the page: the lot, or "manager-<n>". */
  key: string;
  /** The council lot; null for a manager. */
  lotNumber: string | null;
  name: string;
  role: string | null;
  /** Council: the council email, else the owner's. Manager: their email. Only if valid. */
  email: string | null;
}

export interface PendingInvite {
  id: string;
  email: string;
  invitedByName: string | null;
  createdAt: string;
  expiresAt: string;
}

export interface PendingJoinRequest {
  id: string;
  requesterId: string;
  fullName: string;
  email: string;
  requestedAt: string;
}

export interface CorporationRoster {
  currentUserId: string;
  isAdmin: boolean;
  jurisdiction: string;
  members: RosterMember[];
  /** Council lots from Owners and managers from Management with no account here yet. */
  uninvited: UninvitedCouncilMember[];
  /** Every strata lot on the roster, for tying members to their lot. */
  lots: string[];
  invites: PendingInvite[];
  joinRequests: PendingJoinRequest[];
}

export async function getCorporationRoster(
  corporationId: string
): Promise<CorporationRoster | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [directory, roles, corporation, lots, management] = await Promise.all([
    supabase.rpc("corporation_member_directory", { p_corporation_id: corporationId }),
    supabase
      .from("corporation_role_assignments")
      .select("user_id, role")
      .eq("corporation_id", corporationId),
    supabase
      .from("strata_corporations")
      .select("jurisdiction")
      .eq("strata_plan_number", corporationId)
      .maybeSingle(),
    supabase
      .from("owners_and_council")
      .select("lot_number, full_name, email, is_council_member, council_member_name, council_email, role")
      .eq("corporation_id", corporationId)
      .order("lot_number"),
    supabase.from("strata_management").select("managers").eq("corporation_id", corporationId).maybeSingle(),
  ]);

  for (const [label, result] of [
    ["corporation_member_directory", directory],
    ["corporation_role_assignments", roles],
    ["strata_corporations", corporation],
  ] as const) {
    if (result.error) {
      console.error(`[getCorporationRoster] ${label} error for ${corporationId}:`, result.error.message);
    }
  }

  const rolesByUser = new Map<string, CorporationRole[]>();
  for (const row of roles.data ?? []) {
    if (!isCorporationRole(row.role)) continue;
    rolesByUser.set(row.user_id, [...(rolesByUser.get(row.user_id) ?? []), row.role]);
  }

  const avatars = await signAvatarPaths(
    ((directory.data ?? []) as { avatar_path: string | null }[]).map((m) => m.avatar_path)
  );
  const members: RosterMember[] = (directory.data ?? []).map(
    (m: {
      user_id: string;
      full_name: string | null;
      email: string | null;
      status: "active" | "invited";
      joined_at: string | null;
      can_run_meetings: boolean;
      lot_number: string | null;
      avatar_path: string | null;
      can_manage_billing?: boolean;
    }) => ({
      userId: m.user_id,
      fullName: m.full_name || m.email || "Unnamed member",
      email: m.email ?? "",
      status: m.status,
      joinedAt: m.joined_at,
      canRunMeetings: m.can_run_meetings,
      canManageBilling: Boolean(m.can_manage_billing),
      lotNumber: m.lot_number ?? null,
      roles: rolesByUser.get(m.user_id) ?? [],
      avatarUrl: m.avatar_path ? avatars.get(m.avatar_path) ?? null : null,
      credentials: [],
    })
  );
  // Council lots typed on the Owners page. A member tied to the lot (or
  // invited from it) takes its place; an invited member with no name yet
  // shows the typed one.
  const lotRows = (lots.data ?? []) as {
    lot_number: string;
    full_name: string | null;
    email: string | null;
    is_council_member: boolean;
    council_member_name: string | null;
    council_email: string | null;
    role: string | null;
  }[];
  const takenLots = new Set(members.map((m) => m.lotNumber).filter(Boolean));
  const typedName = (l: (typeof lotRows)[number]) => (l.council_member_name || l.full_name || "").trim();
  for (const m of members) {
    const lot = m.status === "invited" && m.lotNumber ? lotRows.find((l) => l.lot_number === m.lotNumber) : null;
    if (lot && (m.fullName === m.email || m.fullName === "Unnamed member") && typedName(lot)) m.fullName = typedName(lot);
    if (lot?.is_council_member) m.invitedCouncilRole = lot.role ?? "council";
  }
  const uninvited: UninvitedCouncilMember[] = lotRows
    .filter((l) => l.is_council_member && !takenLots.has(l.lot_number))
    .map((l) => {
      const email = [l.council_email, l.email].map((e) => (e ?? "").trim()).find((e) => EMAIL_RE.test(e)) ?? null;
      return { kind: "council", key: l.lot_number, lotNumber: l.lot_number, name: typedName(l) || l.lot_number, role: l.role, email };
    });

  // Managers listed on the Management tab. One with an account here (by
  // email) is a member row already; one invited shows the Manager tag.
  const memberEmails = new Map(members.map((m) => [m.email.toLowerCase(), m]));
  const listed = (Array.isArray(management.data?.managers) ? management.data.managers : []) as {
    name?: string;
    email?: string;
  }[];
  listed.forEach((mg, i) => {
    const name = (mg.name ?? "").trim();
    const email = (mg.email ?? "").trim();
    if (!name && !email) return;
    const member = email ? memberEmails.get(email.toLowerCase()) : undefined;
    if (member) {
      if (member.status === "invited" && member.roles.length === 0) {
        member.invitedCouncilRole = "manager";
        if (name && (member.fullName === member.email || member.fullName === "Unnamed member")) member.fullName = name;
      }
      return;
    }
    uninvited.push({
      kind: "manager",
      key: `manager-${i}`,
      lotNumber: null,
      name: name || email,
      role: "manager",
      email: EMAIL_RE.test(email) ? email : null,
    });
  });

  const credentials = await getCredentialsFor(members.map((m) => m.userId));
  for (const m of members) m.credentials = [...(credentials.get(m.userId) ?? [])];

  const isAdmin = await isStrataAdmin(supabase, corporationId);

  let invites: PendingInvite[] = [];
  let joinRequests: PendingJoinRequest[] = [];

  if (isAdmin) {
    const [inviteRows, requestRows] = await Promise.all([
      supabase
        .from("corporation_invites")
        .select("id, invited_email, invited_by, created_at, expires_at")
        .eq("corporation_id", corporationId)
        .eq("status", "pending")
        .order("created_at"),
      supabase.rpc("corporation_join_request_queue", { p_corporation_id: corporationId }),
    ]);

    if (inviteRows.error) {
      console.error("[getCorporationRoster] corporation_invites error:", inviteRows.error.message);
    }
    if (requestRows.error) {
      console.error("[getCorporationRoster] corporation_join_request_queue error:", requestRows.error.message);
    }

    const nameById = new Map(members.map((m) => [m.userId, m.fullName]));
    invites = (inviteRows.data ?? []).map((i) => ({
      id: i.id,
      email: i.invited_email,
      invitedByName: i.invited_by === user.id ? "you" : nameById.get(i.invited_by) ?? null,
      createdAt: i.created_at,
      expiresAt: i.expires_at,
    }));

    joinRequests = (requestRows.data ?? []).map(
      (r: { id: string; requested_by: string; full_name: string | null; email: string | null; requested_at: string }) => ({
        id: r.id,
        requesterId: r.requested_by,
        fullName: r.full_name || r.email || "Unnamed account",
        email: r.email ?? "",
        requestedAt: r.requested_at,
      })
    );
  }

  return {
    currentUserId: user.id,
    isAdmin,
    jurisdiction: corporation.data?.jurisdiction ?? "",
    members,
    uninvited,
    lots: lotRows.map((l) => l.lot_number),
    invites,
    joinRequests,
  };
}
