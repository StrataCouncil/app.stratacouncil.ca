"use server";

import { randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStrataAccess } from "@/lib/data/strata";
import { getCurrentProfile } from "@/lib/data/profile";
import { APP_URL } from "@/lib/app-url";
import { IS_DEMO, demoLimitFail } from "@/lib/demo";
import { sendTransactionalEmail } from "@/lib/email/mailtrap";
import { documentExportEmail } from "@/lib/email/templates";
import { EXPORT_LINK_HOURS, hashExportToken } from "@/lib/document-export";

/**
 * "Download everything" (0062), for the strata's Admin: we email them a
 * link that works once, for 24 hours, and only while they're signed in.
 * Opening it builds the ZIP in their browser (export/page.tsx).
 */

const MAX_PER_HOUR = 3;

export async function requestDocumentExport(corpId: string): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  if (IS_DEMO) return demoLimitFail();
  const access = await getStrataAccess(corpId);
  if (!access?.isAdmin) return { ok: false, error: "Only the strata's Admin can download everything." };
  const profile = await getCurrentProfile();
  if (!profile?.email) return { ok: false, error: "We couldn't find your email address." };

  const admin = createAdminClient();
  const { count } = await admin
    .from("document_exports")
    .select("id", { count: "exact", head: true })
    .eq("corporation_id", access.corpId)
    .eq("requested_by", access.userId)
    .gt("created_at", new Date(Date.now() - 3600_000).toISOString());
  if ((count ?? 0) >= MAX_PER_HOUR) return { ok: false, error: "We've sent several links in the last hour. Please check your email." };

  const token = randomBytes(32).toString("base64url");
  const { error } = await admin.from("document_exports").insert({
    corporation_id: access.corpId,
    requested_by: access.userId,
    token_hash: hashExportToken(token),
    expires_at: new Date(Date.now() + EXPORT_LINK_HOURS * 3600_000).toISOString(),
  });
  if (error) {
    console.error("[requestDocumentExport]", error.message);
    return { ok: false, error: "Something went wrong. Please try again." };
  }

  const { data: corp } = await admin.from("strata_corporations").select("legal_name, building_name").eq("strata_plan_number", access.corpId).maybeSingle();
  const strataName = corp?.building_name || corp?.legal_name || access.corpId;
  const mail = documentExportEmail({
    name: profile.fullName || "there",
    strataName,
    openUrl: `${APP_URL}/strata/${encodeURIComponent(access.corpId)}/documents/export?t=${token}`,
  });
  try {
    await sendTransactionalEmail({ to: profile.email, ...mail });
  } catch (err) {
    console.error("[requestDocumentExport] email", err instanceof Error ? err.message : err);
    return { ok: false, error: "We couldn't send the email. Please try again." };
  }
  return { ok: true, email: profile.email };
}
