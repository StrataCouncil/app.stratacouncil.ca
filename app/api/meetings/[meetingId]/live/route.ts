import { NextResponse, type NextRequest } from "next/server";
import { getLiveState, runnerCheckIn } from "@/app/strata/[corpId]/meetings/[meetingId]/live/actions";
import { sameOrigin } from "@/lib/meetings/same-origin";

/**
 * The live meeting screens' refreshes, as plain requests rather than server
 * actions. A page runs its server actions one at a time, so polling through
 * them made every click (marking someone present, recording a vote) wait
 * behind the last refresh. These run alongside clicks instead.
 *
 * GET: the live state (who may follow is checked by the database, as before).
 * POST: the Runner's screen checking in (0079).
 */
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ meetingId: string }> };

export async function GET(_request: NextRequest, { params }: Ctx) {
  const { meetingId } = await params;
  const state = await getLiveState(meetingId);
  return NextResponse.json(state, { status: state ? 200 : 404, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest, { params }: Ctx) {
  if (!sameOrigin(request)) return new NextResponse(null, { status: 403 });
  const { meetingId } = await params;
  await runnerCheckIn(meetingId);
  return new NextResponse(null, { status: 204 });
}
