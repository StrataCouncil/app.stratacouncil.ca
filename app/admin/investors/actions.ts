"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/profile";
import { INVESTOR_DECK_BUCKET } from "@/lib/investors/briefing";
import { slidePath } from "@/lib/investors/session";

/** Super Admin: the investor briefing's deck and its readers (0061). */

type Fail = { ok: false; error: string };

async function superAdmin() {
  const profile = await getCurrentProfile();
  return profile?.isSuperAdmin ? profile : null;
}

/** A new deck version: its row, and an upload link for each slide image. */
export async function startInvestorDeckUpload(input: { title: string; pageCount: number; aspect: number }): Promise<
  { ok: true; deckId: string; tickets: Array<{ path: string; token: string }> } | Fail
> {
  const profile = await superAdmin();
  if (!profile) return { ok: false, error: "Super Admins only." };
  const title = String(input.title ?? "").trim().slice(0, 200) || "Investor briefing";
  const pageCount = Math.round(Number(input.pageCount));
  const aspect = Number(input.aspect);
  if (!(pageCount >= 1 && pageCount <= 200)) return { ok: false, error: "The PDF needs between 1 and 200 pages." };
  if (!(aspect > 0.2 && aspect < 5)) return { ok: false, error: "Couldn't read the slide size." };

  const admin = createAdminClient();
  const { data: deck, error } = await admin
    .from("investor_decks")
    .insert({ title, page_count: pageCount, aspect: Math.round(aspect * 10000) / 10000, created_by: profile.id })
    .select("id")
    .single();
  if (error || !deck) {
    console.error("[startInvestorDeckUpload]", error?.message);
    return { ok: false, error: "Couldn't start the upload." };
  }
  const tickets: Array<{ path: string; token: string }> = [];
  for (let page = 1; page <= pageCount; page++) {
    const path = slidePath(deck.id, page);
    const { data, error: upErr } = await admin.storage.from(INVESTOR_DECK_BUCKET).createSignedUploadUrl(path, { upsert: true });
    if (upErr || !data) {
      console.error("[startInvestorDeckUpload] url", upErr?.message);
      return { ok: false, error: "Couldn't start the upload." };
    }
    tickets.push({ path, token: data.token });
  }
  return { ok: true, deckId: deck.id, tickets };
}

/** Once every slide is uploaded, investors see this deck. */
export async function publishInvestorDeck(deckId: string): Promise<{ ok: true } | Fail> {
  if (!(await superAdmin())) return { ok: false, error: "Super Admins only." };
  const admin = createAdminClient();
  const { data: deck } = await admin.from("investor_decks").select("id, page_count").eq("id", deckId).maybeSingle();
  if (!deck) return { ok: false, error: "That deck wasn't found." };
  const { data: files } = await admin.storage.from(INVESTOR_DECK_BUCKET).list(deck.id, { limit: 500 });
  const have = new Set((files ?? []).map((f) => f.name));
  for (let page = 1; page <= deck.page_count; page++) {
    if (!have.has(`${page}.png`)) return { ok: false, error: `Slide ${page} didn't upload. Please try again.` };
  }
  const { error } = await admin.from("investor_decks").update({ published_at: new Date().toISOString() }).eq("id", deck.id);
  if (error) return { ok: false, error: "Couldn't publish the deck." };
  revalidatePath("/admin/investors");
  return { ok: true };
}

/** Ends (or restores) an investor's access; their links stop working at once. */
export async function setInvestorAccess(investorId: string, revoked: boolean): Promise<{ ok: true } | Fail> {
  if (!(await superAdmin())) return { ok: false, error: "Super Admins only." };
  const { error } = await createAdminClient()
    .from("investors")
    .update({ revoked_at: revoked ? new Date().toISOString() : null })
    .eq("id", investorId);
  if (error) return { ok: false, error: "Couldn't update access." };
  revalidatePath("/admin/investors");
  revalidatePath(`/admin/investors/${investorId}`);
  return { ok: true };
}
