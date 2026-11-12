import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Who can ask Stratasphere inside a meeting (unchanged from before PR 4b):
 * whoever is running it, until it's adjourned, and council members following
 * it while it's live (can_follow_meeting, 0073). The allowance itself
 * (subscription, role, hourly limit) is checked separately, as everywhere.
 */
export async function canAskInMeeting(
  supabase: SupabaseClient,
  userId: string,
  meeting: { id: string; status: string; launchedBy: string | null }
): Promise<boolean> {
  if (meeting.status === "ADJOURNED") return false;
  if (meeting.launchedBy === userId) return true;
  if (meeting.status !== "LIVE") return false;
  const { data } = await supabase.rpc("can_follow_meeting", { p_meeting_id: meeting.id });
  return data === true;
}

export const MEETING_ASSISTANT_REFUSAL =
  "The assistant is available to whoever is running this meeting, and to council members following it.";
