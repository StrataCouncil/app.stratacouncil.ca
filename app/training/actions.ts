"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { DEMO_TRACK, IS_DEMO } from "@/lib/demo";
import { logDemoActivity } from "@/lib/demo-usage";

/**
 * Records a finished section (0033's complete_training_section): completes
 * the module when every section is done, and records the track credential
 * when every module in the track is published and done.
 */
export async function completeSection(
  moduleId: string,
  version: number,
  sectionId: string
): Promise<{ ok: true; moduleComplete: boolean; credentialEarned: boolean } | { ok: false; error: string }> {
  const supabase = await createClient();
  // The demo offers Strata Basics only; the other tracks stay locked.
  if (IS_DEMO) {
    const { data: m } = await supabase.from("training_modules").select("track:training_tracks(code)").eq("id", moduleId).maybeSingle();
    const track = (Array.isArray(m?.track) ? m?.track[0] : m?.track) as { code?: string } | null | undefined;
    if (track?.code !== DEMO_TRACK) return { ok: false, error: "The demo includes Strata Basics only." };
  }
  const { data, error } = await supabase.rpc("complete_training_section", {
    p_module_id: moduleId,
    p_version: version,
    p_section_id: sectionId,
  });
  if (error) {
    console.error("[completeSection]", error.message);
    return { ok: false, error: "Couldn't save your progress. Check your connection and try again." };
  }
  revalidatePath("/training", "layout");
  revalidatePath("/");
  const r = data as { moduleComplete: boolean; credentialEarned: boolean };
  if (IS_DEMO) {
    const [{ data: mod }, { data: ver }] = await Promise.all([
      supabase.from("training_modules").select("title").eq("id", moduleId).maybeSingle(),
      supabase.from("training_module_versions").select("content").eq("module_id", moduleId).eq("version", version).maybeSingle(),
    ]);
    const sections = ((ver?.content as { sections?: Array<{ id: string; title?: string }> } | null)?.sections ?? []);
    await logDemoActivity({
      kind: "training.section",
      detail: { module: mod?.title ?? moduleId, section: sections.find((x) => x.id === sectionId)?.title ?? sectionId, moduleComplete: Boolean(r.moduleComplete), credentialEarned: Boolean(r.credentialEarned) },
    });
  }
  return { ok: true, moduleComplete: Boolean(r.moduleComplete), credentialEarned: Boolean(r.credentialEarned) };
}
