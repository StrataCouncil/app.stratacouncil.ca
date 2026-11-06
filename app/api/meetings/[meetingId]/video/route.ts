import { NextResponse, type NextRequest } from "next/server";
import { getVideoJoin } from "@/app/strata/[corpId]/meetings/[meetingId]/live/actions";
import { sameOrigin } from "@/lib/meetings/same-origin";

/**
 * Join details for the meeting's video (Zoom Video SDK): a token for this
 * person. A plain request, not a server action, so it never holds up clicks
 * on the page. POST, since it issues a credential.
 */
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ meetingId: string }> }) {
  if (!sameOrigin(request)) return new NextResponse(null, { status: 403 });
  const { meetingId } = await params;
  const join = await getVideoJoin(meetingId);
  return NextResponse.json(join, { headers: { "Cache-Control": "no-store" } });
}
