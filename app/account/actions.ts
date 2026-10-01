"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * The one real write AccountSettings makes in this pass — phone has no
 * verification requirement (unlike email, doc01 §7 item 26, still open),
 * so it's a plain authenticated update to the signed-in user's own
 * `profiles` row. RLS's "update own profile" policy (0005_rls.sql) is
 * the actual authorization check here; this just supplies the auth.uid()
 * context via the request-scoped client.
 */
export async function updatePhone(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");

  const phone = String(formData.get("phone") ?? "").trim();

  const { error } = await supabase
    .from("profiles")
    .update({ phone: phone || null })
    .eq("id", user.id);

  if (error) throw new Error(error.message);
  revalidatePath("/account");
}
