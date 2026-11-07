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

// Logos as PNGs served from the app (public/email/), since email clients
// don't render inline SVG. Rendered at 3x from components/Logo.tsx (with the
// header's wordmark) and components/TrickfilmLogo.tsx. Alt text stands in
// when a client blocks images.
const ASSET_BASE = "https://app.stratacouncil.ca/email";
// Mail apps cache images by address, so a changed image gets a new file
// name: an old copy shown at the new size comes out stretched.

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
                <img src="${ASSET_BASE}/stratacouncil-logo-2026.png" width="211" height="32" alt="StrataCouncil.ca" style="display:block;border:0;font-size:18px;font-weight:600;color:${INK};" />
              </td>
            </tr>
            <tr>
              <td style="background:#ffffff;border:1px solid #e3dfd5;border-radius:12px;padding:32px;">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding-top:20px;font-size:12px;color:${MUTED};">
                StrataCouncil.ca &middot; British Columbia, Canada<br />
                <span style="display:inline-block;margin-top:6px;">A product of
                  <img src="${ASSET_BASE}/trickfilm.png" width="73" height="20" alt="Trickfilm Entertainment Inc." style="display:inline-block;vertical-align:middle;border:0;margin-left:4px;" /></span>
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
    <p style="margin:0 0 16px;font-size:14px;color:${MUTED};">StrataCouncil.ca is where your strata council keeps its records and runs its meetings, with free council training. Stratasphere&trade;, its AI assistant, answers questions from your strata&rsquo;s own bylaws, minutes and BC strata law.</p>
    <p style="margin:0 0 8px;font-size:14px;color:${INK};">Click below to accept. If you don&rsquo;t have an account yet, this creates one &mdash; there&rsquo;s nothing else to fill in.</p>
    ${button(params.acceptUrl, "Accept invitation")}
    <p style="margin:16px 0 0;font-size:13px;color:${MUTED};">The invitation expires in 7 days, and this link can only be used once. If the link has expired but the invitation hasn&rsquo;t, sign in at app.stratacouncil.ca with this email address and it will be waiting for you. If you weren&rsquo;t expecting this, you can ignore it.</p>
  `);
  const text = `${params.inviterName} invited you to join ${params.corporationName} on StrataCouncil.ca.\n\nStrataCouncil.ca is where your strata council keeps its records and runs its meetings, with free council training. Stratasphere, its AI assistant, answers questions from your strata's own bylaws, minutes and BC strata law.\n\nAccept the invitation:\n\n${params.acceptUrl}\n\nIf you don't have an account yet, this creates one. The invitation expires in 7 days, and the link can only be used once. If the link has expired but the invitation hasn't, sign in at app.stratacouncil.ca with this email address and it will be waiting for you.`;
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

/**
 * To a corporation's admins when someone accepts an invitation. The new
 * member has no roles until an admin assigns them, so an invite sent to the
 * wrong address is caught here and can be removed before it matters.
 */
export function inviteAcceptedEmail(params: {
  corporationName: string;
  memberName: string;
  memberEmail: string;
  openUrl: string;
}) {
  const name = escapeHtml(params.corporationName);
  const who = escapeHtml(params.memberName ? `${params.memberName} (${params.memberEmail})` : params.memberEmail);
  const html = wrap(`
    <p style="margin:0 0 16px;font-size:16px;color:${INK};">${who} accepted your invitation and joined <strong>${name}</strong> on StrataCouncil.ca.</p>
    <p style="margin:0 0 8px;font-size:14px;color:${INK};">They have no roles yet. Assign them on the Council page. If this isn&rsquo;t who you meant to invite, remove them there.</p>
    ${button(params.openUrl, "Open Council")}
  `);
  const whoText = params.memberName ? `${params.memberName} (${params.memberEmail})` : params.memberEmail;
  const text = `${whoText} accepted your invitation and joined ${params.corporationName} on StrataCouncil.ca.\n\nThey have no roles yet. Assign them on the Council page. If this isn't who you meant to invite, remove them there:\n\n${params.openUrl}`;
  return { subject: `${whoText} joined ${params.corporationName}`, html, text };
}

