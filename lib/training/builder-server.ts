import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/profile";
import { toSlides, type Citation, type MediaRow, type Slide, type SlideRow } from "@/lib/training/slides";

/**
 * The checks every Council Training builder write goes through (0041),
 * shared by the builder's actions and AI drafting. Server only.
 */

export type AdminClient = ReturnType<typeof createAdminClient>;

export async function staff() {
  const profile = await getCurrentProfile();
  return profile?.isSuperAdmin ? profile : null;
}

export async function canAuthor(moduleId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(moduleId)) return false;
  const supabase = await createClient();
  const { data } = await supabase.rpc("can_author_training_module", { p_module_id: moduleId });
  return data === true;
}

export const NOT_YOURS = "You're not editing this module any more: it was checked in from another window, or released by a Super Admin. Reload to see the latest.";

/**
 * The module, if it's checked out to the signed-in person in this window.
 * Every change goes through here first.
 */
export async function editing(moduleId: string, token: string): Promise<{ ok: true; userId: string; trackId: string; admin: AdminClient } | { ok: false; error: string }> {
  const profile = await getCurrentProfile();
  if (!profile || !(await canAuthor(moduleId))) return { ok: false, error: "You can't edit this module." };
  const admin = createAdminClient();
  const { data } = await admin.from("training_modules").select("track_id, checked_out_by, checkout_token").eq("id", moduleId).maybeSingle();
  if (!data) return { ok: false, error: "Module not found." };
  if (data.checked_out_by !== profile.id || data.checkout_token !== token) return { ok: false, error: NOT_YOURS };
  return { ok: true, userId: profile.id, trackId: data.track_id as string, admin };
}

export const SLIDE_COLUMNS = "id, position, topic, title, body, layout, narration_script, narration_voiced, element, citations";

export async function readSlide(admin: AdminClient, moduleId: string, slideId: string): Promise<Slide | null> {
  const [{ data: row }, { data: media }] = await Promise.all([
    admin.from("training_slides").select(SLIDE_COLUMNS).eq("id", slideId).eq("module_id", moduleId).maybeSingle(),
    admin.from("training_media").select("id, slide_id, role, kind, source, url, alt, credit").eq("slide_id", slideId),
  ]);
  return row ? toSlides([row as SlideRow], (media ?? []) as MediaRow[])[0] : null;
}

export function labelFor(documentTitle: string, label: string) {
  return label && label !== documentTitle ? `${documentTitle}, ${label}` : documentTitle;
}

/** Only sections that exist in the library, labelled the library's way. */
export async function verifiedCitations(chunkIds: string[]): Promise<Citation[]> {
  const ids = [...new Set(chunkIds)].slice(0, 8);
  const labels = await libraryLabels(ids);
  return ids.flatMap((id) => (labels.has(id) ? [{ chunkId: id, label: labels.get(id)! }] : []));
}

/** The library's current label for each section that still exists (so a renamed document shows its new name). */
export async function libraryLabels(chunkIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(chunkIds)];
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const admin = createAdminClient();
  const { data: chunks } = await admin.from("knowledge_chunks").select("id, title, legislation_document_id").in("id", ids).eq("scope", "legislation");
  const docIds = [...new Set((chunks ?? []).map((c) => c.legislation_document_id as string))];
  const { data: docs } = docIds.length ? await admin.from("legislation_documents").select("id, title").in("id", docIds) : { data: [] };
  const docBy = new Map((docs ?? []).map((d) => [d.id as string, d.title as string]));
  for (const c of chunks ?? []) {
    const doc = docBy.get(c.legislation_document_id as string);
    if (doc) out.set(c.id as string, labelFor(doc, (c.title as string | null) ?? ""));
  }
  return out;
}
