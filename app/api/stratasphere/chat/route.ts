import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStrataAccess } from "@/lib/data/strata";
import { streamStratasphere, type AssistantTurn } from "@/lib/ai/stratasphere";
import { titleFromQuestion } from "@/lib/ai/conversation-title";

/**
 * The standalone Stratasphere assistant (doc02 §4b). Subscription only —
 * never free, not even during the trial meeting. Saves the question, streams
 * the answer back as newline-delimited JSON while it's written, then saves
 * the answer with the sources it drew on:
 *
 *   {"type":"start","conversationId","title"}
 *   {"type":"delta","text"} ...
 *   {"type":"done","messageId","sources"}   or   {"type":"error","error"}
 *
 * Conversations are private to their owner (RLS, 0019).
 */
export const maxDuration = 120;

const enc = new TextEncoder();
const line = (o: unknown) => enc.encode(`${JSON.stringify(o)}\n`);

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    corpId?: string;
    conversationId?: string | null;
    question?: string;
  } | null;
  const corpId = String(body?.corpId ?? "");
  const question = String(body?.question ?? "").trim().slice(0, 4000);
  if (!corpId || !question) return NextResponse.json({ error: "Ask a question." }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  const access = await getStrataAccess(corpId);
  if (!access) return NextResponse.json({ error: "You're not connected to this strata." }, { status: 403 });
  if (!access.subscribed) {
    return NextResponse.json({ error: "The Stratasphere assistant needs an active subscription." }, { status: 402 });
  }

  // The conversation: an existing one of the user's own, or a new one.
  let conversationId = body?.conversationId ?? null;
  let title: string;
  let history: AssistantTurn[] = [];
  if (conversationId) {
    const { data: convo } = await supabase
      .from("conversations")
      .select("id, title, corporation_id")
      .eq("id", conversationId)
      .maybeSingle();
    if (!convo || convo.corporation_id !== access.corpId) {
      return NextResponse.json({ error: "That conversation isn't available." }, { status: 404 });
    }
    title = convo.title;
    const { data: past } = await supabase
      .from("conversation_messages")
      .select("role, content")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(10);
    history = (past ?? []).reverse().map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  } else {
    title = titleFromQuestion(question);
    const { data: created, error } = await supabase
      .from("conversations")
      .insert({ corporation_id: access.corpId, user_id: user.id, title })
      .select("id")
      .single();
    if (error || !created) {
      console.error("[stratasphere chat] create", error?.message);
      return NextResponse.json({ error: "Couldn't start a conversation." }, { status: 500 });
    }
    conversationId = created.id as string;
  }

  const { error: qError } = await supabase
    .from("conversation_messages")
    .insert({ conversation_id: conversationId, role: "user", content: question });
  if (qError) {
    console.error("[stratasphere chat] save question", qError.message);
    return NextResponse.json({ error: "Couldn't save your question." }, { status: 500 });
  }

  const id = conversationId;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(line({ type: "start", conversationId: id, title }));
      const result = await streamStratasphere(
        { supabase, corpId: access.corpId, question, history },
        (text) => controller.enqueue(line({ type: "delta", text }))
      );
      if (!result.ok) {
        controller.enqueue(line({ type: "error", error: result.error }));
        controller.close();
        return;
      }
      const { data: saved } = await supabase
        .from("conversation_messages")
        .insert({ conversation_id: id, role: "assistant", content: result.text, citations: result.sources })
        .select("id")
        .single();
      await supabase.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", id);
      controller.enqueue(line({ type: "done", messageId: saved?.id ?? null, sources: result.sources }));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
}
