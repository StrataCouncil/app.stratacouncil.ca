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

const MAILTRAP_SEND_URL = "https://send.api.mailtrap.io/api/send";

export class MailtrapSendError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown
  ) {
    super(message);
    this.name = "MailtrapSendError";
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
}) {
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
