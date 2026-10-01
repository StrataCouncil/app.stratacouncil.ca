import { NextResponse } from "next/server";
import { getMeeting } from "@/lib/data/meetings";
import { minutesPdf } from "@/lib/exports/minutes-pdf";
import { exportFileName } from "@/lib/exports/agenda-docx";
import type { MinutesContent } from "@/lib/meetings/minutes";
import { createClient } from "@/lib/supabase/server";

/** Final minutes as a PDF. Only once finalized — a draft exports as .docx. */
export async function GET(_req: Request, { params }: { params: Promise<{ corpId: string; meetingId: string }> }) {
  const { corpId, meetingId } = await params;
  const meeting = await getMeeting(corpId, meetingId);
  if (!meeting?.minutesContent || meeting.minutesState !== "FINAL") return new NextResponse("Not found", { status: 404 });
  const supabase = await createClient();
  const { data } = await supabase.from("meetings").select("minutes_finalized_at").eq("id", meetingId).maybeSingle();
  const pdf = await minutesPdf(meeting.minutesContent as MinutesContent, { finalizedAt: data?.minutes_finalized_at ?? null });
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${exportFileName(corpId, meeting.type, meeting.meetingDate, "MINUTES", "pdf")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