/**
 * A copy of a paid Stratasphere invoice for each billing contact after the
 * first (Stripe emails the receipt to the first one itself).
 */
export function invoiceCopyEmail(params: {
  corporationName: string;
  amount: string;
  invoiceUrl: string;
  invoiceNumber: string | null;
}) {
  const name = escapeHtml(params.corporationName);
  const html = wrap(`
    <p style="margin:0 0 16px;font-size:16px;color:${INK};">A Stratasphere&trade; payment of <strong>${escapeHtml(params.amount)}</strong> for <strong>${name}</strong> went through.</p>
    <p style="margin:0 0 8px;font-size:14px;color:${INK};">You're receiving this copy because you're listed as a billing contact.${params.invoiceNumber ? ` Invoice ${escapeHtml(params.invoiceNumber)}.` : ""}</p>
    ${button(params.invoiceUrl, "View invoice and receipt")}
  `);
  const text = `A Stratasphere payment of ${params.amount} for ${params.corporationName} went through.${params.invoiceNumber ? ` Invoice ${params.invoiceNumber}.` : ""}\n\nYou're receiving this copy because you're listed as a billing contact. View the invoice and receipt:\n\n${params.invoiceUrl}`;
  return { subject: `Stratasphere payment received: ${params.corporationName}`, html, text };
}

/**
 * A member asks the strata's admin(s) to subscribe to Stratasphere (sent on
 * their behalf from the subscription prompt).
 */
export function subscriptionRequestEmail(params: {
  corporationName: string;
  requesterName: string;
  requesterEmail: string;
  billingUrl: string;
}) {
  const name = escapeHtml(params.corporationName);
  const who = escapeHtml(params.requesterName ? `${params.requesterName} (${params.requesterEmail})` : params.requesterEmail);
  const html = wrap(`
    <p style="margin:0 0 16px;font-size:16px;color:${INK};">${who} would like <strong>${name}</strong> to subscribe to Stratasphere&trade;.</p>
    <p style="margin:0 0 8px;font-size:14px;color:${INK};">A subscription unlocks the Stratasphere&trade; AI assistant, which answers questions from your strata&rsquo;s own records and BC strata law, plus Meeting Mode for every meeting after your free one. As this strata&rsquo;s admin, you can see the plans and subscribe from Billing.</p>
    ${button(params.billingUrl, "See plans")}
  `);
  const whoText = params.requesterName ? `${params.requesterName} (${params.requesterEmail})` : params.requesterEmail;
  const text = `${whoText} would like ${params.corporationName} to subscribe to Stratasphere.\n\nA subscription unlocks the Stratasphere AI assistant, which answers questions from your strata's own records and BC strata law, plus Meeting Mode for every meeting after your free one. As this strata's admin, you can see the plans and subscribe from Billing:\n\n${params.billingUrl}`;
  return { subject: `${whoText} asked about a Stratasphere subscription for ${params.corporationName}`, html, text };
}

/**
 * A personal demo link (lib/demo.ts), sent from the live site's Super
 * Admin console. The link signs the person in to their own copy of the
 * fictional strata, so it shouldn't be forwarded.
 */
