import type { SupabaseClient } from "@supabase/supabase-js";
import { motionDirective, needsFollowUp } from "@/lib/directives/motion";

/**
 * The demo strata's sample Directives (lib/demo-kit/build.ts, 0097): the
 * follow-up from the held meetings' carried motions, worded as Stratasphere
 * words them on a subscription, most of the older ones done; the lobby
 * carpet Discussion's follow-up; and one added by hand that's overdue, so
 * the visitor sees every state. Fictional, like the rest of the kit.
 */

export interface DemoDecision {
  id: string;
  meeting_id: string | null;
  title: string;
  motion_text: string;
  decided_at: string;
}

interface Wording {
  /** Matched against the motion. */
  match: RegExp;
  title: string;
  detail?: string;
  /** Days after the meeting it was done; open if not set. */
  doneAfterDays?: number;
  note?: string;
  /** Days after the meeting it's due. */
  dueAfterDays?: number;
}

const WORDINGS: Wording[] = [
  {
    match: /reminder letter to the owner of strata lot 14/i,
    title: "Send the owner of SL014 a reminder letter about overdue strata fees",
    doneAfterDays: 3,
    note: "Letter sent by email and mail.",
  },
  {
    match: /roof replacement specification/i,
    title: "Engage the engineer to prepare the roof replacement specification and run the tender",
    detail: "Fixed fee as approved, funded from the contingency reserve fund.",
    doneAfterDays: 6,
    note: "Engagement letter signed; tender documents expected next month.",
  },
  {
    match: /janitorial services agreement/i,
    title: "Sign the two-year janitorial renewal with Cedar Clean Services",
    detail: "$1,200 a month plus GST.",
    doneAfterDays: 9,
    note: "Signed renewal filed in Contracts.",
  },
  {
    match: /warning letter about the use of visitor parking/i,
    title: "Send the owner of SL014 a warning letter about visitor parking under Bylaws 6.2 and 6.3",
    detail: "No fine at this time.",
    doneAfterDays: 2,
    note: "Sent.",
  },
  {
    match: /demand letter for the overdue strata fees/i,
    title: "Send the owner of SL014 a demand letter for overdue strata fees under section 112",
    dueAfterDays: 14,
  },
  {
    match: /charge back the .* deductible to strata lot 16/i,
    title: "Notify the owner of SL016 in writing of the deductible chargeback and their right to a hearing",
    detail: "Under Bylaws 9.2 and 9.3.",
    dueAfterDays: 7,
  },
  {
    match: /written particulars of the continuing contravention of Bylaw 6\.2/i,
    title: "Give the owner and tenants of SL014 written particulars of the visitor parking contravention",
    detail: "Offer an opportunity to answer in writing or at a hearing before council considers a fine.",
    dueAfterDays: 10,
  },
];

const day = (iso: string, days: number) => new Date(new Date(iso).getTime() + days * 86_400_000);

export async function seedDirectives(
  admin: SupabaseClient,
  corpId: string,
  decisions: DemoDecision[],
  people: { manager: string; managerName: string; secretary: string; secretaryName: string },
  lobbyDiscussionId: string | null,
  now: Date
) {
  const rows: Record<string, unknown>[] = [];
  for (const d of decisions) {
    if (!d.meeting_id || !needsFollowUp({ title: d.title, motion: d.motion_text })) continue;
    const w = WORDINGS.find((x) => x.match.test(d.motion_text));
    const fallback = motionDirective({ title: d.title, motion: d.motion_text });
    const done = w?.doneAfterDays !== undefined ? day(d.decided_at, w.doneAfterDays) : null;
    const isDone = done !== null && done < now;
    const due = w?.dueAfterDays !== undefined ? day(d.decided_at, w.dueAfterDays).toISOString().slice(0, 10) : null;
    rows.push({
      corporation_id: corpId,
      title: w?.title ?? fallback.title,
      detail: w?.detail ?? fallback.detail,
      source: "meeting",
      source_key: `decision:${d.id}:1`,
      decision_id: d.id,
      meeting_id: d.meeting_id,
      source_text: d.motion_text,
      drafted_by: w ? "ai" : "motion",
      assignee_kind: /strata manager/i.test(d.motion_text) || w ? "manager" : fallback.assignee,
      due_date: due,
      status: isDone ? "done" : "open",
      closed_at: isDone ? done!.toISOString() : null,
      closed_by: isDone ? people.manager : null,
      closed_by_name: isDone ? people.managerName : "",
      close_note: isDone ? (w?.note ?? "") : "",
      created_at: day(d.decided_at, 0).toISOString(),
    });
  }
  if (lobbyDiscussionId) {
    rows.push({
      corporation_id: corpId,
      title: "Book Fraser Valley Flooring to replace the lobby and main-floor corridor carpet",
      detail: "$6,400 plus GST from the operating fund. Give owners a week's notice of the installation day.",
      source: "discussion",
      source_key: `discussion:${lobbyDiscussionId}:1`,
      discussion_id: lobbyDiscussionId,
      source_text:
        "THAT council accept the quote from Fraser Valley Flooring for $6,400 plus GST to replace the carpet in the lobby and the main-floor corridor, funded from the operating fund.",
      drafted_by: "ai",
      assignee_kind: "manager",
      created_at: day(now.toISOString(), -6).toISOString(),
    });
  }
  rows.push({
    corporation_id: corpId,
    title: "Check that the parkade gate closes fully after the sensor repair",
    detail: "Watch it close three times at night and report at the next meeting.",
    source: "manual",
    drafted_by: "person",
    assignee_kind: "person",
    assignee_user_id: people.secretary,
    assignee_name: people.secretaryName,
    due_date: day(now.toISOString(), -2).toISOString().slice(0, 10),
    created_by: people.secretary,
    created_by_name: people.secretaryName,
    created_at: day(now.toISOString(), -12).toISOString(),
  });

  if (!rows.length) return;
  // Rows here don't all name the same columns: without defaultToNull: false a
  // batch insert sends null for the missing ones (status, close_note...),
  // which the table refuses, and the whole demo strata fails to build.
  const { data, error } = await admin
    .from("directives")
    .insert(rows, { defaultToNull: false })
    .select("id, created_at, created_by_name, status, closed_at, closed_by, closed_by_name, close_note");
  if (error) throw new Error(`demo directives: ${error.message}`);
  const changes: Record<string, unknown>[] = [];
  for (const r of data ?? []) {
    changes.push({ directive_id: r.id, corporation_id: corpId, kind: "created", changed_by_name: r.created_by_name ?? "", at: r.created_at });
    if (r.status === "done") {
      changes.push({
        directive_id: r.id,
        corporation_id: corpId,
        kind: "done",
        changed_by: r.closed_by,
        changed_by_name: r.closed_by_name,
        detail: r.close_note ? { note: r.close_note } : {},
        at: r.closed_at,
      });
    }
  }
  const { error: logError } = await admin.from("directive_changes").insert(changes, { defaultToNull: false });
  if (logError) throw new Error(`demo directive history: ${logError.message}`);
}
