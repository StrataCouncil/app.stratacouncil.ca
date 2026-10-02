"use server";

import { createClient } from "@/lib/supabase/server";
import type { StratasphereSource } from "@/lib/ai/stratasphere";
import type { ConversationMessage, ConversationProject } from "@/lib/data/conversations";

/**
 * Managing the signed-in person's own Stratasphere conversations (0019).
 * Every query runs through the user's client: RLS allows the owner only,
 * so another person's conversation simply isn't found. Questions and
 * answers themselves go through /api/stratasphere/chat.
 */

type Fail = { ok: false; error: string };
type Done = { ok: true } | Fail;

const notFound: Fail = { ok: false, error: "That conversation isn't available." };

export async function getConversationMessages(
  corpId: string,
  conversationId: string
): Promise<{ ok: true; messages: ConversationMessage[] } | Fail> {
  const supabase = await createClient();
  const { data: convo } = await supabase
    .from("conversations")
    .select("id")
    .eq("id", conversationId)
    .eq("corporation_id", corpId)
    .maybeSingle();
  if (!convo) return notFound;
  const { data, error } = await supabase
    .from("conversation_messages")
    .select("id, role, content, citations, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(1000);
  if (error) return { ok: false, error: "Couldn't load this conversation." };
  return {
    ok: true,
    messages: (data ?? []).map((m) => ({
      id: m.id,
      role: m.role as "user" | "assistant",
      content: m.content,
      sources: Array.isArray(m.citations) ? (m.citations as StratasphereSource[]) : [],
      createdAt: m.created_at,
    })),
  };
}

async function updateConversation(corpId: string, conversationId: string, patch: Record<string, unknown>): Promise<Done> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("conversations")
    .update(patch)
    .eq("id", conversationId)
    .eq("corporation_id", corpId)
    .select("id");
  if (error) {
    console.error("[conversations] update", error.message);
    return { ok: false, error: "Couldn't save that change." };
  }
  return data?.length ? { ok: true } : notFound;
}

export async function renameConversation(corpId: string, conversationId: string, title: string): Promise<Done> {
  const t = title.replace(/\s+/g, " ").trim().slice(0, 200);
  if (!t) return { ok: false, error: "Give the conversation a name." };
  return updateConversation(corpId, conversationId, { title: t });
}

export async function setConversationPinned(corpId: string, conversationId: string, pinned: boolean): Promise<Done> {
  return updateConversation(corpId, conversationId, { pinned });
}

export async function moveConversationToProject(
  corpId: string,
  conversationId: string,
  projectId: string | null
): Promise<Done> {
  return updateConversation(corpId, conversationId, { project_id: projectId });
}

export async function deleteConversation(corpId: string, conversationId: string): Promise<Done> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("conversations")
    .delete()
    .eq("id", conversationId)
    .eq("corporation_id", corpId)
    .select("id");
  if (error) {
    console.error("[conversations] delete", error.message);
    return { ok: false, error: "Couldn't delete that conversation." };
  }
  return data?.length ? { ok: true } : notFound;
}

export async function createProject(
  corpId: string,
  name: string
): Promise<{ ok: true; project: ConversationProject } | Fail> {
  const n = name.replace(/\s+/g, " ").trim().slice(0, 120);
  if (!n) return { ok: false, error: "Give the project a name." };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  const { data, error } = await supabase
    .from("conversation_projects")
    .insert({ corporation_id: corpId, user_id: user.id, name: n })
    .select("id, name")
    .single();
  if (error || !data) {
    console.error("[conversations] create project", error?.message);
    return { ok: false, error: "Couldn't create that project." };
  }
  return { ok: true, project: data as ConversationProject };
}

export async function renameProject(corpId: string, projectId: string, name: string): Promise<Done> {
  const n = name.replace(/\s+/g, " ").trim().slice(0, 120);
  if (!n) return { ok: false, error: "Give the project a name." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("conversation_projects")
    .update({ name: n })
    .eq("id", projectId)
    .eq("corporation_id", corpId)
    .select("id");
  if (error) return { ok: false, error: "Couldn't rename that project." };
  return data?.length ? { ok: true } : { ok: false, error: "That project isn't available." };
}

/** Deleting a project keeps its conversations; they move back to Recents. */
export async function deleteProject(corpId: string, projectId: string): Promise<Done> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("conversation_projects")
    .delete()
    .eq("id", projectId)
    .eq("corporation_id", corpId)
    .select("id");
  if (error) return { ok: false, error: "Couldn't delete that project." };
  return data?.length ? { ok: true } : { ok: false, error: "That project isn't available." };
}