export function demoInviteEmail(params: { fullName: string; link: string; landing: "strata" | "training"; dayLabel: string }) {
  const first = params.fullName.trim().split(/\s+/)[0] || "there";
  const day = escapeHtml(params.dayLabel);
  const training = params.landing === "training";
  const intro = training
    ? "Here&rsquo;s your personal link to Council Training on StrataCouncil.ca: short, practical modules on what makes an effective strata council member. You can also look around your own fictional strata, as its admin, with its council, documents, meetings and the Stratasphere&trade; AI assistant."
    : "Here&rsquo;s your personal link to the StrataCouncil.ca demo. You&rsquo;ll be the admin of your own fictional strata, with its council, documents, meetings, minutes and the Stratasphere&trade; AI assistant, to try however you like.";
  const introText = training
    ? "Here's your personal link to Council Training on StrataCouncil.ca: short, practical modules on what makes an effective strata council member. You can also look around your own fictional strata, as its admin, with its council, documents, meetings and the Stratasphere AI assistant"
    : "Here's your personal link to the StrataCouncil.ca demo. You'll be the admin of your own fictional strata, with its council, documents, meetings, minutes and the Stratasphere AI assistant, to try however you like";
  const html = wrap(`
    <p style="margin:0 0 16px;font-size:16px;color:${INK};">Hi ${escapeHtml(first)},</p>
    <p style="margin:0 0 16px;font-size:16px;color:${INK};">${intro}</p>
    ${button(params.link, training ? "Open Council Training" : "Open the demo")}
    <p style="margin:16px 0 0;font-size:13px;color:${MUTED};">The link works until midnight (Pacific time) on ${day}, and everything in the demo is cleared then. It signs you in, so please don&rsquo;t forward it. Questions? Email support@stratacouncil.ca.</p>
  `);
  const text = `Hi ${first},\n\n${introText}:\n\n${params.link}\n\nThe link works until midnight (Pacific time) on ${params.dayLabel}, and everything in the demo is cleared then. It signs you in, so please don't forward it. Questions? Email support@stratacouncil.ca.`;
  return { subject: training ? "Your StrataCouncil.ca Council Training link" : "Your StrataCouncil.ca demo", html, text };
}

/**
 * A new demo request from stratacouncil.ca (0067), to platform staff. The
 * button opens the console's Demo tab, where one click sends the link.
 * Sent from the no-reply address, so it doesn't invite a reply.
 */
export function demoRequestNoticeEmail(params: { name: string; email: string; where: string; campaign: string; consoleUrl: string }) {
  const html = wrap(`
    <p style="margin:0 0 16px;font-size:16px;color:${INK};"><strong>${escapeHtml(params.name)}</strong> (${escapeHtml(params.email)}) asked for a demo on the ${escapeHtml(params.where)}.</p>
    ${params.campaign ? `<p style="margin:0 0 8px;font-size:14px;color:${MUTED};">Came from: ${escapeHtml(params.campaign)}</p>` : ""}
    <p style="margin:0 0 8px;font-size:14px;color:${INK};">Send their demo link from the console in one click, or dismiss the request.</p>
    ${button(params.consoleUrl, "Open in the console")}
  `);
  const text = `${params.name} (${params.email}) asked for a demo on the ${params.where}.${params.campaign ? `\nCame from: ${params.campaign}` : ""}\n\nSend their demo link from the console in one click, or dismiss the request:\n\n${params.consoleUrl}`;
  return { subject: `Demo request: ${params.name}`, html, text };
}

/** The investor briefing's sign-in link (0061): personal, works for 30 days. */
export function investorBriefingEmail(params: { name: string; openUrl: string; days: number }) {
  const html = wrap(`
    <p style="margin:0 0 16px;font-size:16px;color:${INK};">Hello ${escapeHtml(params.name)},</p>
    <p style="margin:0 0 16px;font-size:16px;color:${INK};">Thank you for your interest in StrataCouncil.ca. Your personal link to the investor briefing is below.</p>
    ${button(params.openUrl, "Open the investor briefing")}
    <p style="margin:16px 0 0;font-size:13px;color:${MUTED};">The link works for ${params.days} days and is for you alone. To invite a colleague, use Share inside the briefing; they will sign up and receive their own link. If you didn't request this, you can ignore this email.</p>
  `);
  const text = `Hello ${params.name},\n\nThank you for your interest in StrataCouncil.ca. Your personal link to the investor briefing:\n\n${params.openUrl}\n\nThe link works for ${params.days} days and is for you alone. To invite a colleague, use Share inside the briefing; they will sign up and receive their own link. If you didn't request this, you can ignore this email.`;
  return { subject: "Your StrataCouncil.ca investor briefing", html, text };
}

