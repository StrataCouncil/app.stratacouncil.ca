import { NextResponse, type NextRequest } from "next/server";
import { getVideoJoin } from "@/app/strata/[corpId]/meetings/[meetingId]/live/actions";
import { sameOrigin } from "@/lib/meetings/same-origin";

/**
 * Join details for the meeting's Zoom video (0080). A plain request, not a
 * server action: it can wait seconds on Zoom, and a server action would hold
 * up every click on the page meanwhile. POST, since the Runner's first call
 * creates the Zoom meeting; `?restart=1` replaces one Zoom has ended.
 */
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ meetingId: string }> }) {
  if (!sameOrigin(request)) return new NextResponse(null, { status: 403 });
  const { meetingId } = await params;
  const join = await getVideoJoin(meetingId, { restart: request.nextUrl.searchParams.get("restart") === "1" });
  return NextResponse.json(join, { headers: { "Cache-Control": "no-store" } });
}
