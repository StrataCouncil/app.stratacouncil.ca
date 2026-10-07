import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgendaItem, Attachment } from "@/lib/meetings/agenda";
import { exportFileName, meetingDocumentName } from "@/lib/exports/filename";
import { kitDates, longDate } from "./dates";
import { kitDocuments } from "./documents";
import { kitMeetings } from "./meetings";

/** The title the held meetings' minutes are filed under (build.ts). */
export const kitMinutesTitle = (date: string) => `Minutes - Strata Council Meeting, ${longDate(date)}`;

/**
 * The agenda of the meeting a demo visitor creates: the strata's next
 * council meeting, already written, with its attachments pointing at the
 * strata's own copies of the kit's documents (found by file name). Only
 * New Business: Roof Repairs is the visitor's to edit (DEMO_EDITABLE_ITEM_ID).
 */
export async function demoMeetingAgenda(admin: SupabaseClient, corpId: string, now: Date = new Date()): Promise<AgendaItem[]> {
  const d = kitDates(now);
  const upcoming = kitMeetings(d).find((m) => !m.held)!;
  const { data: corp } = await admin.from("strata_corporations").select("legal_name").eq("strata_plan_number", corpId).single();
  const docs = kitDocuments(d, (corp?.legal_name as string) ?? "");

  const files = new Map<string, { fileName: string; title: string }>();
  for (const doc of docs) files.set(doc.key, { fileName: doc.fileName, title: doc.title });
  for (const m of kitMeetings(d).filter((x) => x.held)) {
    files.set(`minutes:${m.key}`, {
      fileName: exportFileName(corpId, m.date, meetingDocumentName("council", "Minutes"), "pdf"),
      title: kitMinutesTitle(m.date),
    });
  }

  const wanted = [...new Set(Object.values(upcoming.attachments).flat())].map((k) => files.get(k)).filter((f): f is { fileName: string; title: string } => Boolean(f));
  const { data: rows } = await admin
    .from("documents")
    .select("id, file_name")
    .eq("corporation_id", corpId)
    .in(
      "file_name",
      wanted.map((f) => f.fileName)
    );
  const idByFile = new Map((rows ?? []).map((r) => [r.file_name as string, r.id as string]));

  return upcoming.agenda.map((it) => ({
    ...it,
    atts: (upcoming.attachments[it.id] ?? []).flatMap((key): Attachment[] => {
      const f = files.get(key);
      const documentId = f && idByFile.get(f.fileName);
      return f && documentId ? [{ id: `a_${documentId}`, kind: "document", documentId, title: f.title }] : [];
    }),
  }));
}
