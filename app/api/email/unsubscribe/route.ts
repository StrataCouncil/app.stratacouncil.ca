import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * One-click unsubscribe (the List-Unsubscribe-Post header on lifecycle
 * emails, RFC 8058): mail apps POST here when someone presses their
 * Unsubscribe button. Stops setup tips only; sign-in links, security
 * notices, invitations, and meeting and discussion emails carry on.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("t") ?? "";
  if (!UUID.test(token)) return new NextResponse(null, { status: 400 });
  const { error } = await createAdminClient().rpc("unsubscribe_setup_tips", { token });
  if (error) {
    console.error("[unsubscribe] one-click:", error.message);
    return new NextResponse(null, { status: 500 });
  }
  return new NextResponse(null, { status: 200 });
}
