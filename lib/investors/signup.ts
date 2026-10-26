import { createAdminClient } from "@/lib/supabase/admin";
import { APP_URL } from "@/lib/app-url";
import { IS_DEMO } from "@/lib/demo";
import { sendTransactionalEmail } from "@/lib/email/mailtrap";
import { investorBriefingEmail } from "@/lib/email/templates";
import {
  DISCLAIMER_VERSION,
  LINK_DAYS,
  normalizeInvestorEmail,
  normalizeInvestorName,
  referralId,
} from "@/lib/investors/briefing";
import { hashToken, linkExpiry, newToken } from "@/lib/investors/session";

/**
 * Signing up for the investor briefing (0061): name, email, the
 * disclaimer and the accredited-investor confirmation, then a personal
 * link by email. A returning investor does the same to get a fresh link;
 * their notes and progress are kept. Used by the sign-up page's server
 * action and by /api/investors/request (the form on stratacouncil.ca).
 */

export type InvestorSignupState = { status: "idle" | "sent" | "error"; message?: string; name?: string; email?: string };

export interface InvestorSignupInput {
  name: unknown;
  email: unknown;
  disclaimer: boolean;
  accredited: boolean;
  /** The hidden field people never see; anything in it is a bot. */
  website?: unknown;
  ref?: unknown;
}

const MAX_LINKS_PER_HOUR = 3;

export async function signUpInvestor(input: InvestorSignupInput): Promise<InvestorSignupState> {
  if (IS_DEMO) return { status: "error", message: "The investor briefing isn't part of the demo." };
  if (String(input.website ?? "").trim()) return { status: "sent" };

  const name = normalizeInvestorName(input.name);
  const email = normalizeInvestorEmail(input.email);
  const kept = { name: String(input.name ?? ""), email: String(input.email ?? "") };
  if (!name) return { status: "error", message: "Please enter your name.", ...kept };
  if (!email) return { status: "error", message: "Please enter a valid email address.", ...kept };
  if (!input.disclaimer) return { status: "error", message: "Please read and accept the Legal Disclaimer.", ...kept };
  if (!input.accredited) return { status: "error", message: "Please confirm that you are an accredited investor.", ...kept };

  const admin = createAdminClient();
  const now = new Date().toISOString();
  const { data: existing } = await admin.from("investors").select("id, revoked_at").eq("email", email).maybeSingle();
  if (existing?.revoked_at) {
    return { status: "error", message: "Access for this email has ended. Please contact investors@stratacouncil.ca.", ...kept };
  }

  let investorId = existing?.id as string | undefined;
  if (investorId) {
    const { count } = await admin
      .from("investor_links")
      .select("id", { count: "exact", head: true })
      .eq("investor_id", investorId)
      .gt("created_at", new Date(Date.now() - 3600_000).toISOString());
    if ((count ?? 0) >= MAX_LINKS_PER_HOUR) {
      return { status: "error", message: "We've sent several links in the last hour. Please check your email, or try again later.", ...kept };
    }
    await admin
      .from("investors")
      .update({ full_name: name, disclaimer_version: DISCLAIMER_VERSION, disclaimer_accepted_at: now, accredited_confirmed_at: now })
      .eq("id", investorId);
  } else {
    const referredBy = referralId(input.ref);
    const { data: created, error } = await admin
      .from("investors")
      .insert({
        email,
        full_name: name,
        disclaimer_version: DISCLAIMER_VERSION,
        disclaimer_accepted_at: now,
        accredited_confirmed_at: now,
        referred_by: referredBy,
      })
      .select("id")
      .single();
    if (error || !created) {
      // A referral id that doesn't exist fails the foreign key: sign up without it.
      const retry = referredBy
        ? await admin
            .from("investors")
            .insert({ email, full_name: name, disclaimer_version: DISCLAIMER_VERSION, disclaimer_accepted_at: now, accredited_confirmed_at: now })
            .select("id")
            .single()
        : null;
      if (!retry?.data) {
        console.error("[signUpInvestor] insert", error?.message, retry?.error?.message);
        return { status: "error", message: "Something went wrong. Please try again.", ...kept };
      }
      investorId = retry.data.id;
    } else {
      investorId = created.id;
    }
  }

  const token = newToken();
  const { error: linkError } = await admin
    .from("investor_links")
    .insert({ investor_id: investorId, token_hash: hashToken(token), expires_at: linkExpiry().toISOString() });
  if (linkError) {
    console.error("[signUpInvestor] link", linkError.message);
    return { status: "error", message: "Something went wrong. Please try again.", ...kept };
  }

  const mail = investorBriefingEmail({ name, openUrl: `${APP_URL}/investors/open?t=${token}`, days: LINK_DAYS });
  try {
    await sendTransactionalEmail({ to: email, ...mail });
  } catch (err) {
    console.error("[signUpInvestor] email", err instanceof Error ? err.message : err);
    return { status: "error", message: "We couldn't send the email. Please try again, or contact investors@stratacouncil.ca.", ...kept };
  }
  return { status: "sent", email };
}
