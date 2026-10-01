"use server";

import { redirect } from "next/navigation";
import { safeNext } from "@/lib/safe-next";
import { createClient } from "@/lib/supabase/server";

export type SaveNameState = { error: string | null };

/**
 * The one in-app step a brand-new invitee sees after clicking their invite
 * link (doc01 §4a): their account was created by `generateLink()` with no
 * name, so they give it here before landing in the strata. An ordinary
 * update to their own profiles row — RLS "update own profile" (0005) is
 * the authorization. Only fills an empty name; it never overwrites one,
 * since full_name locks once a training module is completed.
 */
export async function saveName(_prev: SaveNameState, formData: FormData): Promise<SaveNameState> {
  const fullName = String(formData.get("full_name") ?? "").trim();
  const next = safeNext(String(formData.get("next") ?? ""));
  if (fullName.length < 2) return { error: "Enter your full name." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { error } = await supabase
    .from("profiles")
    .update({ full_name: fullName })
    .eq("id", user.id)
    .eq("full_name", "");

  if (error) {
    console.error("[saveName]", error.message);
    return { error: "Couldn't save your name. Please try again." };
  }

  redirect(next);
}
