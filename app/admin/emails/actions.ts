"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/data/admin";
import { createAdminClient } from "@/lib/supabase/admin";

const JOURNEYS = ["signup"] as const;

/**
 * Turn a lifecycle journey on or off (0086). Turning it on stamps
 * turned_on_at, so only people who confirm their email from now on are
 * in it: existing accounts are never emailed by switching it on.
 */
export async function setJourney(journey: string, enabled: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await requireSuperAdmin();
  if (!ctx) return { ok: false, error: "Only a Super Admin can do that." };
  if (!(JOURNEYS as readonly string[]).includes(journey)) return { ok: false, error: "Unknown journey." };
  const now = new Date().toISOString();
  const { error } = await createAdminClient()
    .from("email_journeys")
    .update({ enabled, ...(enabled ? { turned_on_at: now } : {}), changed_by: ctx.user.id, changed_at: now })
    .eq("journey", journey);
  if (error) {
    console.error("[setJourney]", error.message);
    return { ok: false, error: "Couldn't save. Run migration 0086 if it hasn't been run." };
  }
  revalidatePath("/admin/emails");
  return { ok: true };
}
