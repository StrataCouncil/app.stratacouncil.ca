import { NextResponse, type NextRequest } from "next/server";
import { APP_URL } from "@/lib/app-url";
import { safeNext } from "@/lib/safe-next";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * A lifecycle email's link (lib/lifecycle/run.ts): counts the first click
 * on that email, then goes on to the page. Only ever to a page of this
 * app (a path starting with one "/"), so it can't be used to send people
 * elsewhere.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest, { params }: { params: Promise<{ sendId: string }> }) {
  const { sendId } = await params;
  const path = safeNext(request.nextUrl.searchParams.get("to"));
  if (UUID.test(sendId)) {
    await createAdminClient()
      .from("email_sends")
      .update({ clicked_at: new Date().toISOString() })
      .eq("id", sendId)
      .is("clicked_at", null)
      .then(
        () => undefined,
        () => undefined
      );
  }
  return NextResponse.redirect(new URL(path, APP_URL), 303);
}
