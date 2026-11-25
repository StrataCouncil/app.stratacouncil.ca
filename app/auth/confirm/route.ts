import { type EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/safe-next";

/**
 * Lands the click from the magic-link email `sendOtp()` sends (doc03
 * Stage 2). Supabase's email template links here with `token_hash` +
 * `type` query params; verifyOtp() exchanges them for a real session,
 * setting the auth cookies via server.ts's cookie handlers. From here on
 * this is just a redirect target, not a page — nothing to render either
 * way.
 *
 * `next` sends the user on to the page they were sent to sign in for (an
 * email's vote button, a Library item's link) instead of the dashboard,
 * for a new account as much as a sign-in: the login and sign-up pages
 * both carry it into the email's link (lib/auth/auth-links.ts).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  // Only a path on this site: a link with "next=https://…" mustn't sign
  // someone in and then send them elsewhere.
  const next = safeNext(searchParams.get("next"));

  if (token_hash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });

    if (!error) {
      redirect(next);
    }

    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  redirect("/login?error=Missing%20or%20invalid%20confirmation%20link");
}
