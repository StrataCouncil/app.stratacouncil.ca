"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * Records a finished lesson (0033's complete_training_lesson): completes the
 * module when every lesson is done, and issues the track credential when
 * every module in the track is published and done.
 */
export async function completeLesson(
  moduleId: string,
  version: number,
  lessonId: string
): Promise<{ ok: true; moduleComplete: boolean; credentialEarned: boolean } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("complete_training_lesson", {
    p_module_id: moduleId,
    p_version: version,
    p_lesson_id: lessonId,
  });
  if (error) {
    console.error("[completeLesson]", error.message);
    return { ok: false, error: "Couldn't save your progress. Check your connection and try again." };
  }
  revalidatePath("/training", "layout");
  revalidatePath("/");
  const r = data as { moduleComplete: boolean; credentialEarned: boolean };
  return { ok: true, moduleComplete: Boolean(r.moduleComplete), credentialEarned: Boolean(r.credentialEarned) };
}
