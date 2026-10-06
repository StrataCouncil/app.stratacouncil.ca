"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getDemoLink } from "@/lib/data/training-demo";

/**
 * A comment left from a Council Training demo link (0040). Anyone with a
 * working link can send one; it's checked against the link and stored for
 * Super Admins to read. Nothing else from a demo visit is saved.
 */
export async function submitDemoFeedback(input: {
  token: string;
  moduleId: string;
  moduleTitle: string;
  screenId: string | null;
  screenTitle: string;
  name: string;
  message: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const link = await getDemoLink(input.token);
  if (!link) return { ok: false, error: "This preview link has expired. Ask whoever sent it for a new one." };
  const message = input.message.trim().slice(0, 4000);
  if (!message) return { ok: false, error: "Write a comment first." };
  const admin = createAdminClient();
  // A ceiling per link, so a shared link can't be used to flood the table.
  const { count } = await admin.from("training_feedback").select("id", { count: "exact", head: true }).eq("link_id", link.id);
  if ((count ?? 0) >= 1000) return { ok: false, error: "This preview link has reached its comment limit. Thank you for all the feedback." };
  const moduleId = /^[0-9a-f-]{36}$/i.test(input.moduleId) ? input.moduleId : null;
  const { error } = await admin.from("training_feedback").insert({
    link_id: link.id,
    link_label: link.label,
    module_id: moduleId,
    module_title: input.moduleTitle.slice(0, 200),
    screen_id: input.screenId?.slice(0, 100) ?? null,
    screen_title: input.screenTitle.slice(0, 200),
    name: input.name.trim().slice(0, 120),
    message,
  });
  if (error) {
    console.error("[submitDemoFeedback]", error.message);
    return { ok: false, error: "Couldn't send that. Try again." };
  }
  return { ok: true };
}