/** "Download everything" (0062): a one-time link to the strata's documents, for its Admin. */
export function documentExportEmail(params: { name: string; strataName: string; openUrl: string }) {
  const html = wrap(`
    <p style="margin:0 0 16px;font-size:16px;color:${INK};">Hello ${escapeHtml(params.name)},</p>
    <p style="margin:0 0 16px;font-size:16px;color:${INK};">You asked to download all of ${escapeHtml(params.strataName)}'s documents. Open the link below while signed in to StrataCouncil.ca to download them as one ZIP file.</p>
    ${button(params.openUrl, "Download the documents")}
    <p style="margin:16px 0 0;font-size:13px;color:${MUTED};">The link works once, for 24 hours, and only for you. If you didn't ask for this, someone may be signed in to your account: please contact support@stratacouncil.ca.</p>
  `);
  const text = `Hello ${params.name},\n\nYou asked to download all of ${params.strataName}'s documents. Open this link while signed in to StrataCouncil.ca to download them as one ZIP file:\n\n${params.openUrl}\n\nThe link works once, for 24 hours, and only for you. If you didn't ask for this, someone may be signed in to your account: please contact support@stratacouncil.ca.`;
  return { subject: `Your download link: ${params.strataName} documents`, html, text };
}

/** Vote buttons for a council discussion (0081). Each opens a confirm page in the app, signed in as the person. */
export interface DiscussionVoteLinks {
  for: string;
  against: string;
  abstain: string;
}

function voteButtons(links: DiscussionVoteLinks) {
  const one = (href: string, label: string, bg: string) =>
    `<td style="padding:0 8px 0 0;"><a href="${escapeHtml(href)}" style="display:inline-block;padding:10px 18px;border-radius:999px;background:${bg};color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">${label}</a></td>`;
  return `
    <p style="margin:20px 0 8px;font-size:16px;font-weight:600;color:${INK};">Cast your vote</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 8px;"><tr>
      ${one(links.for, "In favour", "#2f7d4f")}${one(links.against, "Against", "#a6342a")}${one(links.abstain, "Abstain", MUTED)}
    </tr></table>
    <p style="margin:0 0 16px;font-size:13px;color:${MUTED};">Each button opens StrataCouncil.ca to confirm your vote, signed in as you. To declare a conflict of interest, open the discussion.</p>`;
}

function motionBlock(motion: string) {
  return motion.trim()
    ? `<p style="margin:0 0 4px;font-size:13px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:${MUTED};">Motion</p>
    <p style="margin:0 0 16px;font-size:15px;color:${INK};white-space:pre-wrap;">${escapeHtml(motion)}</p>`
    : "";
}

function voteText(links: DiscussionVoteLinks | null) {
  return links
    ? `\n\nCast your vote (each link opens StrataCouncil.ca to confirm, signed in as you):\nIn favour: ${links.for}\nAgainst: ${links.against}\nAbstain: ${links.abstain}\nTo declare a conflict of interest, open the discussion.`
    : "";
}

/**
 * To council when a discussion opens (0070; 0081). Council reads the
 * motion and votes from the email, like the tools they're used to: the
 * buttons open a confirm page behind sign-in, so a vote is always the
 * signed-in person's own.
 */
export function discussionOpenedEmail(params: {
  corporationName: string;
  authorName: string;
  title: string;
  motion: string;
  voteLinks: DiscussionVoteLinks | null;
  openUrl: string;
}) {
  const who = params.authorName || "A council member";
  const kind = params.voteLinks ? "a council discussion and vote" : "a council discussion (no vote)";
  const after = params.voteLinks
    ? "A motion that passes goes to the next council meeting to be ratified."
    : "This discussion has no vote: share your views in the comments.";
  const html = wrap(`
    <p style="margin:0 0 16px;font-size:16px;color:${INK};">${escapeHtml(who)} opened ${kind} for <strong>${escapeHtml(params.corporationName)}</strong>:</p>
    <p style="margin:0 0 12px;font-size:17px;font-weight:600;color:${INK};">${escapeHtml(params.title)}</p>
    ${motionBlock(params.motion)}
    ${params.voteLinks ? voteButtons(params.voteLinks) : ""}
    <p style="margin:0 0 8px;font-size:14px;color:${MUTED};">${after}</p>
    ${button(params.openUrl, "Open the discussion")}
  `);
  const text = `${who} opened ${kind} for ${params.corporationName}:\n\n${params.title}${params.motion.trim() ? `\n\nMotion: ${params.motion}` : ""}${voteText(params.voteLinks)}\n\n${after}\n\n${params.openUrl}`;
  return { subject: `Council discussion: ${params.title}`, html, text };
}

