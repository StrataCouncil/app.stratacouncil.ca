"use server";

import { APP_URL } from "@/lib/app-url";
import { getStrataAccess } from "@/lib/data/strata";
import { notifyUser } from "@/lib/email/notify";
import { subscriptionRequestEmail } from "@/lib/email/templates";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * "Request a subscription": a member asks the strata's admin(s) to
 * subscribe. Sent from the platform on the member's behalf, naming them.
 * The service-role client only reads who the admins are and the
 * requester's own name; nothing is written.
 */
export async function requestSubscription(corpId: string): Promise<{ ok: true; sentTo: number } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  const access = await getStrataAccess(corpId);
  if (!access) return { ok: false, error: "You're not connected to this strata." };
  if (access.subscribed) return { ok: false, error: "This strata is already subscribed." };

  const admin = createAdminClient();
  const [{ data: admins }, { data: corp }, { data: me }] = await Promise.all([
    admin.from("corporation_role_assignments").select("user_id").eq("corporation_id", access.corpId).eq("role", "admin"),
    admin.from("strata_corporations").select("building_name, legal_name").eq("strata_plan_number", access.corpId).maybeSingle(),
    admin.from("profiles").select("full_name, email").eq("id", user.id).maybeSingle(),
  ]);
  const recipients = (admins ?? []).map((a) => a.user_id as string).filter((id) => id !== user.id);
  if (!recipients.length) return { ok: false, error: "This strata doesn't have an admin to ask yet." };

  const message = subscriptionRequestEmail({
    corporationName: corp?.building_name || corp?.legal_name || access.corpId,
    requesterName: me?.full_name ?? "",
    requesterEmail: me?.email ?? user.email ?? "",
    billingUrl: `${APP_URL}/strata/${access.corpId}/billing`,
  });
  await Promise.all(recipients.map((id) => notifyUser(id, message)));
  return { ok: true, sentTo: recipients.length };
}
