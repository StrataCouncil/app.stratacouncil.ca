"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { updatePhone } from "@/app/account/actions";
import type { CurrentProfile } from "@/lib/data/profile";

function initials(fullName: string) {
  const parts = fullName.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

/**
 * Now takes the real signed-in `profile` as a prop instead of the
 * `currentProfile` mock. Two things changed in kind, not just source:
 *
 * - **Phone is now a real write** (`updatePhone`, app/account/actions.ts)
 *   to the signed-in user's own `profiles` row, not local-only state that
 *   reset on reload.
 * - **Full name, email, and 2FA status are real reads** — this is what
 *   fixes the "wackiness" of seeing a fake email/phone/2FA state that had
 *   nothing to do with the actual signed-in account.
 *
 * Three things stay deliberately inert rather than pretending to work,
 * same honesty principle as before, just now applied to a real account
 * instead of a demo one:
 * - **Full name** stays disabled — doc01 §2's anti-sharing lock.
 * - **Email's Save** stays disabled — a real email change needs
 *   Supabase's secure-email-change confirmation flow (doc01 §7 item 26),
 *   which isn't built yet.
 * - **Delete account** stays disabled — real deletion has to cascade
 *   across every connected strata's roster and StrataSphere conversation
 *   history (doc03 Stage 9); faking that on a real account would be
 *   actively misleading, not just an honest placeholder, so this no
 *   longer simulates a fake "deleted" state the way the mock did.
 */
export function AccountSettings({ profile }: { profile: CurrentProfile }) {
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [phone, setPhone] = useState(profile.phone ?? "");
  const [phoneSaved, setPhoneSaved] = useState(false);
  const [savingPhone, setSavingPhone] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const displayName = profile.fullName.trim() || profile.email;

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarUrl(URL.createObjectURL(file));
  }

  async function savePhone() {
    setSavingPhone(true);
    setPhoneError(null);
    try {
      const fd = new FormData();
      fd.set("phone", phone);
      await updatePhone(fd);
      setPhoneSaved(true);
      setTimeout(() => setPhoneSaved(false), 2000);
    } catch (err) {
      setPhoneError(err instanceof Error ? err.message : "Couldn't save phone.");
    } finally {
      setSavingPhone(false);
    }
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
              {initials(displayName)}
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
        <span className="field__hint">
          Preview only &mdash; there&rsquo;s no photo storage wired up yet,
          so this doesn&rsquo;t persist past this session.
        </span>
      </div>

      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <h3>Profile</h3>

        <div className="field">
          <label htmlFor="account-full-name">Full name</label>
          <input
            id="account-full-name"
            type="text"
            value={profile.fullName}
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
              value={profile.email}
              disabled
              data-testid="account-email"
            />
            <button
              type="button"
              className="button button-secondary button-small"
              disabled
              title="Not wired up yet — a real email change needs Supabase's secure-email-change confirmation flow"
              data-testid="save-email"
            >
              Save
            </button>
          </div>
          <span className="field__hint">
            This is your real sign-in email. Changing it isn&rsquo;t wired up
            yet.
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
              disabled={savingPhone}
              data-testid="save-phone"
            >
              {phoneSaved ? "Saved" : savingPhone ? "Saving…" : "Save"}
            </button>
          </div>
          {phoneError && (
            <span className="field__hint" style={{ color: "var(--danger, #b42318)" }}>
              {phoneError}
            </span>
          )}
          <span className="field__hint">
            Optional &mdash; saved to your account.
          </span>
        </div>
      </div>

      <div className="card" style={{ marginBottom: "1.5rem" }}>
        <h3>Security</h3>
        <div className="account-settings__security-row">
          <div>
            <strong>Two-factor authentication</strong>
            <p className="card__meta" style={{ marginTop: "0.2rem" }}>
              {profile.twoFactorEnabled
                ? "Enabled — verified TOTP factor on file."
                : "Not enabled yet. Enforcement is currently off platform-wide (doc01 §7 item 28), but you can still enroll."}
            </p>
          </div>
          <span className={`pill${profile.twoFactorEnabled ? "" : " pill--locked"}`}>
            {profile.twoFactorEnabled ? "Enabled" : "Not enabled"}
          </span>
        </div>
        <Link
          href="/auth/mfa/enroll"
          className="button button-secondary button-small"
          style={{ alignSelf: "flex-start", marginTop: "0.85rem" }}
          data-testid="manage-2fa"
        >
          {profile.twoFactorEnabled ? "Manage" : "Set up 2FA"}
        </Link>
      </div>

      <div className="card account-settings__danger-zone">
        <h3>Delete account</h3>
        <p>
          Deleting your account will erase your Stratasphere&trade;
          conversations and remove you from the roster of every strata
          you&rsquo;re connected to &mdash; your training completions and
          certificates go with it. Anything you&rsquo;ve uploaded or recorded
          on a strata (documents, decisions, meeting records) is immutable
          once created, so none of that is destroyed.
        </p>
        <p className="field__hint">
          Not wired up yet &mdash; real deletion has to cascade across every
          connected strata&rsquo;s roster and isn&rsquo;t built. Contact us
          directly if you need your account removed in the meantime.
        </p>
        <button
          type="button"
          className="account-settings__delete-trigger"
          disabled
          title="Not wired up yet"
          data-testid="request-deletion"
        >
          Delete account
        </button>
      </div>
    </div>
  );
}
