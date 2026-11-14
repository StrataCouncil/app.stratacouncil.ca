"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getStrataAccess } from "@/lib/data/strata";
import { detailChanges, detailsProblem, type StrataDetails } from "@/lib/strata-details";

/**
 * Edit details on the Overview (0096). Through the signed-in person's own
 * client: update_strata_details checks they're the strata's Admin (or a
 * Super Admin for the legal name, jurisdiction, and number of lots) and
 * logs each change.
 */
export async function updateStrataDetails(
  corpId: string,
  before: StrataDetails,
  after: StrataDetails
): Promise<{ ok: true } | { ok: false; error: string }> {
  const access = await getStrataAccess(corpId);
  if (!access?.isAdmin) return { ok: false, error: "Only the strata's Admin can change its details." };
  const problem = detailsProblem(after, access.isSuperAdmin);
  if (problem) return { ok: false, error: problem };
  const { patch } = detailChanges(before, after, access.isSuperAdmin);
  if (!Object.keys(patch).length) return { ok: true };

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_strata_details", { p_corporation_id: corpId, p_changes: patch });
  if (error) {
    console.error("[strata details]", error.code, error.message);
    // The function's own messages are written for people; anything else isn't.
    if (["P0001", "42501", "22023", "P0002"].includes(error.code ?? "")) return { ok: false, error: error.message };
    return { ok: false, error: "The details couldn't be saved. Try again." };
  }
  revalidatePath(`/strata/${corpId}`, "layout");
  return { ok: true };
}
