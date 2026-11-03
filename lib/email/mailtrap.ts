/**
 * Thin wrapper around Mailtrap's Sending API (doc04 §7a). Used by both the
 * Supabase Auth Send Email Hook receiver (app/api/auth/send-email-hook)
 * and any future app-triggered email (corporation_invites, subscription
 * notices, trial-exhaustion) — one place that actually talks to Mailtrap,
 * so callers just build a subject/html and hand it off.
 *
 * Requires MAILTRAP_API_TOKEN and MAILTRAP_SENDER_EMAIL (both set in
 * Vercel, Production and Preview — see doc00 changelog). No SDK: this is
 * one `fetch()` call against Mailtrap's REST API, since adding a new npm
 * dependency can't be verified in this sandbox (persistent
 * registry.npmjs.org 403, doc00).
 */

import { IS_DEMO } from "@/lib/demo";

const MAILTRAP_SEND_URL = "https://send.api.mailtrap.io/api/send";

/**
 * A failed send. `body` is Mailtrap's reply, which callers log, so any email
 * address in it is replaced first (PIPA: personal information stays out of
 * the logs). The status and Mailtrap's own error text are kept.
 */
export class MailtrapSendError extends Error {
  public readonly body: unknown;
  constructor(
    message: string,
    public readonly status: number,
    body: unknown
  ) {
    super(message);
    this.name = "MailtrapSendError";
    this.body = redactEmails(body);
  }
}

const EMAIL_IN_TEXT = /[^\s@"'<>,;:()]+@[^\s@"'<>,;:()]+\.[^\s@"'<>,;:()]+/g;

/** The same value with every email address replaced by [email]. */
export function redactEmails(value: unknown): unknown {
  if (value == null) return value;
  try {
    return JSON.parse(JSON.stringify(value).replace(EMAIL_IN_TEXT, "[email]"));
  } catch {
    return "[unreadable]";
  }
}

export async function sendTransactionalEmail(params: {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Overrides MAILTRAP_SENDER_EMAIL for this one send, if ever needed. */
  fromEmail?: string;
  fromName?: string;
  /** The strata it's about, when the recipient may not have an account (an invitation). */
  corporationId?: string;
}) {
  // The demo site (lib/demo.ts) never emails a visitor's fictional people.
  // A Super Admin's sandbox emails only the Super Admin who made it, saying
  // who it was for (lib/demo-email.ts).
  if (IS_DEMO) {
    const { sandboxRecipient } = await import("@/lib/demo-email");
    // Without a Mailtrap key on the demo project, nothing is sent (as before).
    const redirect = process.env.MAILTRAP_API_TOKEN ? await sandboxRecipient(params.to, params.corporationId).catch(() => null) : null;
    if (!redirect) {
      console.info("[sendTransactionalEmail] demo, not sent:", params.subject);
      return { success: true, demo: true };
    }
    params = { ...params, to: redirect.to, subject: `[Sandbox → ${redirect.label}] ${params.subject}` };
  }

  const apiToken = process.env.MAILTRAP_API_TOKEN;
  const senderEmail =
    params.fromEmail ?? process.env.MAILTRAP_SENDER_EMAIL ?? "noreply@stratacouncil.ca";
  const senderName = params.fromName ?? "StrataCouncil.ca";

  if (!apiToken) {
    throw new Error(
      "MAILTRAP_API_TOKEN is not set — cannot send transactional email (doc04 §7a)."
    );
  }

  const response = await fetch(MAILTRAP_SEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: { email: senderEmail, name: senderName },
      to: [{ email: params.to }],
      subject: params.subject,
      html: params.html,
      text: params.text,
      category: "transactional",
    }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new MailtrapSendError(
      `Mailtrap send failed with status ${response.status}`,
      response.status,
      body
    );
  }

  return response.json();
}
