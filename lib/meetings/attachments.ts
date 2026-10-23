import type { SupabaseClient } from "@supabase/supabase-js";
import { reconcileAttachments, type AgendaItem, type AttachmentTarget } from "@/lib/meetings/agenda";

/**
 * Check an agenda's attachments against the strata's documents before it's
 * saved (reconcileAttachments): an agenda item can attach any document the
 * strata has, and nothing else. Read with the member's own client, so RLS
 * decides what "the strata's documents" are.
 */
export async function checkAttachments(supabase: SupabaseClient, corpId: string, agenda: AgendaItem[]): Promise<AgendaItem[]> {
  const ids = [...new Set(agenda.flatMap((it) => it.atts.map((a) => a.documentId).filter((x): x is string => Boolean(x))))];
  const targets = new Map<string, AttachmentTarget>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase
      .from("documents")
      .select("id, title, file_name, source_type, url")
      .eq("corporation_id", corpId)
      .in("id", ids.slice(i, i + 200));
    if (error) throw new Error(`Couldn't check the attachments: ${error.message}`);
    for (const d of data ?? []) {
      targets.set(d.id as string, {
        title: (d.title as string | null) || (d.file_name as string | null) || "Attachment",
        kind: d.source_type === "link" ? "link" : "document",
        url: (d.url as string | null) ?? null,
      });
    }
  }
  return reconcileAttachments(agenda, targets);
}
