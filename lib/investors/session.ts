import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { INVESTOR_DECK_BUCKET, LINK_DAYS, SESSION_COOKIE } from "./briefing";

/**
 * Investors aren't app users (0061): the emailed link carries a random
 * token, and opening it stores the same token in an http-only cookie.
 * Only its hash is kept, and it works until the link expires (30 days).
 */

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function newToken() {
  return randomBytes(32).toString("base64url");
}

export function linkExpiry(from = new Date()) {
  return new Date(from.getTime() + LINK_DAYS * 86_400_000);
}

export interface InvestorSession {
  investorId: string;
  name: string;
  email: string;
  lastPage: number | null;
  expiresAt: string;
}

/** The investor behind a token, if the link is live and their access isn't revoked. */
export async function investorForToken(token: string | undefined | null): Promise<InvestorSession | null> {
  if (!token || token.length < 20 || token.length > 100) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("investor_links")
    .select("expires_at, investor:investors!inner(id, full_name, email, last_page, revoked_at)")
    .eq("token_hash", hashToken(token))
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  const inv = (data as unknown as { expires_at: string; investor: { id: string; full_name: string; email: string; last_page: number | null; revoked_at: string | null } } | null);
  if (!inv || inv.investor.revoked_at) return null;
  return { investorId: inv.investor.id, name: inv.investor.full_name, email: inv.investor.email, lastPage: inv.investor.last_page, expiresAt: inv.expires_at };
}

export async function currentInvestor(): Promise<InvestorSession | null> {
  const jar = await cookies();
  return investorForToken(jar.get(SESSION_COOKIE)?.value);
}

export interface PublishedDeck {
  id: string;
  title: string;
  pageCount: number;
  aspect: number;
}

export async function currentDeck(): Promise<PublishedDeck | null> {
  const { data } = await createAdminClient()
    .from("investor_decks")
    .select("id, title, page_count, aspect")
    .not("published_at", "is", null)
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? { id: data.id, title: data.title, pageCount: data.page_count, aspect: Number(data.aspect) } : null;
}

export const slidePath = (deckId: string, page: number) => `${deckId}/${page}.png`;

/** Signed links to every slide of a deck, valid for a few hours. */
export async function slideUrls(deck: PublishedDeck, seconds = 6 * 3600): Promise<string[]> {
  const paths = Array.from({ length: deck.pageCount }, (_, i) => slidePath(deck.id, i + 1));
  const { data, error } = await createAdminClient().storage.from(INVESTOR_DECK_BUCKET).createSignedUrls(paths, seconds);
  if (error || !data) {
    console.error("[slideUrls]", error?.message);
    return [];
  }
  return data.map((d) => d.signedUrl ?? "");
}