/**
 * To council on every comment (0081): the motion, the count so far, and
 * the whole thread, newest first, with the vote buttons while it's open.
 * Never to anyone recused, who can't see the comments.
 */
export function discussionCommentEmail(params: {
  corporationName: string;
  title: string;
  motion: string;
  tally: string | null;
  comments: Array<{ name: string; body: string; when: string }>;
  voteLinks: DiscussionVoteLinks | null;
  openUrl: string;
}) {
  const latest = params.comments[0];
  const thread = params.comments
    .map(
      (c, i) => `<div style="margin:0 0 12px;padding:12px 14px;border-radius:10px;background:${i === 0 ? PAPER : "#ffffff"};border:1px solid #e3dfd5;">
      <p style="margin:0 0 4px;font-size:13px;color:${MUTED};"><strong style="color:${INK};">${escapeHtml(c.name || "A council member")}</strong> &middot; ${escapeHtml(c.when)}</p>
      <p style="margin:0;font-size:15px;color:${INK};white-space:pre-wrap;">${escapeHtml(c.body)}</p>
    </div>`
    )
    .join("");
  const html = wrap(`
    <p style="margin:0 0 16px;font-size:16px;color:${INK};">${escapeHtml(latest?.name || "A council member")} commented on a council discussion for <strong>${escapeHtml(params.corporationName)}</strong>:</p>
    <p style="margin:0 0 12px;font-size:17px;font-weight:600;color:${INK};">${escapeHtml(params.title)}</p>
    ${motionBlock(params.motion)}
    ${params.tally ? `<p style="margin:0 0 16px;font-size:14px;color:${INK};"><strong>Votes so far:</strong> ${escapeHtml(params.tally)}</p>` : ""}
    ${params.voteLinks ? voteButtons(params.voteLinks) : ""}
    <p style="margin:20px 0 8px;font-size:16px;font-weight:600;color:${INK};">Comments</p>
    ${thread}
    ${button(params.openUrl, "Reply in StrataCouncil.ca")}
  `);
  const text = `${latest?.name || "A council member"} commented on a council discussion for ${params.corporationName}:\n\n${params.title}${params.motion.trim() ? `\n\nMotion: ${params.motion}` : ""}${params.tally ? `\n\nVotes so far: ${params.tally}` : ""}${voteText(params.voteLinks)}\n\nComments:\n${params.comments.map((c) => `\n${c.name || "A council member"}, ${c.when}:\n${c.body}`).join("\n")}\n\nReply: ${params.openUrl}`;
  return { subject: `New comment: ${params.title}`, html, text };
}

