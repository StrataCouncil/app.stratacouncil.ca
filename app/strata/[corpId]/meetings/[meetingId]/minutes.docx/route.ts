import { NextResponse } from "next/server";
import { getMeeting } from "@/lib/data/meetings";
import { minutesDocx } from "@/lib/exports/minutes-docx";
import { exportFileName, meetingDocumentName } from "@/lib/exports/filename";
import type { MinutesContent } from "@/lib/meetings/minutes";
import { loadLetterhead } from "@/lib/data/management";
import { logDemoActivity } from "@/lib/demo-usage";

/** Draft minutes as an editable .docx. Final minutes are the PDF. */
export async function GET(_req: Request, { params }: { params: Promise<{ corpId: string; meetingId: string }> }) {
  const { corpId, meetingId } = await params;
  const meeting = await getMeeting(corpId, meetingId);
  if (!meeting?.minutesContent) return new NextResponse("Not found", { status: 404 });
  const buffer = await minutesDocx(meeting.minutesContent as MinutesContent, {
    draft: meeting.minutesState !== "FINAL",
    letterhead: await loadLetterhead(corpId),
  });
  await logDemoActivity({ kind: "meeting.exported", detail: { meetingId, file: "minutes.docx" } });
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${exportFileName(corpId, meeting.meetingDate, meetingDocumentName(meeting.type, meeting.minutesState === "FINAL" ? "Minutes" : "Draft Minutes"), "docx")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
