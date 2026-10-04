import { createAdminClient } from "@/lib/supabase/admin";
import { notifyUser } from "@/lib/email/notify";
import { inviteAcceptedEmail } from "@/lib/email/templates";
import { APP_URL } from "@/lib/app-url";

/** Whether an invite is still pending, read before accepting it so the
 * admins are emailed once, not on every repeat click of the link. */
export async function inviteIsPending(inviteId: string) {
  const { data } = await createAdminClient()
    .from("corporation_invites")
    .select("status")
    .eq("id", inviteId)
    .maybeSingle();
  return data?.status === "pending";
}

/** Best effort: tell the corporation's admins someone joined by invite. */
export async function notifyInviteAccepted(corporationId: string, memberId: string) {
  try {
    const admin = createAdminClient();
    const [{ data: corp }, { data: member }, { data: admins }] = await Promise.all([
      admin
        .from("strata_corporations")
        .select("building_name, legal_name")
        .eq("strata_plan_number", corporationId)
        .single(),
      admin.from("profiles").select("full_name, email").eq("id", memberId).single(),
      admin.from("corporation_role_assignments").select("user_id").eq("corporation_id", corporationId).eq("role", "admin"),
    ]);
    if (!member) return;
    const message = inviteAcceptedEmail({
      corporationName: corp?.building_name ?? corp?.legal_name ?? corporationId,
      memberName: member.full_name?.trim() ?? "",
      memberEmail: member.email ?? "",
      openUrl: new URL(`/strata/${corporationId}/council`, APP_URL).toString(),
    });
    await Promise.all(
      (admins ?? []).filter((a) => a.user_id !== memberId).map((a) => notifyUser(a.user_id, message))
    );
  } catch (error) {
    console.error("[notifyInviteAccepted]", error);
  }
}
