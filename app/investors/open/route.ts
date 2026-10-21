import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { IS_DEMO } from "@/lib/demo";
import { SESSION_COOKIE } from "@/lib/investors/briefing";
import { hashToken, investorForToken } from "@/lib/investors/session";

/**
 * The emailed link (0061): checks the token, keeps it in an http-only
 * cookie for as long as the link works, and opens the briefing. Not
 * single-use, so an email scanner opening it first doesn't spoil it.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("t");
  if (IS_DEMO) return NextResponse.redirect(new URL("/", request.url));
  const investor = await investorForToken(token);
  if (!investor || !token) return NextResponse.redirect(new URL("/investors?link=expired", request.url));

  await createAdminClient()
    .from("investor_links")
    .update({ first_opened_at: new Date().toISOString() })
    .eq("token_hash", hashToken(token))
    .is("first_opened_at", null);

  const res = NextResponse.redirect(new URL("/investors/deck", request.url));
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(investor.expiresAt),
  });
  return res;
}
