import { createClient } from "@/lib/supabase/server";

/**
 * Directives (0097), read as the signed-in person: the database returns
 * them only to council, those who run meetings, and the strata's managers.
 */

export type DirectiveStatus = "open" | "done" | "cancelled";
export type AssigneeKind = "none" | "manager" | "person";

export interface Directive {
  id: string;
  title: string;
  detail: string;
  source: "meeting" | "discussion" | "manual";
  sourceText: string;
  draftedBy: "ai" | "motion" | "person";
  meetingId: string | null;
  meetingDate: string | null;
  meetingType: string | null;
  discussionId: string | null;
  discussionTitle: string | null;
  assigneeKind: AssigneeKind;
  assigneeUserId: string | null;
  assigneeName: string;
  dueDate: string | null;
  status: DirectiveStatus;
  closedAt: string | null;
  closedByName: string;
  closeNote: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

export interface DirectiveChange {
  directiveId: string;
  kind: "created" | "edited" | "done" | "cancelled" | "reopened";
  byName: string;
  at: string;
  detail: Record<string, unknown>;
}

/** Someone a directive can be assigned to: an active member on council, running meetings, or managing. */
export interface Assignable {
  userId: string;
  name: string;
}

const COLUMNS =
  "id, title, detail, source, source_text, drafted_by, meeting_id, discussion_id, assignee_kind, assignee_user_id, assignee_name, due_date, status, closed_at, closed_by_name, close_note, created_by_name, created_at, updated_at, meeting:meetings(meeting_date, type), discussion:discussions(title)";

export async function listDirectives(corpId: string): Promise<Directive[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("directives").select(COLUMNS).eq("corporation_id", corpId).order("created_at", { ascending: false }).limit(1000);
  if (error) {
    console.error("[listDirectives]", error.message);
    return [];
  }
  return (data ?? []).map((r) => {
    const meeting = (Array.isArray(r.meeting) ? r.meeting[0] : r.meeting) as { meeting_date: string; type: string } | null;
    const discussion = (Array.isArray(r.discussion) ? r.discussion[0] : r.discussion) as { title: string } | null;
    return {
      id: r.id,
      title: r.title,
      detail: r.detail ?? "",
      source: r.source,
      sourceText: r.source_text ?? "",
      draftedBy: r.drafted_by,
      meetingId: r.meeting_id,
      meetingDate: meeting?.meeting_date ?? null,
      meetingType: meeting?.type ?? null,
      discussionId: r.discussion_id,
      discussionTitle: discussion?.title ?? null,
      assigneeKind: r.assignee_kind,
      assigneeUserId: r.assignee_user_id,
      assigneeName: r.assignee_name ?? "",
      dueDate: r.due_date,
      status: r.status,
      closedAt: r.closed_at,
      closedByName: r.closed_by_name ?? "",
      closeNote: r.close_note ?? "",
      createdByName: r.created_by_name ?? "",
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    } satisfies Directive;
  });
}

export async function listDirectiveChanges(corpId: string): Promise<DirectiveChange[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("directive_changes")
    .select("directive_id, kind, changed_by_name, at, detail")
    .eq("corporation_id", corpId)
    .order("at", { ascending: true })
    .limit(5000);
  return (data ?? []).map((c) => ({
    directiveId: c.directive_id,
    kind: c.kind,
    byName: c.changed_by_name ?? "",
    at: c.at,
    detail: (c.detail ?? {}) as Record<string, unknown>,
  }));
}

const DIRECTIVE_ROLES = ["admin", "president", "vice_president", "treasurer", "secretary", "member_at_large", "manager"];

/** The people a directive can be assigned to (the database checks again on save). */
export async function listAssignable(corpId: string): Promise<Assignable[]> {
  const supabase = await createClient();
  const [{ data: directory }, { data: roles }] = await Promise.all([
    supabase.rpc("corporation_member_directory", { p_corporation_id: corpId }),
    supabase.from("corporation_role_assignments").select("user_id, role").eq("corporation_id", corpId),
  ]);
  const withRole = new Set((roles ?? []).filter((r) => DIRECTIVE_ROLES.includes(r.role)).map((r) => r.user_id as string));
  return ((directory ?? []) as { user_id: string; full_name: string | null; status: string; can_run_meetings: boolean }[])
    .filter((m) => m.status === "active" && (m.can_run_meetings || withRole.has(m.user_id)))
    .map((m) => ({ userId: m.user_id, name: (m.full_name ?? "").trim() || "A member" }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
