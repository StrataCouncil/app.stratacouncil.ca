"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { currentDeck, currentInvestor } from "@/lib/investors/session";
import { signUpInvestor, type InvestorSignupState } from "@/lib/investors/signup";

/**
 * The investor briefing (0061). Signing up: name, email, the disclaimer
 * and the accredited-investor confirmation, then a personal link by
 * email. A returning investor does the same to get a fresh link; their
 * notes and progress are kept.
 */

export type { InvestorSignupState } from "@/lib/investors/signup";

/** The sign-up page's form; lib/investors/signup.ts does the work. */
export async function requestInvestorLink(_prev: InvestorSignupState, form: FormData): Promise<InvestorSignupState> {
  return signUpInvestor({
    name: form.get("name"),
    email: form.get("email"),
    disclaimer: form.get("disclaimer") === "on",
    accredited: form.get("accredited") === "on",
    website: form.get("website"),
    ref: form.get("ref"),
  });
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
