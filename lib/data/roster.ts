import { createClient } from "@/lib/supabase/server";
import { isCorporationRole, type CorporationRole } from "@/lib/strata";

/**
 * Real replacement for lib/placeholder-data.ts's `roster` /
 * `corporationInvites` / `corporationJoinRequests` mocks on Council &
 * Roles (doc01 §1, §3). Everything goes through the signed-in user's
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
  /** The strata lot this member is tied to (council members need one). */
  lotNumber: string | null;
  roles: CorporationRole[];
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

  const [directory, roles, corporation, lots] = await Promise.all([
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
    supabase.from("owners_and_council").select("lot_number").eq("corporation_id", corporationId).order("lot_number"),
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

  const members: RosterMember[] = (directory.data ?? []).map(
    (m: {
      user_id: string;
      full_name: string | null;
      email: string | null;
      status: "active" | "invited";
      joined_at: string | null;
      can_run_meetings: boolean;
      lot_number: string | null;
    }) => ({
      userId: m.user_id,
      fullName: m.full_name || m.email || "Unnamed member",
      email: m.email ?? "",
      status: m.status,
      joinedAt: m.joined_at,
      canRunMeetings: m.can_run_meetings,
      lotNumber: m.lot_number ?? null,
      roles: rolesByUser.get(m.user_id) ?? [],
    })
  );

  const isAdmin = rolesByUser.get(user.id)?.includes("admin") ?? false;

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
    lots: (lots.data ?? []).map((l) => l.lot_number as string),
    invites,
    joinRequests,
  };
}
