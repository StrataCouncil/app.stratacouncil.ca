import { type EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Lands the click from the magic-link email `sendOtp()` sends (doc03
 * Stage 2). Supabase's email template links here with `token_hash` +
 * `type` query params; verifyOtp() exchanges them for a real session,
 * setting the auth cookies via server.ts's cookie handlers. From here on
 * this is just a redirect target, not a page — nothing to render either
 * way.
 *
 * `next` lets a caller send the user somewhere other than the dashboard
 * after confirming (unused today, kept for when a deep link — e.g. an
 * invite — needs to survive the auth round-trip).
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/";

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
