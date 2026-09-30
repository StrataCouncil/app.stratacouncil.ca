"use client";

import { useState } from "react";
import { roleLabels, trackLabels, type RosterMember } from "@/lib/placeholder-data";

const trackSlugs = Object.keys(trackLabels);
const allRoles = Object.keys(roleLabels);

// Officer seats (a specific portfolio) vs. Member at Large (a council
// seat with no specific portfolio) are mutually exclusive by definition
// — you can't hold both at once. President and Vice President are
// additionally exclusive with *each other* specifically (not with the
// other officer seats — Treasurer/Secretary doubling up is a real,
// allowed pattern on a small council). `admin` and `manager` sit outside
// this entirely; they're orthogonal to the officer/MAL structure.
const officerRoles = ["president", "vice_president", "treasurer", "secretary"];

function conflictReason(role: string, draftRoles: string[]): string | null {
  if (role === "member_at_large" && draftRoles.some((r) => officerRoles.includes(r))) {
    return "Can't hold Member at Large and an officer role at the same time";
  }
  if (officerRoles.includes(role) && draftRoles.includes("member_at_large")) {
    return "Can't hold an officer role and Member at Large at the same time";
  }
  if (role === "president" && draftRoles.includes("vice_president")) {
    return "Can't be President and Vice President at the same time";
  }
  if (role === "vice_president" && draftRoles.includes("president")) {
    return "Can't be President and Vice President at the same time";
  }
  return null;
}

/**
 * Council & Roles, with the roles cell made editable — "the admin needs
 * to be able to determine each connected user's role." Role assignment
 * is itself just a role, reassignable by whoever holds `admin` (doc01
 * §4b's "Admin is itself just a role" note), and a member can hold more
 * than one row here (e.g. admin + president), so this is a multi-select
 * per member rather than a single dropdown — constrained by the
 * conflicts above rather than a free-for-all.
 *
 * Client-side only — there's no backend yet, so edits update this
 * component's own state and reset on reload, the same honesty as every
 * other mocked-up control in this app (the chat composer, the billing
 * CTAs). Real persistence needs `corporation_role_assignments` writes
 * once auth/data are wired in (doc01 §1) — the conflict rules above
 * belong there too, as a real constraint, not just UI-level disabling.
 *
 * "Remove" (council turnover — an outgoing member losing access, not
 * the invite/accept path, which is `RosterInvites`) asks for a typed
 * confirmation phrase rather than a plain Cancel/Confirm pair or a
 * browser `confirm()` dialog — removal isn't reversible from this screen
 * the way a role edit is, and a two-button confirm is still one
 * mis-click away from an accidental removal. Typing
 * `REMOVE_CONFIRM_PHRASE` (matched case-insensitively) before the button
 * enables is the same deliberate-friction pattern `RosterJoinRequests`
 * uses for Approve.
 *
 * `admin` is deliberately not exclusive (see `officerRoles` above) — a
 * corp can and often should have more than one admin, for continuity if
 * one becomes unreachable. That's a StrataCouncil.ca platform role, not
 * a Strata Property Act one, so there's no legislated admin-count
 * requirement either way; multiple admins is just good practice, and
 * this editor already supports it with no separate flow needed.
 *
 * `roster` is a controlled prop rather than internal state, because a
 * join request's Approve action (`RosterJoinRequests`, wired up one
 * level above in `CouncilRoster`) needs to land the new member in this
 * same table — the two pieces share one list rather than each keeping
 * its own copy that could drift apart.
 */
const REMOVE_CONFIRM_PHRASE = "remove council member";

