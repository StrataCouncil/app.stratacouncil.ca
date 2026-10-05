"use client";

import { useState, useTransition } from "react";
import {
  removeMember,
  saveMemberRoles,
  setMeetingPermission,
  setMemberLot,
} from "@/app/strata/[corpId]/roster-actions";
import type { RosterMember } from "@/lib/data/roster";
import { trainingTrackColumns as tracks } from "@/lib/training/tracks";
import { Modal } from "@/components/Modal";
import {
  corporationRoleLabels,
  corporationRoles,
  councilRoles,
  isSingleHolderRole,
  MAX_ADMINS,
  executiveRoles,
  withoutConflictingRoles,
  type CorporationRole,
} from "@/lib/strata";
import { MemberAvatar } from "@/components/MemberAvatar";

const REMOVE_CONFIRM_PHRASE = "remove council member";


/**
 * Council & Roles roster, read from `corporation_memberships` +
 * `corporation_role_assignments` (lib/data/roster.ts). Everyone connected
 * sees it; only the admin gets the controls.
 *
 * Roles (doc01 §4): admin, president, vice president, treasurer,
 * secretary — one holder each — and member at large and manager, which
 * can have several. Council members are tied to their strata lot (the
 * admin picks it here); that's what makes a lot a council lot for
 * council-meeting attendance and quorum.
 * Assigning a one-holder role that someone else holds moves it, which is
 * how a seat changes hands; the editor says so before saving. Admin works
 * the same way: there's always exactly one, it's handed over by assigning
 * it to someone else, and the current holder can't drop it or be removed
 * until they have. In BC, president and vice president must be different
 * people (Standard Bylaw 13(2)); the editor enforces that up front and
 * the database trigger (0002) is the backstop.
 *
 * Running meetings — creating and editing agendas, launching Meeting
 * Mode, recording votes, finalizing minutes — is the secretary's job, so
 * the secretary and the admin hold it through their roles. One switch,
 * set by the admin, extends it to anyone else (small councils); for the
 * role holders it reads on and is locked.
 *
 * "Remove" (council turnover) asks for a typed confirmation phrase —
 * removal keeps the membership row as 'removed' for history, but the
 * person loses access immediately, and the only way back is a new invite.
 */
