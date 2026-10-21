import { createClient } from "@/lib/supabase/server";

/**
 * The investor briefing's readers, for the Super Admin console (0061).
 * Read through the signed-in user's own access: only Super Admins can.
 */

export interface InvestorDeckRow {
  id: string;
  title: string;
  pageCount: number;
  createdAt: string;
  publishedAt: string | null;
}

export interface InvestorRow {
  id: string;
  name: string;
  email: string;
  signedUpAt: string;
  acceptedAt: string;
  disclaimerVersion: string;
  accreditedAt: string;
  referredBy: string | null;
  lastSeenAt: string | null;
  revokedAt: string | null;
  /** On the current deck. */
  seconds: number;
  slidesViewed: number;
  notes: number;
}

export async function getInvestorOverview(): Promise<{ decks: InvestorDeckRow[]; current: InvestorDeckRow | null; investors: InvestorRow[] }> {
  const supabase = await createClient();
  const [{ data: decks }, { data: investors }] = await Promise.all([
    supabase.from("investor_decks").select("id, title, page_count, created_at, published_at").order("created_at", { ascending: false }),
    supabase
      .from("investors")
      .select("id, full_name, email, created_at, disclaimer_accepted_at, disclaimer_version, accredited_confirmed_at, referred_by, last_seen_at, revoked_at")
      .order("created_at", { ascending: false }),
  ]);
  const deckRows: InvestorDeckRow[] = (decks ?? []).map((d) => ({
    id: d.id,
    title: d.title,
    pageCount: d.page_count,
    createdAt: d.created_at,
    publishedAt: d.published_at,
  }));
  const current = deckRows.filter((d) => d.publishedAt).sort((a, b) => (b.publishedAt! > a.publishedAt! ? 1 : -1))[0] ?? null;

  const time = new Map<string, { seconds: number; slides: number }>();
  const notes = new Map<string, number>();
  if (current) {
    const [{ data: t }, { data: n }] = await Promise.all([
      supabase.from("investor_slide_time").select("investor_id, seconds").eq("deck_id", current.id),
      supabase.from("investor_notes").select("investor_id").eq("deck_id", current.id),
    ]);
    for (const r of t ?? []) {
      const x = time.get(r.investor_id) ?? { seconds: 0, slides: 0 };
      x.seconds += r.seconds;
      if (r.seconds > 0) x.slides++;
      time.set(r.investor_id, x);
    }
    for (const r of n ?? []) notes.set(r.investor_id, (notes.get(r.investor_id) ?? 0) + 1);
  }
  const names = new Map((investors ?? []).map((i) => [i.id, i.full_name]));

  return {
    decks: deckRows,
    current,
    investors: (investors ?? []).map((i) => ({
      id: i.id,
      name: i.full_name,
      email: i.email,
      signedUpAt: i.created_at,
      acceptedAt: i.disclaimer_accepted_at,
      disclaimerVersion: i.disclaimer_version,
      accreditedAt: i.accredited_confirmed_at,
      referredBy: i.referred_by ? names.get(i.referred_by) ?? null : null,
      lastSeenAt: i.last_seen_at,
      revokedAt: i.revoked_at,
      seconds: time.get(i.id)?.seconds ?? 0,
      slidesViewed: time.get(i.id)?.slides ?? 0,
      notes: notes.get(i.id) ?? 0,
    })),
  };
}

export interface InvestorDetail {
  investor: InvestorRow;
  slides: Array<{ deckId: string; deckTitle: string; current: boolean; page: number; seconds: number; firstViewedAt: string | null; lastViewedAt: string | null; note: string | null; noteUpdatedAt: string | null }>;
  linksSent: number;
  firstOpenedAt: string | null;
}

export async function getInvestorDetail(investorId: string): Promise<InvestorDetail | null> {
  const overview = await getInvestorOverview();
  const investor = overview.investors.find((i) => i.id === investorId);
  if (!investor) return null;
  const supabase = await createClient();
  const [{ data: time }, { data: notes }] = await Promise.all([
    supabase.from("investor_slide_time").select("deck_id, page, seconds, first_viewed_at, last_viewed_at").eq("investor_id", investorId),
    supabase.from("investor_notes").select("deck_id, page, body, updated_at").eq("investor_id", investorId),
  ]);
  const decks = new Map(overview.decks.map((d) => [d.id, d]));
  const rows = new Map<string, InvestorDetail["slides"][number]>();
  const key = (deck: string, page: number) => `${deck}:${page}`;
  const row = (deckId: string, page: number) => {
    const k = key(deckId, page);
    if (!rows.has(k)) {
      rows.set(k, {
        deckId,
        deckTitle: decks.get(deckId)?.title ?? "Deck",
        current: deckId === overview.current?.id,
        page,
        seconds: 0,
        firstViewedAt: null,
        lastViewedAt: null,
        note: null,
        noteUpdatedAt: null,
      });
    }
    return rows.get(k)!;
  };
  // Every slide of the current deck, viewed or not; earlier decks only where there's something.
  if (overview.current) for (let p = 1; p <= overview.current.pageCount; p++) row(overview.current.id, p);
  for (const t of time ?? []) Object.assign(row(t.deck_id, t.page), { seconds: t.seconds, firstViewedAt: t.first_viewed_at, lastViewedAt: t.last_viewed_at });
  for (const n of notes ?? []) Object.assign(row(n.deck_id, n.page), { note: n.body, noteUpdatedAt: n.updated_at });

  // Links are server-only; the console reads them with its own key.
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const { data: links } = await createAdminClient().from("investor_links").select("first_opened_at").eq("investor_id", investorId);
  const opened = (links ?? []).map((l) => l.first_opened_at).filter(Boolean).sort() as string[];

  return {
    investor,
    slides: [...rows.values()].sort((a, b) => (a.current === b.current ? (a.deckId === b.deckId ? a.page - b.page : a.deckId < b.deckId ? -1 : 1) : a.current ? -1 : 1)),
    linksSent: links?.length ?? 0,
    firstOpenedAt: opened[0] ?? null,
  };
}
