import type { LiveState } from "@/lib/meetings/live";
import type { VideoJoin } from "@/app/strata/[corpId]/meetings/[meetingId]/live/actions";

/**
 * The live screens' background requests (app/api/meetings/[meetingId]/…).
 * Plain fetches, so they never queue in front of the page's server actions.
 * Null when the request fails; the next refresh tries again.
 */
export async function fetchLiveState(meetingId: string): Promise<LiveState | null> {
  try {
    const res = await fetch(`/api/meetings/${encodeURIComponent(meetingId)}/live`, { cache: "no-store" });
    return res.ok ? ((await res.json()) as LiveState | null) : null;
  } catch {
    return null;
  }
}

export async function checkInAsRunner(meetingId: string): Promise<void> {
  await fetch(`/api/meetings/${encodeURIComponent(meetingId)}/live`, { method: "POST" }).catch(() => undefined);
}

export async function fetchVideoJoin(meetingId: string): Promise<VideoJoin> {
  const res = await fetch(`/api/meetings/${encodeURIComponent(meetingId)}/video`, { method: "POST" });
  if (!res.ok) throw new Error(`video ${res.status}`);
  return (await res.json()) as VideoJoin;
}
