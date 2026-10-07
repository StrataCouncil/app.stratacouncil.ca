import { type NextRequest } from "next/server";
import { IS_DEMO } from "@/lib/demo";
import { wipeExpiredVisitors } from "@/lib/demo-server";

/**
 * The demo site's nightly clean-up, called by Vercel Cron (vercel.json)
 * just after midnight Pacific: every visitor whose link has expired loses
 * their strata and account. Vercel sends CRON_SECRET (a variable on the
 * demo project) as a bearer token; anything else is turned away. On the
 * live site this does nothing.
 */
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!IS_DEMO) return new Response("Not found", { status: 404 });
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const result = await wipeExpiredVisitors();
  return Response.json(result, { status: result.failed ? 500 : 200 });
}
