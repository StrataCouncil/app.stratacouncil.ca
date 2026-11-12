"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManageBilling } from "@/lib/auth/strata-admin";
import { sendTransactionalEmail } from "@/lib/email/mailtrap";
import { enterpriseRequestEmail } from "@/lib/email/templates";
import { APP_URL } from "@/lib/app-url";
import { IS_DEMO } from "@/lib/demo";

/**
 * "Talk to us" (Enterprise, 0091): from a strata's billing page, by anyone
 * who manages its billing. Recorded for the Super Admin console and emailed
 * to the Super Admins. One open request per strata and reason at a time.
 */
export async function requestEnterprise(
  corporationId: string,
  reason: "large" | "several",
  message: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (IS_DEMO) return { ok: false, error: "The demo doesn't send enquiries. Create your free account to talk to us." };
  if (reason !== "large" && reason !== "several") return { ok: false, error: "Please try again." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  if (!(await canManageBilling(supabase, corporationId))) {
    return { ok: false, error: "Only this strata's admin, or someone they've given billing access to, can ask about Enterprise." };
  }
  const text = String(message ?? "").trim().slice(0, 2000);
  const admin = createAdminClient();
  const { data: open } = await admin
    .from("enterprise_requests")
    .select("id")
    .eq("corporation_id", corporationId)
    .eq("reason", reason)
    .is("handled_at", null)
    .limit(1);
  if (open?.length) return { ok: true };

  const [{ data: corp }, { data: me }] = await Promise.all([
    admin.from("strata_corporations").select("building_name, legal_name, unit_count").eq("strata_plan_number", corporationId).maybeSingle(),
    admin.from("profiles").select("full_name, email").eq("id", user.id).maybeSingle(),
  ]);
  if (!corp) return { ok: false, error: "That strata no longer exists." };
  const { error } = await admin.from("enterprise_requests").insert({ corporation_id: corporationId, user_id: user.id, reason, message: text });
  if (error) {
    console.error("[requestEnterprise]", error.message);
    return { ok: false, error: "Couldn't send that. Please try again." };
  }

  const { data: staff } = await admin.from("profiles").select("email").eq("is_super_admin", true);
  const email = enterpriseRequestEmail({
    corporationName: (corp.building_name || corp.legal_name) as string,
    strataPlanNumber: corporationId,
    lots: corp.unit_count as number,
    reason,
    requesterName: (me?.full_name as string | null) ?? null,
    requesterEmail: (me?.email as string) ?? user.email ?? "",
    message: text,
    consoleUrl: `${APP_URL}/admin/${encodeURIComponent(corporationId)}`,
  });
  for (const s of staff ?? []) {
    if (!s.email) continue;
    await sendTransactionalEmail({ to: s.email as string, ...email, category: "enterprise" }).catch((err) =>
      console.error("[requestEnterprise] email", err instanceof Error ? err.message : err)
    );
  }
  return { ok: true };
}