export function RosterTable({
  corporationId,
  members,
  lots,
  isAdmin,
  currentUserId,
  jurisdiction,
}: {
  corporationId: string;
  members: RosterMember[];
  lots: string[];
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
    // Taking an executive office ends Member at Large.
    setDraftRoles((prev) => withoutConflictingRoles(prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));
  }

  function conflictReason(member: RosterMember, role: CorporationRole): string | null {
    if (role === "admin") {
      const admins = members.filter((m) => m.roles.includes("admin"));
      if (member.roles.includes("admin") && admins.length === 1) {
        return "A strata always needs an admin. Make another member Admin first.";
      }
      if (!member.roles.includes("admin") && admins.length >= MAX_ADMINS) {
        return `This strata already has ${MAX_ADMINS} admins. Take Admin off one of them first.`;
      }
    }
    if (role === "member_at_large" && draftRoles.some((r) => executiveRoles.includes(r))) {
      return "An executive isn't a Member at Large. Remove the executive role first.";
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

  function togglePermission(member: RosterMember, value: boolean) {
    startTransition(async () => {
      const result = await setMeetingPermission(corporationId, member.userId, value);
      setError(member.userId, result.ok ? null : result.error);
    });
  }

  function changeLot(member: RosterMember, lot: string) {
    startTransition(async () => {
      const result = await setMemberLot(corporationId, member.userId, lot || null);
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
            <th>Strata lot</th>
            <th>Roles</th>
            <th data-center="true">Runs meetings</th>
            {tracks.map((t) => (
              <th key={t.code} data-center="true" className="roster-table__training-head">
                <abbr title={`${t.title} training`}>{t.abbr}</abbr>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {members.map((member) => {
            const active = member.status === "active";
            const isAdminHolder = member.roles.includes("admin");

            return (
              <tr key={member.userId} data-testid={`roster-row-${member.userId}`}>
                <td>
                  <div className="roster-member">
                    <MemberAvatar name={member.fullName} url={member.avatarUrl} />
                    <div>
                      {member.fullName}
                      {member.userId === currentUserId && (
                        <span className="roster-table__meta"> (you)</span>
                      )}
                      <div className="roster-table__meta">{member.email}</div>
                      {!active && <span className="pill pill--locked">Invited</span>}
                    </div>
                  </div>
                </td>
                <td>
                  {isAdmin && active ? (
                    <select
                      className="roster-table__lot"
                      value={member.lotNumber ?? ""}
                      onChange={(e) => changeLot(member, e.target.value)}
                      disabled={pending}
                      aria-label={`${member.fullName}: strata lot`}
                      data-testid={`member-lot-${member.userId}`}
                    >
                      <option value="">—</option>
                      {lots.map((l) => (
                        <option key={l} value={l}>
                          {l}
                        </option>
                      ))}
                    </select>
                  ) : (
                    member.lotNumber ?? <span className="roster-table__na">&mdash;</span>
                  )}
                  {!member.lotNumber && member.roles.some((r) => councilRoles.includes(r)) && (
                    <div className="roster-table__warn">Council members need a strata lot</div>
                  )}
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
                    <div className="roster-table__row-actions">
                      <button
                        type="button"
                        className="roster-table__edit-roles"
                        data-testid={`edit-roles-${member.userId}`}
                        onClick={() => startEditing(member)}
                      >
                        Edit roles
                      </button>
                      {!isAdminHolder && (
                        <button
                          type="button"
                          className="roster-table__edit-roles roster-table__remove-trigger"
                          data-testid={`remove-member-${member.userId}`}
                          onClick={() => startRemoving(member.userId)}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  )}

                  {errors[member.userId] && (
                    <p className="roster-invites__error" data-testid={`roster-error-${member.userId}`}>
                      {errors[member.userId]}
                    </p>
                  )}

                  {removingId === member.userId && (
                    <Modal
                      title={`Remove ${member.fullName} from this strata?`}
                      onClose={() => setRemovingId(null)}
                      testId={`remove-confirm-${member.userId}`}
                    >
                      <p>
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
                    </Modal>
                  )}

                  {editingId === member.userId && (
                    <Modal
                      title={`Roles for ${member.fullName}`}
                      onClose={() => setEditingId(null)}
                      testId={`role-editor-${member.userId}`}
                    >
                      <div className="role-editor role-editor--modal">
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
                            {role === "admin" && reason && (
                              <span className="role-editor__holder">
                                {member.roles.includes("admin") ? "the only admin" : `already ${MAX_ADMINS} admins`}
                              </span>
                            )}
                            {holder && holder.userId !== member.userId && (
                              <span className="role-editor__holder">
                                {movesFrom ? `moves from ${holder.fullName}` : `held by ${holder.fullName}`}
                              </span>
                            )}
                          </label>
                        );
                      })}
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
                          {pending ? "Saving…" : "Save roles"}
                        </button>
                      </div>
                      </div>
                    </Modal>
                  )}
                </td>
                {(() => {
                  // Admin and secretary run meetings through the role itself,
                  // so their switch reads on and can't be turned off here.
                  const via = isAdminHolder ? "Admin" : member.roles.includes("secretary") ? "Secretary" : null;
                  const value = via !== null || member.canRunMeetings;
                  return (
                    <td data-center="true">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={value}
                        aria-label={`${member.fullName}: can run meetings`}
                        title={via ? `Included with the ${via} role` : undefined}
                        className="permission-switch"
                        disabled={!isAdmin || !active || via !== null || pending}
                        onClick={() => togglePermission(member, !value)}
                        data-testid={`can_run_meetings-${member.userId}`}
                      >
                        <span className="permission-switch__thumb" aria-hidden="true" />
                      </button>
                      {via && <div className="roster-table__meta">via {via}</div>}
                    </td>
                  );
                })()}
                {tracks.map((t) => {
                  const earned = member.credentials.includes(t.code);
                  return (
                    <td key={t.code} data-center="true">
                      <span
                        className="training-dot"
                        data-earned={earned}
                        role="img"
                        aria-label={`${t.title} credential: ${earned ? "earned" : "not earned"}`}
                        title={`${t.title}: ${earned ? "earned" : "not earned yet"}`}
                      />
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="roster-table__legend">
        Training credentials:{" "}
        {tracks.map((t, i) => (
          <span key={t.code}>
            {i > 0 && " · "}
            <strong>{t.abbr}</strong> {t.title}
          </span>
        ))}
        . A filled circle means the credential is earned.
      </p>
    </div>
  );
}
