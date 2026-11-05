import { createAdminClient } from "@/lib/supabase/admin";
import { createZoomMeeting, endZoomMeeting, hostZak, zoomConfig, ZoomError, type ZoomConfig } from "@/lib/zoom/api";
import { newPasscode } from "@/lib/zoom/signature";

/**
 * The Zoom meeting behind a launched electronic or hybrid meeting (0080).
 * Only the server touches meeting_zoom (admin client); callers check first
 * that the person may follow the meeting.
 */
type ZoomRow = { id: number; zoom_meeting_id: string; passcode: string; host_email: string };

export async function openZoomMeeting(meetingId: string): Promise<ZoomRow | null> {
  const admin = createAdminClient();
  const { data } = await admin.from("meeting_zoom").select("id, zoom_meeting_id, passcode, host_email").eq("meeting_id", meetingId).is("ended_at", null).maybeSingle();
  return (data as ZoomRow | null) ?? null;
}

async function closeRow(cfg: ZoomConfig | null, row: ZoomRow) {
  const admin = createAdminClient();
  if (cfg) await endZoomMeeting(cfg, row.zoom_meeting_id);
  await admin.from("meeting_zoom").update({ ended_at: new Date().toISOString() }).eq("id", row.id).is("ended_at", null);
}

/** Frees host licences still tied to meetings that have since been adjourned (or deleted). */
async function freeStaleHosts(cfg: ZoomConfig) {
  const admin = createAdminClient();
  const { data: open } = await admin.from("meeting_zoom").select("id, zoom_meeting_id, passcode, host_email, meeting:meetings(status)").is("ended_at", null);
  for (const r of open ?? []) {
    const status = (r.meeting as { status?: string } | null)?.status;
    if (!status || status === "ADJOURNED") await closeRow(cfg, r as unknown as ZoomRow);
  }
}

export type EnsureResult = { ok: true; row: ZoomRow } | { ok: false; busy?: boolean; error: string };

/**
 * The meeting's Zoom meeting, created on a free host licence if there
 * isn't one yet (or a new one, when the Runner restarts the video after
 * Zoom has cut it off).
 */
export async function ensureZoomMeeting(cfg: ZoomConfig, input: { meetingId: string; topic: string; timezone: string; restart?: boolean }): Promise<EnsureResult> {
  const admin = createAdminClient();
  const current = await openZoomMeeting(input.meetingId);
  if (current && !input.restart) return { ok: true, row: current };
  if (current) await closeRow(cfg, current);

  await freeStaleHosts(cfg);
  const { data: busy } = await admin.from("meeting_zoom").select("host_email").is("ended_at", null);
  const taken = new Set((busy ?? []).map((b) => (b.host_email as string).toLowerCase()));
  const host = cfg.hosts.find((h) => !taken.has(h.toLowerCase()));
  if (!host) {
    return {
      ok: false,
      busy: true,
      error: "Video is busy: StrataCouncil's Zoom is hosting another meeting right now. The meeting can go ahead without video, or try again once it ends.",
    };
  }
  let created;
  try {
    created = await createZoomMeeting(cfg, host, { topic: input.topic, timezone: input.timezone, passcode: newPasscode() });
  } catch (err) {
    console.error("[ensureZoomMeeting] create", err instanceof ZoomError ? `${err.message} (${err.code ?? "-"})` : err instanceof Error ? err.message : err);
    return { ok: false, error: "Couldn't start the video. Try again; the meeting itself carries on." };
  }
  const { data: row, error } = await admin
    .from("meeting_zoom")
    .insert({ meeting_id: input.meetingId, zoom_meeting_id: created.zoomMeetingId, passcode: created.passcode, host_email: host })
    .select("id, zoom_meeting_id, passcode, host_email")
    .single();
  if (error || !row) {
    // Someone else's screen got there first (or the host was just taken): use theirs.
    await endZoomMeeting(cfg, created.zoomMeetingId);
    const theirs = await openZoomMeeting(input.meetingId);
    return theirs ? { ok: true, row: theirs } : { ok: false, error: "Couldn't start the video. Try again; the meeting itself carries on." };
  }
  return { ok: true, row: row as ZoomRow };
}

export async function zakFor(cfg: ZoomConfig, host: string): Promise<string | null> {
  try {
    return await hostZak(cfg, host);
  } catch (err) {
    console.error("[zakFor]", err instanceof Error ? err.message : err);
    return null;
  }
}

/** On adjournment: ends the Zoom meeting for everyone and frees its host. */
export async function endMeetingVideo(meetingId: string): Promise<void> {
  const row = await openZoomMeeting(meetingId).catch(() => null);
  if (row) await closeRow(zoomConfig(), row).catch((err) => console.error("[endMeetingVideo]", err instanceof Error ? err.message : err));
}
