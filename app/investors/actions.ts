"use server";

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
import { currentDeck, currentInvestor, hashToken, linkExpiry, newToken } from "@/lib/investors/session";

/**
 * The investor briefing (0061). Signing up: name, email, the disclaimer
 * and the accredited-investor confirmation, then a personal link by
 * email. A returning investor does the same to get a fresh link; their
 * notes and progress are kept.
 */

export type InvestorSignupState = { status: "idle" | "sent" | "error"; message?: string; name?: string; email?: string };

const MAX_LINKS_PER_HOUR = 3;

export async function requestInvestorLink(_prev: InvestorSignupState, form: FormData): Promise<InvestorSignupState> {
  if (IS_DEMO) return { status: "error", message: "The investor briefing isn't part of the demo." };
  // Hidden from people; bots fill it in.
  if (String(form.get("website") ?? "").trim()) return { status: "sent" };

  const name = normalizeInvestorName(form.get("name"));
  const email = normalizeInvestorEmail(form.get("email"));
  const kept = { name: String(form.get("name") ?? ""), email: String(form.get("email") ?? "") };
  if (!name) return { status: "error", message: "Please enter your name.", ...kept };
  if (!email) return { status: "error", message: "Please enter a valid email address.", ...kept };
  if (form.get("disclaimer") !== "on") return { status: "error", message: "Please read and accept the Legal Disclaimer.", ...kept };
  if (form.get("accredited") !== "on") return { status: "error", message: "Please confirm that you are an accredited investor.", ...kept };

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
    const referredBy = referralId(form.get("ref"));
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
        console.error("[requestInvestorLink] insert", error?.message, retry?.error?.message);
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
    console.error("[requestInvestorLink] link", linkError.message);
    return { status: "error", message: "Something went wrong. Please try again.", ...kept };
  }

  const mail = investorBriefingEmail({ name, openUrl: `${APP_URL}/investors/open?t=${token}`, days: LINK_DAYS });
  try {
    await sendTransactionalEmail({ to: email, ...mail });
  } catch (err) {
    console.error("[requestInvestorLink] email", err instanceof Error ? err.message : err);
    return { status: "error", message: "We couldn't send the email. Please try again, or contact investors@stratacouncil.ca.", ...kept };
  }
  return { status: "sent", email };
}

/** Notes under a slide, saved as the investor types. */
export async function saveInvestorNote(deckId: string, page: number, body: string): Promise<{ ok: boolean }> {
  const investor = await currentInvestor();
  const deck = await currentDeck();
  if (!investor || !deck || deck.id !== deckId) return { ok: false };
  if (!Number.isInteger(page) || page < 1 || page > deck.pageCount) return { ok: false };
  const text = String(body ?? "").slice(0, 5000);
  const admin = createAdminClient();
  const { error } = text.trim()
    ? await admin
        .from("investor_notes")
        .upsert({ investor_id: investor.investorId, deck_id: deckId, page, body: text, updated_at: new Date().toISOString() })
    : await admin.from("investor_notes").delete().eq("investor_id", investor.investorId).eq("deck_id", deckId).eq("page", page);
  if (error) console.error("[saveInvestorNote]", error.message);
  return { ok: !error };
}
