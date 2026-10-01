"use client";

import { useState, useTransition } from "react";
import {
  removeMember,
  saveMemberRoles,
  setMeetingPermission,
} from "@/app/strata/[corpId]/roster-actions";
import type { RosterMember } from "@/lib/data/roster";
import {
  corporationRoleLabels,
  corporationRoles,
  isSingleHolderRole,
  type CorporationRole,
} from "@/lib/strata";

const REMOVE_CONFIRM_PHRASE = "remove council member";

/**
 * Council & Roles roster, read from `corporation_memberships` +
 * `corporation_role_assignments` (lib/data/roster.ts). Everyone connected
 * sees it; only the admin gets the controls.
 *
 * Roles (doc01 §4): admin, president, vice president, treasurer,
 * secretary — one holder each — and manager, which can have several.
 * Assigning a one-holder role that someone else holds moves it, which is
 * how a seat changes hands; the editor says so before saving. Admin works
 * the same way: there's always exactly one, it's handed over by assigning
 * it to someone else, and the current holder can't drop it or be removed
 * until they have. In BC, president and vice president must be different
 * people (Standard Bylaw 13(2)); the editor enforces that up front and
 * the database trigger (0002) is the backstop.
 *
 * Meeting permissions are two independent per-member switches
 * (`can_create_meetings`, `can_chair_meetings`), set by the admin. The
 * admin holds both implicitly through the role (doc01 §4), so theirs read
 * on and are locked.
 *
 * "Remove" (council turnover) asks for a typed confirmation phrase —
 * removal keeps the membership row as 'removed' for history, but the
 * person loses access immediately, and the only way back is a new invite.
 */
