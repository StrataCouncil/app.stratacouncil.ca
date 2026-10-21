import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentDeck, currentInvestor } from "@/lib/investors/session";

/**
 * Viewing time from the investor briefing (0061): the page reports the
 * slide on screen and the seconds since its last report, every few
 * seconds and when the tab is hidden (navigator.sendBeacon). The session
 * cookie says who; each report is capped so an idle tab can't add hours.
 */
export async function POST(request: NextRequest) {
  const investor = await currentInvestor();
  if (!investor) return new NextResponse(null, { status: 401 });
  let body: { deckId?: unknown; page?: unknown; seconds?: unknown };
  try {
    body = JSON.parse(await request.text());
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  const deck = await currentDeck();
  const page = Number(body.page);
  const seconds = Math.round(Number(body.seconds));
  if (!deck || body.deckId !== deck.id || !Number.isInteger(page) || page < 1 || page > deck.pageCount) {
    return new NextResponse(null, { status: 400 });
  }
  if (!(seconds >= 0) || seconds > 600) return new NextResponse(null, { status: 400 });
  const { error } = await createAdminClient().rpc("investor_add_time", {
    p_investor: investor.investorId,
    p_deck: deck.id,
    p_page: page,
    p_seconds: seconds,
  });
  if (error) console.error("[investors/track]", error.message);
  return new NextResponse(null, { status: error ? 500 : 204 });
}
