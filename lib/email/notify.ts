import { MailtrapSendError, sendTransactionalEmail } from "@/lib/email/mailtrap";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Best-effort app-triggered notification (doc04 §7a case 2) to a user by
 * profile id. Callers have already completed and authorized the action
 * being announced; a failed send is logged, never surfaced as a failure of
 * that action. Uses the service-role client only to read the recipient's
 * address, which RLS keeps from the acting user (profiles is read-own-row).
 */
export async function notifyUser(
  userId: string,
  message: { subject: string; html: string; text: string }
) {
  try {
    const { data: profile } = await createAdminClient()
      .from("profiles")
      .select("email")
      .eq("id", userId)
      .single();
    if (!profile?.email) {
      console.error("[notifyUser] no email on profile", userId);
      return;
    }
    await sendTransactionalEmail({ to: profile.email, ...message });
  } catch (error) {
    console.error(
      "[notifyUser] send failed:",
      error instanceof MailtrapSendError ? error.body : error
    );
  }
}
