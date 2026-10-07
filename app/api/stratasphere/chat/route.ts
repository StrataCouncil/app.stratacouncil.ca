import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStrataAccess } from "@/lib/data/strata";
import { streamStratasphere, type AssistantTurn, type StratasphereSource } from "@/lib/ai/stratasphere";
import { titleFromQuestion } from "@/lib/ai/conversation-title";
import { trimHistory } from "@/lib/ai/conversation-history";
import { DEMO_LIMIT_MESSAGE, IS_DEMO } from "@/lib/demo";
import { demoVisitorId, logDemoActivity, refundDemoAllowance, takeDemoAllowance } from "@/lib/demo-usage";

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

function sourceName(s: StratasphereSource) {
  if (s.kind === "document" || s.kind === "legislation") return s.title;
  return s.kind === "decisions" ? "Decision ledger" : "Cross-platform precedent";
}

/** About 120k tokens of conversation (questions, answers and their records) before the oldest turns drop. */
const HISTORY_BUDGET_CHARS = 480_000;

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
  // The demo: three questions per visitor (lib/demo.ts DEMO_LIMITS).
  if (IS_DEMO && !(await takeDemoAllowance("chat"))) {
    await logDemoActivity({ kind: "limit", path: `/strata/${corpId}/assistant`, detail: { reason: "Stratasphere questions", question } });
    return NextResponse.json({ error: DEMO_LIMIT_MESSAGE, demoLimit: true }, { status: 429 });
  }

  // The conversation: an existing one of the user's own, or a new one.
  let conversationId = body?.conversationId ?? null;
  let title: string;
  let history: AssistantTurn[] = [];
  let trimmed = false;
  if (conversationId) {
    const { data: convo } = await supabase
      .from("conversations")
      .select("id, title, corporation_id, context_start_at")
      .eq("id", conversationId)
      .maybeSingle();
    if (!convo || convo.corporation_id !== access.corpId) {
      return NextResponse.json({ error: "That conversation isn't available." }, { status: 404 });
    }
    title = convo.title;
    let query = supabase
      .from("conversation_messages")
      .select("role, content, citations, context, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(400);
    if (convo.context_start_at) query = query.gte("created_at", convo.context_start_at);
    const { data: past } = await query;
    let turns = past ?? [];
    trimmed = Boolean(convo.context_start_at);

    // Past the budget, the oldest turns drop in one step (conversation-history.ts).
    const kept = trimHistory(turns, HISTORY_BUDGET_CHARS);
    if (kept.trimmed) {
      turns = kept.turns;
      trimmed = true;
      if (turns.length) {
        await supabase.from("conversations").update({ context_start_at: turns[0].created_at }).eq("id", conversationId);
      }
    }
    history = turns.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
      context: m.context,
      sources: Array.isArray(m.citations) ? (m.citations as StratasphereSource[]).map(sourceName) : undefined,
    }));
  } else {
    title = titleFromQuestion(question);
    const { data: created, error } = await supabase
      .from("conversations")
      .insert({ corporation_id: access.corpId, user_id: user.id, title })
      .select("id")
      .single();
    if (error || !created) {
      console.error("[stratasphere chat] create", error?.message);
      await refundDemoAllowance("chat");
      return NextResponse.json({ error: "Couldn't start a conversation." }, { status: 500 });
    }
    conversationId = created.id as string;
  }

  const { data: asked, error: qError } = await supabase
    .from("conversation_messages")
    .insert({ conversation_id: conversationId, role: "user", content: question })
    .select("id")
    .single();
  if (qError || !asked) {
    console.error("[stratasphere chat] save question", qError?.message);
    await refundDemoAllowance("chat");
    return NextResponse.json({ error: "Couldn't save your question." }, { status: 500 });
  }

  const id = conversationId;
  // Read now: the stream below runs after the response has started.
  const visitor = IS_DEMO ? await demoVisitorId() : null;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(line({ type: "start", conversationId: id, title }));
      const result = await streamStratasphere(
        { supabase, corpId: access.corpId, question, history, trimmed },
        (text) => controller.enqueue(line({ type: "delta", text }))
      );
      if (!result.ok) {
        await refundDemoAllowance("chat", visitor);
        await logDemoActivity({ kind: "stratasphere.chat", path: `/strata/${corpId}/assistant`, detail: { question, failed: result.error } }, visitor);
        controller.enqueue(line({ type: "error", error: result.error }));
        controller.close();
        return;
      }
      // The records this question was answered from, replayed with it from now on.
      await supabase.from("conversation_messages").update({ context: result.context }).eq("id", asked.id);
      const { data: saved } = await supabase
        .from("conversation_messages")
        .insert({ conversation_id: id, role: "assistant", content: result.text, citations: result.sources })
        .select("id")
        .single();
      await supabase.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", id);
      await logDemoActivity({
        kind: "stratasphere.chat",
        path: `/strata/${corpId}/assistant`,
        detail: { question, answer: result.text, sources: result.sources.map(sourceName).join("; ") },
      }, visitor);
      controller.enqueue(line({ type: "done", messageId: saved?.id ?? null, sources: result.sources }));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
}