export function RosterTable({
  corporationId,
  members,
  isAdmin,
  currentUserId,
  jurisdiction,
}: {
  corporationId: string;
  members: RosterMember[];
  isAdmin: boolean;
  currentUserId: string;
  jurisdiction: string;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftRoles, setDraftRoles] = useState<CorporationRole[]>([]);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeConfirmText, setRemoveConfirmText] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const holderOf = (role: CorporationRole) =>
    members.find((m) => m.roles.includes(role) && m.status === "active");

  function setError(userId: string, message: string | null) {
    setErrors((prev) => {
      const next = { ...prev };
      if (message) next[userId] = message;
      else delete next[userId];
      return next;
    });
  }

  function startEditing(member: RosterMember) {
    setRemovingId(null);
    setEditingId(member.userId);
    setDraftRoles(member.roles);
    setError(member.userId, null);
  }

  function startRemoving(userId: string) {
    setEditingId(null);
    setRemovingId(userId);
    setRemoveConfirmText("");
    setError(userId, null);
  }

  function toggleDraftRole(role: CorporationRole) {
    setDraftRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]
    );
  }

  function conflictReason(member: RosterMember, role: CorporationRole): string | null {
    if (role === "admin" && member.roles.includes("admin")) {
      return "There's always one admin. Hand it over by assigning Admin to another member.";
    }
    if (jurisdiction === "BC") {
      if (role === "president" && draftRoles.includes("vice_president")) {
        return "In BC, the President and Vice President must be different people.";
      }
      if (role === "vice_president" && draftRoles.includes("president")) {
        return "In BC, the President and Vice President must be different people.";
      }
    }
    return null;
  }

  function save(member: RosterMember) {
    startTransition(async () => {
      const result = await saveMemberRoles(corporationId, member.userId, draftRoles);
      if (result.ok) {
        setEditingId(null);
        setError(member.userId, null);
      } else {
        setError(member.userId, result.error);
      }
    });
  }

  function togglePermission(
    member: RosterMember,
    permission: "can_create_meetings" | "can_chair_meetings",
    value: boolean
  ) {
    startTransition(async () => {
      const result = await setMeetingPermission(corporationId, member.userId, permission, value);
      setError(member.userId, result.ok ? null : result.error);
    });
  }

  function remove(member: RosterMember) {
    startTransition(async () => {
      const result = await removeMember(corporationId, member.userId);
      if (result.ok) {
        setRemovingId(null);
        setRemoveConfirmText("");
      } else {
        setError(member.userId, result.error);
      }
    });
  }

  return (
    <div className="roster-table-wrap">
      <table className="roster-table" data-testid="roster-matrix">
        <thead>
          <tr>
            <th>Member</th>
            <th>Roles</th>
            <th data-center="true">Can create meetings</th>
            <th data-center="true">Can chair meetings</th>
          </tr>
        </thead>
        <tbody>
          {members.map((member) => {
            const active = member.status === "active";
            const isAdminHolder = member.roles.includes("admin");
            const draftTakesAdminFromMe =
              editingId === member.userId &&
              member.userId !== currentUserId &&
              draftRoles.includes("admin") &&
              !member.roles.includes("admin");

            return (
              <tr key={member.userId} data-testid={`roster-row-${member.userId}`}>
                <td>
                  {member.fullName}
                  {member.userId === currentUserId && (
                    <span className="roster-table__meta"> (you)</span>
                  )}
                  <div className="roster-table__meta">{member.email}</div>
                  {!active && <span className="pill pill--locked">Invited</span>}
                </td>
                <td className="roster-table__roles-cell">
                  {member.roles.length === 0 ? (
                    <span className="roster-table__na">&mdash;</span>
                  ) : (
                    member.roles.map((role) => (
                      <span className="role-tag" key={role}>
                        {corporationRoleLabels[role]}
                      </span>
                    ))
                  )}

                  {isAdmin && active && (
                    <>
                      <button
                        className="roster-table__edit-roles"
                        data-testid={`edit-roles-${member.userId}`}
                        onClick={() => startEditing(member)}
                      >
                        Edit
                      </button>
                      {!isAdminHolder && (
                        <button
                          className="roster-table__edit-roles roster-table__remove-trigger"
                          data-testid={`remove-member-${member.userId}`}
                          onClick={() => startRemoving(member.userId)}
                        >
                          Remove
                        </button>
                      )}
                    </>
                  )}

                  {errors[member.userId] && (
                    <p className="roster-invites__error" data-testid={`roster-error-${member.userId}`}>
                      {errors[member.userId]}
                    </p>
                  )}

                  {removingId === member.userId && (
                    <div className="role-editor confirm-panel" data-testid={`remove-confirm-${member.userId}`}>
                      <div className="role-editor__title">Remove {member.fullName} from this strata?</div>
                      <p className="card__meta" style={{ margin: "0 0 0.75rem" }}>
                        They&rsquo;ll lose access to this corporation&rsquo;s
                        Stratasphere&trade; and any roles they hold &mdash;
                        their training progress stays on their own account.
                        This can be undone by inviting them again.
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
                        data-testid={`remove-confirm-input-${member.userId}`}
                        autoComplete="off"
                      />
                      <div className="role-editor__actions">
                        <button
                          className="button button-secondary button-small"
                          onClick={() => setRemovingId(null)}
                          disabled={pending}
                        >
                          Cancel
                        </button>
                        <button
                          className="button button-danger button-small"
                          onClick={() => remove(member)}
                          disabled={
                            pending ||
                            removeConfirmText.trim().toLowerCase() !== REMOVE_CONFIRM_PHRASE
                          }
                          data-testid={`remove-confirm-button-${member.userId}`}
                        >
                          Remove member
                        </button>
                      </div>
                    </div>
                  )}

                  {editingId === member.userId && (
                    <div className="role-editor" data-testid={`role-editor-${member.userId}`}>
                      <div className="role-editor__title">Roles for {member.fullName}</div>
                      {corporationRoles.map((role) => {
                        const checked = draftRoles.includes(role);
                        const reason = conflictReason(member, role);
                        const disabled = Boolean(reason) && (role === "admin" || !checked);
                        const holder = isSingleHolderRole(role) ? holderOf(role) : undefined;
                        const movesFrom =
                          checked && holder && holder.userId !== member.userId ? holder : undefined;
                        return (
                          <label
                            className="role-editor__option"
                            key={role}
                            data-disabled={disabled}
                            title={reason ?? undefined}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={disabled}
                              onChange={() => toggleDraftRole(role)}
                            />
                            {corporationRoleLabels[role]}
                            {holder && holder.userId !== member.userId && (
                              <span className="role-editor__holder">
                                {movesFrom ? `moves from ${holder.fullName}` : `held by ${holder.fullName}`}
                              </span>
                            )}
                          </label>
                        );
                      })}
                      {draftTakesAdminFromMe && (
                        <p className="roster-join-requests__warning" style={{ margin: "0.5rem 0" }}>
                          <strong>You&rsquo;ll no longer be admin.</strong> Admin
                          moves to {member.fullName}, and only they can change
                          roles, invites and billing afterward.
                        </p>
                      )}
                      <div className="role-editor__actions">
                        <button
                          className="button button-secondary button-small"
                          onClick={() => setEditingId(null)}
                          disabled={pending}
                        >
                          Cancel
                        </button>
                        <button
                          className="button button-primary button-small"
                          onClick={() => save(member)}
                          disabled={pending}
                          data-testid={`save-roles-${member.userId}`}
                        >
                          {pending ? "Saving…" : "Save"}
                        </button>
                      </div>
                    </div>
                  )}
                </td>
                {(["can_create_meetings", "can_chair_meetings"] as const).map((permission) => {
                  const label =
                    permission === "can_create_meetings" ? "can create meetings" : "can chair meetings";
                  // The admin holds both implicitly through the role itself
                  // (doc01 §4: `role = 'admin' OR can_…`), so their switch
                  // reads on and can't be turned off from here.
                  const implicit = isAdminHolder;
                  const value =
                    implicit ||
                    (permission === "can_create_meetings"
                      ? member.canCreateMeetings
                      : member.canChairMeetings);
                  return (
                    <td key={permission} data-center="true">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={value}
                        aria-label={`${member.fullName}: ${label}`}
                        title={implicit ? "Included with the Admin role" : undefined}
                        className="permission-switch"
                        disabled={!isAdmin || !active || implicit || pending}
                        onClick={() => togglePermission(member, permission, !value)}
                        data-testid={`${permission}-${member.userId}`}
                      >
                        <span className="permission-switch__thumb" aria-hidden="true" />
                      </button>
                      {implicit && <div className="roster-table__meta">via Admin</div>}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
