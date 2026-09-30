"use client";

import { useRef, useState } from "react";
import { currentProfile } from "@/lib/placeholder-data";

const DELETE_CONFIRM_PHRASE = "DELETE";

function initials(fullName: string) {
  const parts = fullName.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

/**
 * The account settings that had nowhere to live: a profile photo, the
 * locked full name with its reason shown rather than just disabled,
 * email, phone, a 2FA status readout, and account deletion. Split from
 * the seed `currentProfile` object into local state per field, same
 * "real client-side state, no backend yet" honesty as pin/unpin or
 * moving a Stratasphere conversation between projects elsewhere in this
 * app — none of it persists past this session, and a fresh load resets
 * to the seed data.
 *
 * Two fields stay deliberately inert rather than pretending to save:
 * - **Full name** is disabled outright — doc01 §2's anti-sharing lock
 *   (`full_name_locked_at`), same rule the signup form already warns
 *   about. There's no unlock path in this design, so the field doesn't
 *   pretend one exists.
 * - **Email**'s Save is disabled with a tooltip, not the input itself —
 *   typing works, but a real email change needs a confirmation link
 *   sent to the new address before it takes effect (so a typo or a
 *   hijack attempt can't silently take over the account), and that's a
 *   real backend/email flow this mock can't honestly fulfill. Phone has
 *   no equivalent verification requirement, so its Save is real.
 *
 * Account deletion is now a single, immediate, self-serve action (doc03
 * Stage 9, revised) — not a request queued for manual review. Confirming
 * deletes the account outright:
 * - **Gone:** every Stratasphere&trade; conversation (doc01 §6 already
 *   hard-deletes these the moment a membership ends; full deletion is
 *   that same rule applied across every connected strata at once), the
 *   membership/roster row on every connected strata (the account
 *   disappears from each roster the same way `RosterTable`'s own Remove
 *   already does), and every training completion/certificate — there's
 *   no partial credit if they ever join a strata again later.
 * - **Untouched:** anything they authored into a strata's own record —
 *   uploaded documents, decisions, meeting minutes, governance actions.
 *   Those are immutable once created (the same principle that already
 *   keeps a removed council member's history intact) and stay attributed
 *   to them regardless of what happens to their sign-in.
 *
 * A user who's the sole admin on a connected strata isn't stopped by any
 * automated check here — that's rare enough, and requesting an
 * "aren't-you-the-only-admin" check gets its own data model, that it's
 * simpler to field by hand: support looks at the account when a deletion
 * comes in and helps them reassign the role first if needed. The copy
 * below just tells them to reach out first if that's their situation.
 *
 * The type-to-confirm panel reuses the same pattern as
 * `RosterJoinRequests`' Approve and `RosterTable`'s Remove flows — the
 * one other place in this app where a single click has consequences
 * heavy enough to warrant more friction than a plain Cancel/Confirm.
 * Once confirmed, the whole page gives way to a plain "account deleted"
 * state — there's no more account to manage after this, so there's
 * nothing to cancel or undo.
 */
export function AccountSettings() {
  const [avatarUrl, setAvatarUrl] = useState(currentProfile.avatarUrl);
  const [email, setEmail] = useState(currentProfile.email);
  const [phone, setPhone] = useState(currentProfile.phone ?? "");
  const [phoneSaved, setPhoneSaved] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarUrl(URL.createObjectURL(file));
  }

  function savePhone() {
    setPhoneSaved(true);
    setTimeout(() => setPhoneSaved(false), 2000);
  }

  function confirmDeletion() {
    setDeleted(true);
    setDeleting(false);
    setDeleteConfirmText("");
  }

  if (deleted) {
    return (
      <div className="account-settings" data-testid="account-settings">
        <div className="account-danger-panel" data-testid="account-deleted-panel">
          <strong>Your account has been deleted</strong>
          <p>
            Your Stratasphere&trade; conversations are gone, and you&rsquo;ve
            been removed from every connected strata&rsquo;s roster &mdash;
            your training completions and certificates went with it, so
            you&rsquo;d start training over if you ever joined a strata
            again. Anything you uploaded or recorded while connected
            (documents, decisions, meeting records) stays exactly as it was,
            still attributed to you.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="account-settings" data-testid="account-settings">
      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <h3>Photo</h3>
        <div className="account-settings__photo-row">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt="" className="account-settings__avatar" />
          ) : (
            <span className="account-settings__avatar account-settings__avatar--initials" aria-hidden="true">
              {initials(currentProfile.fullName)}
            </span>
          )}
          <div className="account-settings__photo-actions">
            <button
              type="button"
              className="button button-secondary button-small"
              onClick={() => fileInputRef.current?.click()}
              data-testid="upload-photo"
            >
              {avatarUrl ? "Change photo" : "Upload photo"}
            </button>
            {avatarUrl && (
              <button
                type="button"
                className="account-settings__remove-photo"
                onClick={() => setAvatarUrl(null)}
                data-testid="remove-photo"
              >
                Remove
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handlePhotoChange}
              style={{ display: "none" }}
              data-testid="photo-input"
            />
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <h3>Profile</h3>

        <div className="field">
          <label htmlFor="account-full-name">Full name</label>
          <input
            id="account-full-name"
            type="text"
            value={currentProfile.fullName}
            disabled
            data-testid="account-full-name"
          />
          <span className="field__hint">
            Locked after your first completed training module &mdash; this is
            what appears on your certificates, and can&rsquo;t be changed.
          </span>
        </div>

        <div className="field">
          <label htmlFor="account-email">Email</label>
          <div className="account-settings__field-row">
            <input
              id="account-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              data-testid="account-email"
            />
            <button
              type="button"
              className="button button-secondary button-small"
              disabled
              title="Not wired up yet — a real email change sends a confirmation link to the new address first"
              data-testid="save-email"
            >
              Save
            </button>
          </div>
          <span className="field__hint">
            We&rsquo;ll send a confirmation link to your new address before this
            takes effect &mdash; your sign-in email won&rsquo;t change until you
            click it.
          </span>
        </div>

        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="account-phone">Phone</label>
          <div className="account-settings__field-row">
            <input
              id="account-phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(604) 555-0100"
              autoComplete="tel"
              data-testid="account-phone"
            />
            <button
              type="button"
              className="button button-secondary button-small"
              onClick={savePhone}
              data-testid="save-phone"
            >
              {phoneSaved ? "Saved" : "Save"}
            </button>
          </div>
          <span className="field__hint">
            Optional &mdash; not collected at signup, so this is blank until you
            add it.
          </span>
        </div>
      </div>

      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <h3>Security</h3>
        <div className="account-settings__security-row">
          <div>
            <strong>Two-factor authentication</strong>
            <p className="card__meta" style={{ marginTop: "0.2rem" }}>
              {currentProfile.twoFactorEnabled
                ? "Enabled — required once you're connected to a strata (doc01 §2)."
                : "Not enabled yet. Required once you connect to a strata."}
            </p>
          </div>
          <span className={`pill${currentProfile.twoFactorEnabled ? "" : " pill--locked"}`}>
            {currentProfile.twoFactorEnabled ? "Enabled" : "Not enabled"}
          </span>
        </div>
        <button
          type="button"
          className="button button-secondary button-small"
          style={{ alignSelf: "flex-start", marginTop: "0.85rem" }}
          disabled
          title="Not wired up yet — UI preview only"
          data-testid="manage-2fa"
        >
          Manage
        </button>
      </div>

      <div className="card account-settings__danger-zone">
        <h3>Delete account</h3>
        <p>
          Deleting your account happens immediately, not as a reviewed
          request. Your Stratasphere&trade; conversations are erased, and
          you&rsquo;re removed from the roster of every strata you&rsquo;re
          connected to &mdash; your training completions and certificates
          go with it, so you&rsquo;d start over if you joined a strata
          again. Anything you&rsquo;ve uploaded or recorded on a strata
          (documents, decisions, meeting records) is immutable once
          created, so none of that is destroyed &mdash; it stays exactly as
          it is, still attributed to you.
        </p>
        <p className="field__hint">
          Sole admin on a connected strata? Reach out to us first &mdash;
          we&rsquo;ll help you reassign that role before you delete your
          account, since deleting it doesn&rsquo;t hand admin off to anyone
          automatically.
        </p>

        {!deleting ? (
          <button
            type="button"
            className="account-settings__delete-trigger"
            onClick={() => setDeleting(true)}
            data-testid="request-deletion"
          >
            Delete account
          </button>
        ) : (
          <div className="role-editor confirm-panel account-settings__delete-panel" data-testid="delete-confirm-panel">
            <label className="confirm-panel__label">
              Type &ldquo;{DELETE_CONFIRM_PHRASE}&rdquo; to confirm
            </label>
            <input
              type="text"
              className="confirm-panel__input"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder={DELETE_CONFIRM_PHRASE}
              autoComplete="off"
              data-testid="delete-confirm-input"
            />
            <div className="role-editor__actions">
              <button
                className="button button-secondary button-small"
                onClick={() => {
                  setDeleting(false);
                  setDeleteConfirmText("");
                }}
              >
                Cancel
              </button>
              <button
                className="button button-primary button-small"
                disabled={deleteConfirmText !== DELETE_CONFIRM_PHRASE}
                onClick={confirmDeletion}
                data-testid="delete-confirm-submit"
              >
                Delete account
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
