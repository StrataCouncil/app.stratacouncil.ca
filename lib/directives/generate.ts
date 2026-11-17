import "server-only";
import { askClaudeJson } from "@/lib/ai/claude";
import { loadStripContext } from "@/lib/kb/privacy";
import { pseudonymize } from "@/lib/pii";
import { createAdminClient } from "@/lib/supabase/admin";
import { cleanDraft, motionDirective, needsFollowUp, type DraftDirective, type MotionSource } from "@/lib/directives/motion";

/**
 * Directives written automatically (0097), with the service role:
 *
 *   After a meeting adjourns: each carried motion that leaves something to
 *   be done becomes one or more directives. A motion ratifying a Discussion
 *   that already has directives adds none.
 *   After a Discussion closes with council in favour: the same, from its
 *   motion.
 *   After a meeting doesn't ratify a Discussion: its open directives are
 *   cancelled.
 *
 * With a subscription, Stratasphere words them (names swapped for numbered
 * references first, as for motion drafting); without one, or if it fails,
 * the motion's own words are used. Each carries a source_key, so running
 * any of this twice adds nothing. Failures are logged, never thrown: the
 * meeting or the vote has already happened.
 */

type Admin = ReturnType<typeof createAdminClient>;

interface Source extends MotionSource {
  key: string;
  decisionId?: string;
  meetingId?: string;
  discussionId?: string;
}

const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer" },
          directives: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                detail: { type: "string" },
                assignee: { type: "string", enum: ["none", "manager"] },
                dueDate: { type: "string" },
              },
              required: ["title", "detail", "assignee", "dueDate"],
              additionalProperties: false,
            },
          },
        },
        required: ["index", "directives"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};

async function subscribed(admin: Admin, corpId: string): Promise<boolean> {
  const { data } = await admin.from("subscriptions").select("status").eq("corporation_id", corpId).maybeSingle();
  return data?.status === "active";
}

/** Stratasphere's wording for each source, by position; null where it couldn't. */
async function draftWithAI(admin: Admin, corpId: string, sources: Source[], decidedOn: string): Promise<(DraftDirective[] | null)[]> {
  const ctx = await loadStripContext(admin, corpId);
  const p = pseudonymize(
    sources.map((s, i) => `Motion ${i + 1}\nItem: ${s.title.slice(0, 300)}\nMotion as carried: ${s.motion.slice(0, 3000)}`).join("\n\n"),
    ctx.people,
    ctx.identity
  );
  try {
    const out = await askClaudeJson<{ items: { index: number; directives: unknown[] }[] }>({
      effort: "low",
      maxTokens: 4000,
      system:
        "You turn motions carried by a BC strata council into directives: the follow-up tasks someone now has to do. " +
        `The motions were decided on ${decidedOn}. For each motion, list the tasks it calls for, usually one, sometimes two or three where the motion clearly asks for separate things. ` +
        "A motion that settles something on the spot with nothing left to do (approving minutes, receiving a report, a ratification, an election) gets no directives. " +
        "Each directive: title, an imperative sentence under 120 characters saying what to do, specific to the motion (\"Get three quotes for the roof membrane replacement\"); " +
        "detail, one or two plain sentences with any amounts, limits, or timing the motion gives, or an empty string; " +
        "assignee, \"manager\" only if the motion says the strata manager, management company, or agent will do it, otherwise \"none\"; " +
        "dueDate, YYYY-MM-DD only if the motion states a calendar date, otherwise an empty string (put timing like \"before the next meeting\" in the detail instead). " +
        "Placeholders like [REF-3] stand for names and other details; copy them exactly. Never invent facts, amounts, or dates. " +
        "Return one entry per motion, with index set to the motion's number.",
      messages: [{ role: "user", content: p.text }],
      schema: DRAFT_SCHEMA,
    });
    const byIndex = new Map((out.items ?? []).map((it) => [it.index, it.directives]));
    return sources.map((_, i) => {
      const raw = byIndex.get(i + 1);
      if (!Array.isArray(raw)) return null;
      return raw
        .slice(0, 5)
        .map((d) => cleanDraft(d))
        .filter((d): d is DraftDirective => d !== null)
        .map((d) => ({ ...d, title: p.restore(d.title).slice(0, 300), detail: p.restore(d.detail).slice(0, 4000) }));
    });
  } catch (err) {
    console.error("[directives] draft", err instanceof Error ? err.message : err);
    return sources.map(() => null);
  }
}

