import { RosterInvites } from "@/components/RosterInvites";
import { RosterJoinRequests } from "@/components/RosterJoinRequests";
import { RosterTable } from "@/components/RosterTable";
import type { CorporationRoster } from "@/lib/data/roster";

/**
 * Council & Roles (doc01 §1, §3), backed by real data from
 * `getCorporationRoster()` (lib/data/roster.ts). No shared client state
 * any more: every change is a Server Action that writes through RLS and
 * revalidates the page, so an approved join request or accepted invite
 * shows up in the table because the server re-rendered it, not because
 * one component handed a row to another.
 *
 * Join requests and invites are admin-only — RLS returns nothing for
 * anyone else, and they aren't rendered for them either.
 */
export function CouncilRoster({
  corporationId,
  roster,
}: {
  corporationId: string;
  roster: CorporationRoster;
}) {
  return (
    <>
      {roster.isAdmin && (
        <>
          <RosterJoinRequests corporationId={corporationId} requests={roster.joinRequests} />
          <RosterInvites corporationId={corporationId} invites={roster.invites} />
        </>
      )}
      <div id="roster" />
      <RosterTable
        corporationId={corporationId}
        members={roster.members}
        lots={roster.lots}
        isAdmin={roster.isAdmin}
        currentUserId={roster.currentUserId}
        jurisdiction={roster.jurisdiction}
      />
    </>
  );
}
