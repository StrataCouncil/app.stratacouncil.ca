"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMeeting } from "@/lib/data/meetings";
import { getStrataAccess } from "@/lib/data/strata";
import { DOCUMENTS_BUCKET } from "@/lib/documents";
import type { MinutesContent } from "@/lib/meetings/minutes";
import { minutesPdf } from "@/lib/exports/minutes-pdf";
import { exportFileName } from "@/lib/exports/agenda-docx";
import { queueDocumentIndexing } from "@/lib/kb/queue";

type Fail = { ok: false; error: string };

function refresh(corpId: string, meetingId: string) {
  revalidatePath(`/strata/${corpId}/meetings/${meetingId}/minutes`);
  revalidatePath(`/strata/${corpId}/minutes`);
  revalidatePath(`/strata/${corpId}/meetings`);
}

/** Draft minutes: only the item summaries are editable; the record of votes isn't. */
export async function saveMinutesSummaries(
  corpId: string,
  meetingId: string,
  summaries: Record<string, string>
): Promise<{ ok: true } | Fail> {
  const access = await getStrataAccess(corpId);
  if (!access?.canRunMeetings) return { ok: false, error: "You can't edit these minutes." };
  const meeting = await getMeeting(corpId, meetingId);
  if (!meeting || meeting.status !== "ADJOURNED" || meeting.minutesState !== "DRAFT" || !meeting.minutesContent) {
    return { ok: false, error: "Only draft minutes can be edited." };
  }
  const content = structuredClone(meeting.minutesContent) as MinutesContent;
  for (const section of content.sections) {
    for (const item of section.items) {
      if (typeof summaries[item.id] === "string") item.summary = summaries[item.id].slice(0, 20000);
    }
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("meetings")
    .update({ minutes_content: content })
    .eq("id", meetingId)
    .eq("corporation_id", corpId)
    .eq("minutes_state", "DRAFT")
    .select("id");
  if (error || !data?.length) {
    if (error) console.error("[saveMinutesSummaries]", error.code, error.message);
    return { ok: false, error: "Couldn't save the minutes." };
  }
  refresh(corpId, meetingId);
  return { ok: true };
}

/**
 * Finalize: irreversible. The minutes lock, the meeting's private notes are
 * deleted, and the final PDF is stored in the repository (Meetings &
 * Records, shown on the Minutes tab) and indexed for Stratasphere.
 */
export async function finalizeMeetingMinutes(corpId: string, meetingId: string): Promise<{ ok: true } | Fail> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("finalize_minutes", { p_meeting_id: meetingId, p_minutes: null });
  if (error) {
    const known = /already final|Adjourn the meeting/.test(error.message);
    if (!known) console.error("[finalizeMeetingMinutes]", error.code, error.message);
    return { ok: false, error: known ? error.message : "Couldn't finalize the minutes." };
  }

  // Store the final PDF. Finalization already succeeded; if storing fails
  // the PDF is still generated on demand from the locked record.
  try {
    const meeting = await getMeeting(corpId, meetingId);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (meeting?.minutesContent && user) {
      const content = meeting.minutesContent as MinutesContent;
      const pdf = await minutesPdf(content, { finalizedAt: new Date().toISOString() });
      const fileName = exportFileName(corpId, meeting.type, meeting.meetingDate, "MINUTES", "pdf");
      const path = `${corpId}/${randomUUID()}/${fileName}`;
      const admin = createAdminClient();
      const { error: upErr } = await admin.storage.from(DOCUMENTS_BUCKET).upload(path, pdf, { contentType: "application/pdf" });
      if (upErr) throw new Error(upErr.message);
      const { data: doc, error: docErr } = await supabase
        .from("documents")
        .insert({
          corporation_id: corpId,
          category: "meetings_records",
          title: `Minutes — ${content.meeting.typeLabel}, ${meeting.meetingDate}`,
          file_name: fileName,
          mime_type: "application/pdf",
          size_bytes: pdf.byteLength,
          storage_path: `${DOCUMENTS_BUCKET}/${path}`,
          uploaded_by: user.id,
          source_type: "minutes",
          meeting_id: meetingId,
        })
        .select("id")
        .single();
      if (docErr || !doc) throw new Error(docErr?.message ?? "insert failed");
      await queueDocumentIndexing([doc.id]);
    }
  } catch (err) {
    console.error("[finalizeMeetingMinutes] storing PDF", err instanceof Error ? err.message : err);
  }

  refresh(corpId, meetingId);
  return { ok: true };
}
