import { IS_DEMO } from "@/lib/demo";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * The signed-in person's activity, for the Super Admin console's Users tab
 * (0069). Server only, and only after the caller has checked the person's
 * access to the strata. What happened and when, never content: a guide's
 * title, a document's category (its own title can name an owner), the file
 * exported. Never Stratasphere conversations. Logging never fails the
 * request it's part of. The demo site keeps its own log (lib/demo-usage.ts).
 */

export type UserActivityKind =
  | "guide_opened"
  | "template_downloaded"
  | "document_viewed"
  | "document_downloaded"
  | "agenda_downloaded"
  | "minutes_downloaded";

export interface UserActivityEvent {
  kind: UserActivityKind;
  strata: string;
  ref?: string | null;
  label?: string | null;
}

export async function logUserActivity(event: UserActivityEvent) {
  if (IS_DEMO) return;
  try {
    const {
      data: { user },
    } = await (await createClient()).auth.getUser();
    if (!user) return;
    const { error } = await createAdminClient()
      .from("user_activity")
      .insert({
        user_id: user.id,
        kind: event.kind,
        strata: event.strata,
        ref: event.ref?.slice(0, 100) ?? null,
        label: event.label?.slice(0, 200) ?? null,
      });
    if (error) console.error("[logUserActivity]", error.message);
  } catch (e) {
    console.error("[logUserActivity]", e instanceof Error ? e.message : e);
  }
}
