import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStrataAccess } from "@/lib/data/strata";
import { streamStratasphere, type AssistantTurn, type StratasphereSource } from "@/lib/ai/stratasphere";
import { titleFromQuestion } from "@/lib/ai/conversation-title";
import { trimHistory, turnsForItem } from "@/lib/ai/conversation-history";
import { getMeeting } from "@/lib/data/meetings";
import { canAskInMeeting, MEETING_ASSISTANT_REFUSAL } from "@/lib/meetings/assistant-access";
import { meetingTypeLabels } from "@/lib/meetings/agenda";
import type { MeetingScope } from "@/lib/ai/stratasphere";
import { resolveFocus, savedFocus } from "@/lib/ai/focus";
import { parseFocusRef } from "@/lib/stratasphere-focus";
import { DEMO_LIMIT_MESSAGE, IS_DEMO } from "@/lib/demo";
import { demoVisitorId, logDemoActivity, refundDemoAllowance, takeDemoAllowance } from "@/lib/demo-usage";

/**
 * The standalone Stratasphere assistant (doc02 §4b). Subscription only —
 * never free, not even during the trial meeting. Saves the question, streams
 * the answer back as newline-delimited JSON while it's written, then saves
 * the answer with the sources it drew on:
 *
 *   {"type":"start","conversationId","title","focus"}
 *   {"type":"delta","text"} ...
 *   {"type":"done","messageId","sources"}   or   {"type":"error","error"}
 *
 * Conversations are private to their owner (RLS, 0019).
 *
 * The floating panel (PR 4a) also sends `focus`: a reference to what the
 * person is looking at. It's read again here with their own access and
 * refused if they couldn't open it; only the reference and its label are
 * saved with the question (conversation_messages.focus, 0094).
 *
 * Meeting Mode (PR 4b) sends `live: true` with the open agenda item as the
 * focus. Only whoever runs the meeting, or council following it live, may
 * ask (as before). The agenda is the saved one, read here, never the
 * browser's. Answers keep the fast meeting setting and "decisions so far",
 * and only build on earlier questions about the same item. A meeting is one
 * conversation per person, named after the meeting.
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
    focus?: unknown;
    live?: boolean;
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
  if (!access.stratasphere) {
    return NextResponse.json({ error: "Stratasphere is for council members, managers, and admins." }, { status: 403 });
  }
  // What they're looking at, if anything: read with their own access, or refused.
  const focusRef = body?.focus == null ? null : parseFocusRef(body.focus);
  if (body?.focus != null && !focusRef) return NextResponse.json({ error: "That record isn't available." }, { status: 400 });
  const focus = focusRef ? await resolveFocus(supabase, access.corpId, focusRef) : null;
  if (focusRef && !focus) return NextResponse.json({ error: "That record isn't available to you." }, { status: 403 });

  // Meeting Mode: the open item of a meeting this person runs or follows live.
  const live = body?.live === true;
  let meeting: MeetingScope | undefined;
  if (live) {
    if (!focus || focus.kind !== "agenda_item" || focusRef?.kind !== "agenda_item") {
      return NextResponse.json({ error: "Open an agenda item to ask about it." }, { status: 400 });
    }
    const m = await getMeeting(access.corpId, focusRef.meetingId);
    if (!m || !(await canAskInMeeting(supabase, user.id, m))) return NextResponse.json({ error: MEETING_ASSISTANT_REFUSAL }, { status: 403 });
    meeting = { item: focus.item, agenda: focus.agenda, meetingLabel: meetingTypeLabels[m.type] };
  }
  const allowance = live ? "meeting" : "chat";

  // The demo: a few questions per visitor (lib/demo.ts DEMO_LIMITS).
  if (IS_DEMO && !(await takeDemoAllowance(allowance))) {
    await logDemoActivity({
      kind: "limit",
      path: `/strata/${corpId}/assistant`,
      detail: { reason: live ? "Meeting Mode questions" : "Stratasphere questions", question },
    });
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
      .select("role, content, citations, context, created_at, focus")
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
    history =
      meeting && focusRef?.kind === "agenda_item"
        ? // In a meeting: this item's turns only, as text (each answer gets the item's records afresh).
          turnsForItem(turns, focusRef.meetingId, focusRef.itemId).map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))
        : turns.map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
            context: m.context,
            sources: Array.isArray(m.citations) ? (m.citations as StratasphereSource[]).map(sourceName) : undefined,
          }));
    if (meeting) trimmed = false;
  } else {
    title = focus?.kind === "agenda_item" && live ? `${focus.meetingLabel}, ${focus.date}` : titleFromQuestion(question);
    const { data: created, error } = await supabase
      .from("conversations")
      .insert({ corporation_id: access.corpId, user_id: user.id, title })
      .select("id")
      .single();
    if (error || !created) {
      console.error("[stratasphere chat] create", error?.message);
      await refundDemoAllowance(allowance);
      return NextResponse.json({ error: "Couldn't start a conversation." }, { status: 500 });
    }
    conversationId = created.id as string;
  }

  const { data: asked, error: qError } = await supabase
    .from("conversation_messages")
    .insert({ conversation_id: conversationId, role: "user", content: question, focus: focus ? savedFocus(focus) : null })
    .select("id")
    .single();
  if (qError || !asked) {
    console.error("[stratasphere chat] save question", qError?.message);
    await refundDemoAllowance(allowance);
    return NextResponse.json({ error: "Couldn't save your question." }, { status: 500 });
  }

  const id = conversationId;
  // Read now: the stream below runs after the response has started.
  const visitor = IS_DEMO ? await demoVisitorId() : null;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(line({ type: "start", conversationId: id, title, focus: focus ? savedFocus(focus) : null }));
      const result = await streamStratasphere(
        // In a meeting, the item and its attachments come first through `meeting`.
        { supabase, corpId: access.corpId, question, history, trimmed, focus: meeting ? null : focus, meeting },
        (text) => controller.enqueue(line({ type: "delta", text }))
      );
      if (!result.ok) {
        await refundDemoAllowance(allowance, visitor);
        await logDemoActivity({ kind: live ? "stratasphere.meeting" : "stratasphere.chat", path: `/strata/${corpId}/assistant`, detail: { question, failed: result.error } }, visitor);
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
        kind: live ? "stratasphere.meeting" : "stratasphere.chat",
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
