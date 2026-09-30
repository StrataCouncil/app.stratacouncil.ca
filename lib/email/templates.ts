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
