"use server";

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The "Stop setup tips" button on /unsubscribe. */
export async function stopSetupTips(formData: FormData) {
  const token = String(formData.get("t") ?? "");
  if (!UUID.test(token)) redirect("/unsubscribe?done=invalid");
  const { data, error } = await createAdminClient().rpc("unsubscribe_setup_tips", { token });
  if (error) {
    console.error("[unsubscribe] page:", error.message);
    redirect(`/unsubscribe?t=${token}&done=error`);
  }
  redirect(data ? "/unsubscribe?done=stopped" : "/unsubscribe?done=invalid");
}
