import { after, type NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { IS_DEMO, isDemoToken } from "@/lib/demo";
import { openDemoLink, wipeExpiredVisitors } from "@/lib/demo-server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * A visitor's personal demo link (demo site only): sets up their account
 * and their own copy of the fictional strata the first time, signs them
 * in, and opens the strata. Works again (and on another device) until
 * midnight Pacific; then /demo explains that it has ended.
 */
export const maxDuration = 60;

export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  if (!IS_DEMO) return new Response("Not found", { status: 404 });
  const { token } = await params;
  if (!isDemoToken(token)) redirect("/demo?link=unknown");

  const opened = await openDemoLink(token);
  // Yesterday's visitors, if the nightly clean-up hasn't got to them yet.
  after(() => wipeExpiredVisitors().catch((err) => console.error("[start] clean-up:", err)));
  if (!opened.ok) redirect(`/demo?link=${opened.reason}`);

  // Sign in as the visitor: a one-time sign-in token, used straight away
  // (nothing is emailed).
  const { data: link, error: linkError } = await createAdminClient().auth.admin.generateLink({
    type: "magiclink",
    email: opened.email,
  });
  if (linkError || !link.properties?.hashed_token) {
    console.error("[start] sign-in link:", linkError?.message);
    redirect("/demo?link=busy");
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: link.properties.hashed_token,
  });
  if (error) {
    console.error("[start] sign-in:", error.message);
    redirect("/demo?link=busy");
  }

  redirect(`/strata/${opened.corporationId}`);
}
