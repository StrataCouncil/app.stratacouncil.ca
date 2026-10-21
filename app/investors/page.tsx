import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { IS_DEMO } from "@/lib/demo";
import { referralId } from "@/lib/investors/briefing";
import { currentInvestor } from "@/lib/investors/session";
import { InvestorSignup } from "@/components/investors/InvestorSignup";

export const metadata: Metadata = {
  title: "Investor briefing · StrataCouncil.ca",
  robots: { index: false, follow: false },
};

/**
 * The investor briefing's sign-up (0061), linked from the Coming soon
 * page and from Share inside the briefing. Someone already signed in goes
 * straight to the deck.
 */
export default async function InvestorsPage({ searchParams }: { searchParams: Promise<{ ref?: string; link?: string }> }) {
  if (IS_DEMO) notFound();
  if (await currentInvestor()) redirect("/investors/deck");
  const params = await searchParams;
  return <InvestorSignup referral={referralId(params.ref)} linkExpired={params.link === "expired"} />;
}
