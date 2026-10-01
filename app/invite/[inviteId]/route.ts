import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Where an invite email's link lands, after /auth/confirm has signed the
 * invitee in (doc01 §1 — one email, one click). Accepting here rather than
 * showing an "Accept?" page is the point: the click in the email *was* the
 * acceptance. `accept_corporation_invite()` (0010) checks the invite's
 * email matches the signed-in account and is idempotent, so following the
 * link twice is harmless.
 *
 * Signed-out visitors never reach this — middleware sends them to /login.
 * If the email link itself expired, /auth/confirm already bounced them to
 * /login; once they sign in, /strata lists the still-pending invite.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ inviteId: string }> }
) {
  const { inviteId } = await params;
  const supabase = await createClient();

  const { data: corporationId, error } = await supabase.rpc("accept_corporation_invite", {
    p_invite_id: inviteId,
  });

  if (error || !corporationId) {
    console.error("[invite accept]", inviteId, error?.code, error?.message);
    const message =
      error?.code === "P0001" ? error.message : "That invitation link isn't valid.";
    redirect(`/strata?connect=1&error=${encodeURIComponent(message)}`);
  }

  redirect(`/strata/${corporationId}`);
}