export function RosterTable({
  roster,
  onRemove,
  onSaveRoles,
}: {
  roster: RosterMember[];
  onRemove: (id: string) => void;
  onSaveRoles: (id: string, roles: string[]) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftRoles, setDraftRoles] = useState<string[]>([]);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeConfirmText, setRemoveConfirmText] = useState("");

  function startEditing(member: RosterMember) {
    setRemovingId(null);
    setEditingId(member.id);
    setDraftRoles(member.roles);
  }

  function startRemoving(id: string) {
    setEditingId(null);
    setRemovingId(id);
    setRemoveConfirmText("");
  }

  function cancelRemoving() {
    setRemovingId(null);
    setRemoveConfirmText("");
  }

  function removeMember(id: string) {
    // Client-side only, same as every other edit here — real removal is
    // a `corporation_memberships.status = 'removed'` write (doc01 §3),
    // which keeps the row (and this person's history — e.g. "who was
    // treasurer when this decision was made") rather than deleting it;
    // this mock just drops it from the list since there's nowhere else
    // in the demo that reads removed-member history yet.
    onRemove(id);
    setRemovingId(null);
    setRemoveConfirmText("");
  }

  function toggleDraftRole(role: string) {
    setDraftRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]
    );
  }

  function saveRoles(id: string) {
    onSaveRoles(id, draftRoles);
    setEditingId(null);
  }

  return (
    <div className="roster-table-wrap">
    <table className="roster-table" data-testid="roster-matrix">
      <thead>
        <tr>
          <th>Member</th>
          <th>Roles</th>
          {trackSlugs.map((slug) => (
            <th key={slug} data-center="true">
              {trackLabels[slug]}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {roster.map((member) => (
          <tr key={member.id}>
            <td>
              {member.name}
              {member.company && (
                <div className="roster-table__meta">{member.company}</div>
              )}
            </td>
            <td className="roster-table__roles-cell">
              {member.roles.length === 0
                ? <span className="roster-table__na">&mdash;</span>
                : member.roles.map((role) => (
                    <span className="role-tag" key={role}>
                      {roleLabels[role] ?? role}
                    </span>
                  ))}

              <button
                className="roster-table__edit-roles"
                data-testid={`edit-roles-${member.id}`}
                onClick={() => startEditing(member)}
              >
                Edit
              </button>
              <button
                className="roster-table__edit-roles roster-table__remove-trigger"
                data-testid={`remove-member-${member.id}`}
                onClick={() => startRemoving(member.id)}
              >
                Remove
              </button>

              {removingId === member.id && (
                <div className="role-editor confirm-panel" data-testid={`remove-confirm-${member.id}`}>
                  <div className="role-editor__title">
                    Remove {member.name} from this strata?
                  </div>
                  <p className="card__meta" style={{ margin: "0 0 0.75rem" }}>
                    They&rsquo;ll lose access to this corporation&rsquo;s
                    Stratasphere&trade; &mdash; their training progress
                    stays on their own account. This can be undone by
                    inviting them again.
                  </p>
                  <label className="confirm-panel__label">
                    Type &ldquo;{REMOVE_CONFIRM_PHRASE}&rdquo; to confirm
                  </label>
                  <input
                    type="text"
                    className="confirm-panel__input"
                    value={removeConfirmText}
                    onChange={(e) => setRemoveConfirmText(e.target.value)}
                    placeholder={REMOVE_CONFIRM_PHRASE}
                    data-testid={`remove-confirm-input-${member.id}`}
                    autoComplete="off"
                  />
                  <div className="role-editor__actions">
                    <button
                      className="button button-secondary button-small"
                      onClick={cancelRemoving}
                    >
                      Cancel
                    </button>
                    <button
                      className="button button-primary button-small"
                      onClick={() => removeMember(member.id)}
                      disabled={
                        removeConfirmText.trim().toLowerCase() !==
                        REMOVE_CONFIRM_PHRASE
                      }
                      data-testid={`remove-confirm-button-${member.id}`}
                    >
                      Remove member
                    </button>
                  </div>
                </div>
              )}

              {editingId === member.id && (
                <div className="role-editor" data-testid={`role-editor-${member.id}`}>
                  <div className="role-editor__title">
                    Roles for {member.name.split(" ")[0]}
                  </div>
                  {allRoles.map((role) => {
                    const checked = draftRoles.includes(role);
                    const reason = checked ? null : conflictReason(role, draftRoles);
                    return (
                      <label
                        className="role-editor__option"
                        key={role}
                        data-disabled={!!reason}
                        title={reason ?? undefined}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!!reason}
                          onChange={() => toggleDraftRole(role)}
                        />
                        {roleLabels[role]}
                      </label>
                    );
                  })}
                  <div className="role-editor__actions">
                    <button
                      className="button button-secondary button-small"
                      onClick={() => setEditingId(null)}
                    >
                      Cancel
                    </button>
                    <button
                      className="button button-primary button-small"
                      onClick={() => saveRoles(member.id)}
                      data-testid={`save-roles-${member.id}`}
                    >
                      Save
                    </button>
                  </div>
                </div>
              )}
            </td>
            {trackSlugs.map((slug) =>
              // A strata manager is an external hire, not an owner —
              // Council Training tracks don't apply to them, so the dot
              // (which otherwise reads as "not completed") would be
              // misleading here rather than just empty.
              member.roles.length === 1 && member.roles[0] === "manager" ? (
                <td key={slug} data-center="true">
                  <span className="roster-table__na" aria-hidden="true">
                    &mdash;
                  </span>
                </td>
              ) : (
                <td key={slug} data-center="true">
                  <span
                    className="completion-dot"
                    data-done={member.completions[slug]}
                    aria-label={member.completions[slug] ? "Completed" : "Not completed"}
                  />
                </td>
              )
            )}
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  );
}