/** Writes the directives for these sources, skipping any already written. */
async function writeDirectives(admin: Admin, corpId: string, source: "meeting" | "discussion", sources: Source[], decidedOn: string) {
  if (!sources.length) return;
  const { data: existing } = await admin
    .from("directives")
    .select("source_key")
    .eq("corporation_id", corpId)
    .in(
      "source_key",
      sources.flatMap((s) => [1, 2, 3, 4, 5].map((n) => `${s.key}:${n}`))
    );
  const done = new Set((existing ?? []).map((r) => String(r.source_key).replace(/:\d+$/, "")));
  const todo = sources.filter((s) => !done.has(s.key));
  if (!todo.length) return;

  const ai = (await subscribed(admin, corpId)) ? await draftWithAI(admin, corpId, todo, decidedOn) : todo.map(() => null);
  for (const [i, s] of todo.entries()) {
    const drafted = ai[i];
    const list = drafted ?? [motionDirective(s)];
    for (const [n, d] of list.entries()) {
      const { data: row, error } = await admin
        .from("directives")
        .insert({
          corporation_id: corpId,
          title: d.title,
          detail: d.detail,
          source,
          source_key: `${s.key}:${n + 1}`,
          decision_id: s.decisionId ?? null,
          meeting_id: s.meetingId ?? null,
          discussion_id: s.discussionId ?? null,
          source_text: s.motion.slice(0, 4000),
          drafted_by: drafted ? "ai" : "motion",
          assignee_kind: d.assignee,
          due_date: d.dueDate,
        })
        .select("id")
        .maybeSingle();
      if (error) {
        if (error.code !== "23505") console.error("[directives] insert", error.code, error.message);
        continue;
      }
      if (row) await admin.from("directive_changes").insert({ directive_id: row.id, corporation_id: corpId, kind: "created" });
    }
  }
}

/** After a meeting adjourns. */
export async function generateMeetingDirectives(corpId: string, meetingId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const [{ data: meeting }, { data: decisions }] = await Promise.all([
      admin.from("meetings").select("id, corporation_id, meeting_date, agenda").eq("id", meetingId).eq("corporation_id", corpId).maybeSingle(),
      admin
        .from("decisions")
        .select("id, agenda_item_id, title, motion_text")
        .eq("corporation_id", corpId)
        .eq("meeting_id", meetingId)
        .eq("source", "meeting"),
    ]);
    if (!meeting) return;
    await cancelUnratified(admin, corpId, meetingId, meeting.meeting_date as string);

    // Ratifications of Discussions that already have directives add none.
    const agenda = Array.isArray(meeting.agenda) ? (meeting.agenda as { id?: string; discussionId?: string }[]) : [];
    const discussionOf = new Map(agenda.filter((i) => i?.id && i.discussionId).map((i) => [String(i.id), String(i.discussionId)]));
    const discussionIds = [...new Set(discussionOf.values())];
    const { data: withDirectives } = discussionIds.length
      ? await admin.from("directives").select("discussion_id").in("discussion_id", discussionIds)
      : { data: [] as { discussion_id: string }[] };
    const covered = new Set((withDirectives ?? []).map((r) => r.discussion_id as string));

    const sources: Source[] = (decisions ?? [])
      .filter((d) => {
        const disc = d.agenda_item_id ? discussionOf.get(d.agenda_item_id as string) : undefined;
        return !(disc && covered.has(disc));
      })
      .map((d) => ({
        key: `decision:${d.id}`,
        decisionId: d.id as string,
        meetingId,
        discussionId: d.agenda_item_id ? discussionOf.get(d.agenda_item_id as string) : undefined,
        title: (d.title as string) ?? "",
        motion: (d.motion_text as string) ?? "",
      }))
      .filter((s) => needsFollowUp(s));
    await writeDirectives(admin, corpId, "meeting", sources, meeting.meeting_date as string);
  } catch (err) {
    console.error("[directives] meeting", err instanceof Error ? err.message : err);
  }
}

/** After a Discussion closes. Only a vote that council supported. */
export async function generateDiscussionDirectives(discussionId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: d } = await admin
      .from("discussions")
      .select("id, corporation_id, title, motion, status, result, closed_at, vote_required")
      .eq("id", discussionId)
      .maybeSingle();
    if (!d || d.status === "open" || d.result !== "supported" || d.vote_required === false) return;
    const source: Source = { key: `discussion:${d.id}`, discussionId: d.id as string, title: d.title as string, motion: (d.motion as string) ?? "" };
    if (!needsFollowUp(source)) return;
    await writeDirectives(admin, d.corporation_id as string, "discussion", [source], String(d.closed_at ?? "").slice(0, 10));
  } catch (err) {
    console.error("[directives] discussion", err instanceof Error ? err.message : err);
  }
}

/** A meeting that didn't ratify a Discussion cancels its open directives. */
async function cancelUnratified(admin: Admin, corpId: string, meetingId: string, meetingDate: string) {
  const { data: notRatified } = await admin
    .from("discussions")
    .select("id")
    .eq("corporation_id", corpId)
    .eq("ratified_meeting_id", meetingId)
    .eq("status", "not_ratified");
  const ids = (notRatified ?? []).map((r) => r.id as string);
  if (!ids.length) return;
  const note = `Not ratified at the council meeting of ${meetingDate}.`;
  const { data: cancelled } = await admin
    .from("directives")
    .update({ status: "cancelled", closed_at: new Date().toISOString(), close_note: note, updated_at: new Date().toISOString() })
    .in("discussion_id", ids)
    .eq("status", "open")
    .select("id");
  for (const r of cancelled ?? []) {
    await admin.from("directive_changes").insert({ directive_id: r.id, corporation_id: corpId, kind: "cancelled", detail: { note } });
  }
}
