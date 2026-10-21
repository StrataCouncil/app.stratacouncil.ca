import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { IS_DEMO } from "@/lib/demo";
import { currentDeck, currentInvestor, slideUrls } from "@/lib/investors/session";
import { InvestorBriefing } from "@/components/investors/InvestorBriefing";
import { APP_URL } from "@/lib/app-url";

export const metadata: Metadata = {
  title: "Investor briefing · StrataCouncil.ca",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

/** The deck (0061), for a signed-in investor: their notes, and the slide they were on. */
export default async function InvestorDeckPage() {
  if (IS_DEMO) notFound();
  const investor = await currentInvestor();
  if (!investor) redirect("/investors");
  const deck = await currentDeck();

  if (!deck) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <h1>Investor briefing</h1>
          <p>The briefing isn&rsquo;t available just now. Please check back soon.</p>
        </div>
      </div>
    );
  }

  const [urls, { data: notes }] = await Promise.all([
    slideUrls(deck),
    createAdminClient().from("investor_notes").select("page, body").eq("investor_id", investor.investorId).eq("deck_id", deck.id),
  ]);
  const start = investor.lastPage && investor.lastPage <= deck.pageCount ? investor.lastPage : 1;

  return (
    <InvestorBriefing
      deck={{ id: deck.id, pageCount: deck.pageCount, aspect: deck.aspect }}
      slides={urls}
      notes={Object.fromEntries((notes ?? []).map((n) => [n.page, n.body]))}
      startPage={start}
      viewer={{ name: investor.name, email: investor.email }}
      shareUrl={`${APP_URL}/investors?ref=${investor.investorId}`}
    />
  );
}
