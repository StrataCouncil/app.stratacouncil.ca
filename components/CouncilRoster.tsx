"use client";

import { useState } from "react";
import { RosterInvites } from "@/components/RosterInvites";
import { RosterJoinRequests } from "@/components/RosterJoinRequests";
import { RosterTable } from "@/components/RosterTable";
import type {
  CorporationInvite,
  CorporationJoinRequest,
  RosterMember,
} from "@/lib/placeholder-data";

/**
 * Owns the one piece of state `RosterJoinRequests` and `RosterTable` both
 * need to share: the roster array itself. Approving a join request has
 * to actually land the person in the table below rather than just
 * disappearing from the requests list — that's the whole point of
 * showing the flow through, so `roster` lives here instead of inside
 * `RosterTable`, and both components receive it/callbacks as props.
 *
 * `RosterInvites` stays fully self-contained (its own internal state) —
 * an accepted invite still can't be simulated in this single-account
 * demo (no second account to land in the roster as), so there's nothing
 * for it to hand up. A join request is different: the requester's name
 * and email already exist in the mock data the moment the request was
 * submitted, so approval can honestly add a real-looking row.
 */
export function CouncilRoster({
  initialRoster,
  initialInvites,
  initialJoinRequests,
}: {
  initialRoster: RosterMember[];
  initialInvites: CorporationInvite[];
  initialJoinRequests: CorporationJoinRequest[];
}) {
  const [roster, setRoster] = useState(initialRoster);

  function handleApprove(request: CorporationJoinRequest) {
    setRoster((prev) => [
      ...prev,
      {
        id: `joined-${request.id}`,
        name: request.requesterName,
        // Joining connects them to the corporation — it doesn't assign a
        // council seat or officer portfolio. The admin assigns a role
        // afterward via the same role editor as everyone else, same as
        // a freshly accepted invite would need.
        roles: [],
        completions: {
          mal: false,
          president: false,
          "vice-president": false,
          treasurer: false,
          secretary: false,
        },
      },
    ]);
  }

  function handleRemove(id: string) {
    setRoster((prev) => prev.filter((m) => m.id !== id));
  }

  function handleSaveRoles(id: string, roles: string[]) {
    setRoster((prev) => prev.map((m) => (m.id === id ? { ...m, roles } : m)));
  }

  return (
    <>
      <RosterJoinRequests
        initialRequests={initialJoinRequests}
        onApprove={handleApprove}
      />
      <RosterInvites initialInvites={initialInvites} />
      <RosterTable
        roster={roster}
        onRemove={handleRemove}
        onSaveRoles={handleSaveRoles}
      />
    </>
  );
}
