import { type NextRequest, NextResponse } from "next/server";
import { APP_URL } from "@/lib/app-url";
import { verifySupabaseWebhook, WebhookVerificationError } from "@/lib/auth/verify-supabase-webhook";
import { sendTransactionalEmail, MailtrapSendError } from "@/lib/email/mailtrap";
import {
  magicLinkEmail,
  emailChangeConfirmationEmail,
  genericAuthEmail,
} from "@/lib/email/templates";

/**
 * Supabase Auth "Send Email" Hook receiver (doc04 §7a). Configured in the
 * Supabase dashboard (Authentication → Hooks → Send Email) to point at
 * this route's deployed URL. Supabase calls this instead of sending auth
 * emails itself, for every auth email type (magic link / OTP sign-in,
 * signup confirmation, email change, password recovery, reauthentication,
 * etc.) — one receiver, template chosen by `email_action_type`.
 *
 * Payload shape (Supabase Auth Hooks, "Send Email" hook):
 *   {
 *     user: { email: string, ... },
 *     email_data: {
 *       token: string,
 *       token_hash: string,
 *       redirect_to: string,
 *       email_action_type: string,  // "magiclink" | "signup" | "email_change" | ...
 *       site_url: string,
 *       token_hash_new?: string,
 *       token_new?: string,
 *     }
 *   }
 *
 * The confirm link always targets /auth/confirm (app/auth/confirm/route.ts),
 * which expects ?token_hash=...&type=....
 *
 * Supabase requires a 2xx response to consider the email "sent" — if this
 * route errors, Supabase surfaces that as an auth failure to the user
 * mid-flow, so failures here are deliberately loud (non-2xx, logged) rather
 * than swallowed.
 */

interface SendEmailHookPayload {
  user: {
    email: string;
    [key: string]: unknown;
  };
  email_data: {
    token: string;
    token_hash: string;
    redirect_to: string;
    email_action_type: string;
    site_url: string;
    token_hash_new?: string;
    token_new?: string;
  };
}

/**
 * Deliberately NOT built from `email_data.site_url`: that field does not
 * reliably reflect Supabase Auth's configured Site URL for hook payloads
 * (confirmed 2026-09-30 — it kept coming through as the Supabase project's
 * own *.supabase.co domain even after Site URL was set correctly in the
 * dashboard, sending confirm links to Supabase's bare API gateway instead
 * of the app). We know our own production URL, so we use that directly.
 * NEXT_PUBLIC_APP_URL lets a preview deployment override it if needed
 * (lib/app-url.ts, shared with app-sent emails like corporation invites).
 */

function buildConfirmUrl(emailData: SendEmailHookPayload["email_data"]): string {
  const url = new URL("/auth/confirm", APP_URL);
  url.searchParams.set("token_hash", emailData.token_hash);
  url.searchParams.set("type", emailData.email_action_type);
  if (emailData.redirect_to) {
    url.searchParams.set("next", emailData.redirect_to);
  }
  return url.toString();
}

function selectTemplate(actionType: string, confirmUrl: string) {
  switch (actionType) {
    case "magiclink":
    case "signup":
      return magicLinkEmail(confirmUrl);
    case "email_change":
      return emailChangeConfirmationEmail(confirmUrl);
    default:
      return genericAuthEmail(confirmUrl);
  }
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  const secret = process.env.SUPABASE_WEBHOOK_SECRET;
  if (!secret) {
    console.error("send-email-hook: SUPABASE_WEBHOOK_SECRET is not set.");
    return NextResponse.json(
      { error: "Server misconfiguration: webhook secret not set." },
      { status: 500 }
    );
  }

  try {
    await verifySupabaseWebhook({
      rawBody,
      headers: {
        "webhook-id": request.headers.get("webhook-id"),
        "webhook-timestamp": request.headers.get("webhook-timestamp"),
        "webhook-signature": request.headers.get("webhook-signature"),
      },
      secret,
    });
  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      console.error("send-email-hook: signature verification failed:", error.message);
      return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
    }
    throw error;
  }

  let payload: SendEmailHookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Malformed JSON body." }, { status: 400 });
  }

  const { user, email_data: emailData } = payload;
  if (!user?.email || !emailData?.token_hash || !emailData?.email_action_type) {
    return NextResponse.json({ error: "Missing required payload fields." }, { status: 400 });
  }

  const confirmUrl = buildConfirmUrl(emailData);
  const { subject, html, text } = selectTemplate(emailData.email_action_type, confirmUrl);

  try {
    await sendTransactionalEmail({
      to: user.email,
      subject,
      html,
      text,
    });
  } catch (error) {
    if (error instanceof MailtrapSendError) {
      console.error(
        `send-email-hook: Mailtrap send failed (${error.status}) for ${emailData.email_action_type}:`,
        error.body
      );
      return NextResponse.json({ error: "Failed to send email." }, { status: 500 });
    }
    throw error;
  }

  return NextResponse.json({ ok: true });
}
