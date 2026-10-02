import { createClient } from "@/lib/supabase/server";
import type { StratasphereSource } from "@/lib/ai/stratasphere";

/**
 * The signed-in person's own Stratasphere history for one strata (0019).
 * RLS limits every read to the owner, so nothing here filters by user.
 */
export interface ConversationSummary {
  id: string;
  title: string;
  pinned: boolean;
  projectId: string | null;
  updatedAt: string;
}

export interface ConversationProject {
  id: string;
  name: string;
}

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources: StratasphereSource[];
  createdAt: string;
}

export async function listConversations(corpId: string) {
  const supabase = await createClient();
  const [{ data: convos }, { data: projects }] = await Promise.all([
    supabase
      .from("conversations")
      .select("id, title, pinned, project_id, updated_at")
      .eq("corporation_id", corpId)
      .order("updated_at", { ascending: false })
      .limit(500),
    supabase
      .from("conversation_projects")
      .select("id, name")
      .eq("corporation_id", corpId)
      .order("created_at", { ascending: true }),
  ]);
  return {
    conversations: (convos ?? []).map(
      (c): ConversationSummary => ({
        id: c.id,
        title: c.title,
        pinned: c.pinned,
        projectId: c.project_id,
        updatedAt: c.updated_at,
      })
    ),
    projects: (projects ?? []) as ConversationProject[],
  };
}