/** To council when the author closes a discussion (0070), with the result. */
export function discussionClosedEmail(params: { corporationName: string; title: string; result: string | null; tally: string | null; passed: boolean; openUrl: string }) {
  if (params.result === null) {
    const html = wrap(`
    <p style="margin:0 0 16px;font-size:16px;color:${INK};">A council discussion for <strong>${escapeHtml(params.corporationName)}</strong> has been closed:</p>
    <p style="margin:0 0 8px;font-size:16px;font-weight:600;color:${INK};">${escapeHtml(params.title)}</p>
    <p style="margin:0 0 8px;font-size:14px;color:${MUTED};">It had no vote, so there's nothing to ratify. The comments stay in the discussion.</p>
    ${button(params.openUrl, "Open the discussion")}
  `);
    const text = `A council discussion for ${params.corporationName} has been closed:\n\n${params.title}\n\nIt had no vote, so there's nothing to ratify. The comments stay in the discussion:\n\n${params.openUrl}`;
    return { subject: `Discussion closed: ${params.title}`, html, text };
  }
  const next = params.passed
    ? "It now awaits ratification at the next council meeting."
    : "It didn't pass, so it won't go to a meeting for ratification.";
  const html = wrap(`
    <p style="margin:0 0 16px;font-size:16px;color:${INK};">A council discussion for <strong>${escapeHtml(params.corporationName)}</strong> has been closed:</p>
    <p style="margin:0 0 8px;font-size:16px;font-weight:600;color:${INK};">${escapeHtml(params.title)}</p>
    <p style="margin:0 0 4px;font-size:15px;color:${INK};">${escapeHtml(params.result)} (${escapeHtml(params.tally ?? "")}).</p>
    <p style="margin:0 0 8px;font-size:14px;color:${MUTED};">${next} The vote record is in Documents, under Meetings &amp; Records.</p>
    ${button(params.openUrl, "Open the discussion")}
  `);
  const text = `A council discussion for ${params.corporationName} has been closed:\n\n${params.title}\n${params.result} (${params.tally}).\n\n${next} The vote record is in Documents, under Meetings & Records:\n\n${params.openUrl}`;
  return { subject: `Discussion closed: ${params.title}`, html, text };
}

/** To council and the manager when a meeting is launched (0074): join from the Meetings tab. */
export function meetingStartedEmail(params: {
  corporationName: string;
  meetingLabel: string;
  runnerName: string;
  joinUrl: string;
  /** The agenda, read-only (signing in first). */
  agendaUrl: string;
  /** The meeting's location or link, if one was set. */
  location: string | null;
  /** Test video and audio, for a meeting with video. */
  videoTestUrl?: string | null;
}) {
  const loc = params.location?.trim() || null;
  const locIsLink = Boolean(loc && /^https?:\/\//i.test(loc));
  const locHtml = loc
    ? `<p style="margin:0 0 8px;font-size:14px;color:${INK};">${locIsLink ? "Meeting link" : "Where"}: ${
        locIsLink ? `<a href="${escapeHtml(loc)}" style="color:${INK};">${escapeHtml(loc)}</a>` : escapeHtml(loc)
      }</p>`
    : "";
  const html = wrap(`
    <p style="margin:0 0 16px;font-size:16px;color:${INK};">The ${escapeHtml(params.meetingLabel.toLowerCase())} for <strong>${escapeHtml(params.corporationName)}</strong> has started${params.runnerName ? `, run by ${escapeHtml(params.runnerName)}` : ""}.</p>
    ${locHtml}
    <p style="margin:0 0 8px;font-size:14px;color:${MUTED};">Join to follow the agenda and vote. Joining records your attendance.</p>
    ${button(params.joinUrl, "Join the meeting")}
    <p style="margin:16px 0 0;font-size:14px;color:${MUTED};"><a href="${escapeHtml(params.agendaUrl)}" style="color:${INK};">View the agenda</a></p>
    ${
      params.videoTestUrl
        ? `<p style="margin:8px 0 0;font-size:14px;color:${MUTED};">First time with video in this browser? <a href="${escapeHtml(params.videoTestUrl)}" style="color:${INK};">Test your video and audio</a> (one minute).</p>`
        : ""
    }
  `);
  const text = `The ${params.meetingLabel.toLowerCase()} for ${params.corporationName} has started${params.runnerName ? `, run by ${params.runnerName}` : ""}.${
    loc ? `\n\n${locIsLink ? "Meeting link" : "Where"}: ${loc}` : ""
  }\n\nJoin to follow the agenda and vote. Joining records your attendance:\n\n${params.joinUrl}\n\nView the agenda:\n\n${params.agendaUrl}${
    params.videoTestUrl ? `\n\nFirst time with video in this browser? Test your video and audio (one minute):\n\n${params.videoTestUrl}` : ""
  }`;
  return { subject: `${params.meetingLabel} has started: ${params.corporationName}`, html, text };
}
