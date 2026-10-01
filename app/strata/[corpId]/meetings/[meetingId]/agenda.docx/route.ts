import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMeeting } from "@/lib/data/meetings";
import { agendaDocx, exportFileName } from "@/lib/exports/agenda-docx";

/** Agenda export (.docx). Any member can download the agenda (RLS: members read meetings). */
export async function GET(_req: Request, { params }: { params: Promise<{ corpId: string; meetingId: string }> }) {
  const { corpId, meetingId } = await params;
  const meeting = await getMeeting(corpId, meetingId);
  if (!meeting) return new NextResponse("Not found", { status: 404 });
  const supabase = await createClient();
  const { data: corp } = await supabase
    .from("strata_corporations")
    .select("strata_plan_number, legal_name, building_name")
    .eq("strata_plan_number", corpId)
    .maybeSingle();
  if (!corp) return new NextResponse("Not found", { status: 404 });

  const buffer = await agendaDocx({
    corporation: { planNumber: corp.strata_plan_number, name: corp.building_name || corp.legal_name },
    meeting,
    agenda: meeting.agenda,
  });
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${exportFileName(corp.strata_plan_number, meeting.type, meeting.meetingDate, "AGENDA", "docx")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
