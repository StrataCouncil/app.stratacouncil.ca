/**
 * Plain, on-brand HTML for the transactional emails Supabase Auth
 * triggers (doc04 §7a). Deliberately simple — table-free, inline-styled,
 * readable with images/CSS stripped — since these are one-click
 * confirmation emails, not marketing. Matches the site's ink/paper/accent
 * tokens (doc05 §3) without pulling in the marketing site's CSS.
 */

const INK = "#1b2a41";
const MUTED = "#6b7280";
const ACCENT = "#b4602f";
const PAPER = "#f8f6f1";

function wrap(bodyHtml: string) {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:${PAPER};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;">
            <tr>
              <td style="padding-bottom:24px;">
                <span style="font-size:18px;font-weight:600;color:${INK};">StrataCouncil.ca</span>
              </td>
            </tr>
            <tr>
              <td style="background:#ffffff;border:1px solid #e3dfd5;border-radius:12px;padding:32px;">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding-top:20px;font-size:12px;color:${MUTED};">
                StrataCouncil.ca &middot; British Columbia, Canada
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function button(href: string, label: string) {
  return `<a href="${href}" style="display:inline-block;background:${ACCENT};color:#ffffff;text-decoration:none;font-weight:600;padding:12px 24px;border-radius:6px;margin:16px 0;">${label}</a>`;
}

/**
 * Covers both signup and sign-in — sendOtp() uses the same magiclink flow
 * for both (doc03 Stage 2), so Supabase's own email_action_type doesn't
 * distinguish a new account from a returning one either.
 */
export function magicLinkEmail(confirmUrl: string) {
  const html = wrap(`
    <p style="margin:0 0 16px;font-size:16px;color:${INK};">Click below to sign in to StrataCouncil.ca.</p>
    ${button(confirmUrl, "Sign in")}
    <p style="margin:16px 0 0;font-size:13px;color:${MUTED};">This link expires shortly and can only be used once. If you didn't request this, you can safely ignore this email.</p>
  `);
  const text = `Sign in to StrataCouncil.ca:\n\n${confirmUrl}\n\nThis link expires shortly and can only be used once. If you didn't request this, you can safely ignore this email.`;
  return { subject: "Sign in to StrataCouncil.ca", html, text };
}

/** Sent to the NEW address when a user changes their email (doc01 §2). */
export function emailChangeConfirmationEmail(confirmUrl: string) {
  const html = wrap(`
    <p style="margin:0 0 16px;font-size:16px;color:${INK};">Confirm your new email address for your StrataCouncil.ca account.</p>
    ${button(confirmUrl, "Confirm new email")}
    <p style="margin:16px 0 0;font-size:13px;color:${MUTED};">If you didn't request this change, contact support@stratacouncil.ca right away.</p>
  `);
  const text = `Confirm your new email address for your StrataCouncil.ca account:\n\n${confirmUrl}\n\nIf you didn't request this change, contact support@stratacouncil.ca right away.`;
  return { subject: "Confirm your new email address", html, text };
}

/** Fallback for any Supabase Auth email type not specifically templated above. */
export function genericAuthEmail(confirmUrl: string) {
  const html = wrap(`
    <p style="margin:0 0 16px;font-size:16px;color:${INK};">Click below to continue.</p>
    ${button(confirmUrl, "Continue")}
  `);
  const text = `Continue:\n\n${confirmUrl}`;
  return { subject: "StrataCouncil.ca", html, text };
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * `corporation_invites` (doc01 §1) — app-sent, not a Supabase Auth hook
 * email: the link comes from `auth.admin.generateLink()`, which signs the
 * invitee in (creating their account first if they're new) and lands them
 * on /invite/[id], which connects them. One email, one click, either way.
 */
export function corporationInviteEmail(params: {
  acceptUrl: string;
  corporationName: string;
  inviterName: string;
}) {
  const corporationName = escapeHtml(params.corporationName);
  const inviterName = escapeHtml(params.inviterName);
  const html = wrap(`
    <p style="margin:0 0 16px;font-size:16px;color:${INK};">${inviterName} invited you to join <strong>${corporationName}</strong> on StrataCouncil.ca.</p>
    <p style="margin:0 0 8px;font-size:14px;color:${INK};">Click below to accept. If you don&rsquo;t have an account yet, this creates one &mdash; there&rsquo;s nothing else to fill in.</p>
    ${button(params.acceptUrl, "Accept invitation")}
    <p style="margin:16px 0 0;font-size:13px;color:${MUTED};">This link can only be used once and expires after a while. If it has expired, sign in at app.stratacouncil.ca with this email address and the invitation will be waiting for you. If you weren&rsquo;t expecting this, you can ignore it.</p>
  `);
  const text = `${params.inviterName} invited you to join ${params.corporationName} on StrataCouncil.ca.\n\nAccept the invitation:\n\n${params.acceptUrl}\n\nIf you don't have an account yet, this creates one. The link can only be used once and expires after a while — if it has expired, sign in at app.stratacouncil.ca with this email address and the invitation will be waiting for you.`;
  return {
    subject: `You're invited to join ${params.corporationName} on StrataCouncil.ca`,
    html,
    text,
  };
}

/**
 * Corporation-creation review outcome (doc01 §1, doc03 Stage 4) — sent by
 * application code when a Super Admin resolves a request; "notified by
 * email to sign back in" on approval.
 */
export function creationRequestApprovedEmail(params: {
  corporationName: string;
  strataPlanNumber: string;
  openUrl: string;
}) {
  const name = escapeHtml(params.corporationName);
  const sp = escapeHtml(params.strataPlanNumber);
  const html = wrap(`
    <p style="margin:0 0 16px;font-size:16px;color:${INK};"><strong>${name}</strong> (${sp}) is now set up on StrataCouncil.ca, and you&rsquo;re its admin.</p>
    <p style="margin:0 0 8px;font-size:14px;color:${INK};">Sign in to invite your council, assign roles, and start uploading your strata&rsquo;s documents.</p>
    ${button(params.openUrl, "Open your strata")}
  `);
  const text = `${params.corporationName} (${params.strataPlanNumber}) is now set up on StrataCouncil.ca, and you're its admin.\n\nSign in to invite your council, assign roles, and start uploading your strata's documents:\n\n${params.openUrl}`;
  return { subject: `${params.strataPlanNumber} is set up on StrataCouncil.ca`, html, text };
}

export function creationRequestDeniedEmail(params: { strataPlanNumber: string }) {
  const sp = escapeHtml(params.strataPlanNumber);
  const html = wrap(`
    <p style="margin:0 0 16px;font-size:16px;color:${INK};">We weren&rsquo;t able to approve your request to add ${sp} to StrataCouncil.ca.</p>
    <p style="margin:0;font-size:14px;color:${INK};">If you think this is a mistake, or the strata is already on the platform under a different plan number, reply to support@stratacouncil.ca and we&rsquo;ll take another look.</p>
  `);
  const text = `We weren't able to approve your request to add ${params.strataPlanNumber} to StrataCouncil.ca.\n\nIf you think this is a mistake, or the strata is already on the platform under a different plan number, contact support@stratacouncil.ca and we'll take another look.`;
  return { subject: `Your request to add ${params.strataPlanNumber}`, html, text };
}

/** A join request approved by the corporation's admin (doc03 Stage 4). */
export function joinRequestApprovedEmail(params: { corporationName: string; openUrl: string }) {
  const name = escapeHtml(params.corporationName);
  const html = wrap(`
    <p style="margin:0 0 16px;font-size:16px;color:${INK};">Your request to join <strong>${name}</strong> on StrataCouncil.ca was approved.</p>
    ${button(params.openUrl, "Open your strata")}
  `);
  const text = `Your request to join ${params.corporationName} on StrataCouncil.ca was approved:\n\n${params.openUrl}`;
  return { subject: `You've joined ${params.corporationName} on StrataCouncil.ca`, html, text };
}
