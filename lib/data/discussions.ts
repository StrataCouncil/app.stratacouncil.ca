import { displayStatus, tally, tallyLine, type DiscussionResult, type DiscussionStatus, type DiscussionVote, type Tally } from "@/lib/discussions/tally";
import { normalizeAgenda } from "@/lib/meetings/agenda";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type Client = ReturnType<typeof createAdminClient>;

/**
 * Council discussions (0070), read as the signed-in person: the database
 * only returns them to council, and hides the others' votes and the
 * comments from anyone recused.
 */

type StoredStatus = "open" | "closed" | "ratified" | "not_ratified";

export interface DiscussionSummary {
  id: string;
  title: string;
  motion: string;
  authorName: string;
  createdAt: string;
  closedAt: string | null;
  status: DiscussionStatus;
  result: DiscussionResult | null;
  ratifiedAt: string | null;
  /** Votes cast so far, of the voters (visible counts only, for anyone recused). */
  voted: number;
  voters: number;
  /** Your own vote: undefined when you aren't a voter on it, null when you haven't voted yet. */
  myVote?: DiscussionVote | null;
}

export interface DiscussionVoter {
  userId: string | null;
  name: string;
  vote: DiscussionVote | null;
  recusalReason: string | null;
  votedAt: string | null;
}

export interface DiscussionFile {
  id: string;
  commentId: string | null;
  fileName: string;
  sizeBytes: number | null;
}

export interface DiscussionComment {
  id: string;
  userId: string | null;
  authorName: string;
  body: string;
  createdAt: string;
  files: DiscussionFile[];
}

export interface DiscussionDetail extends DiscussionSummary {
  corporationId: string;
  createdBy: string | null;
  background: string;
  financial: string;
  risks: string;
  storedStatus: StoredStatus;
  voterList: DiscussionVoter[];
  /** The signed-in person's own vote row, if they're a voter. */
  mine: DiscussionVoter | null;
  /** True when the signed-in person is recused, and so sees only their own vote. */
  recused: boolean;
  tally: Tally | null;
  closedCounts: { for: number; against: number; abstain: number; recused: number; missing: number } | null;
  files: DiscussionFile[];
  comments: DiscussionComment[];
  recordDocumentId: string | null;
  ratifiedMeetingId: string | null;
  /** A meeting that hasn't adjourned yet whose agenda carries it. */
  onAgendaOf: { id: string; date: string } | null;
}

const COLUMNS =
  "id, corporation_id, title, background, financial, risks, motion, created_by, author_name, created_at, closed_at, status, result, votes_for, votes_against, votes_abstain, votes_recused, votes_missing, record_document_id, ratified_meeting_id, ratified_at";

/** Ids of discussions on the agenda of a meeting that hasn't adjourned, with that meeting. */
export async function discussionsOnPendingAgendas(corpId: string, client?: Client): Promise<Map<string, { id: string; date: string }>> {
  const supabase = client ?? (await createClient());
  const { data } = await supabase
    .from("meetings")
    .select("id, meeting_date, agenda, status")
    .eq("corporation_id", corpId)
    .neq("status", "ADJOURNED");
  const out = new Map<string, { id: string; date: string }>();
  for (const m of data ?? []) {
    for (const it of normalizeAgenda(m.agenda)) if (it.discussionId) out.set(it.discussionId, { id: m.id, date: m.meeting_date });
  }
  return out;
}

export async function listDiscussions(corpId: string): Promise<DiscussionSummary[]> {
  const supabase = await createClient();
  const [{ data, error }, { data: voters }, { data: auth }] = await Promise.all([
    supabase.from("discussions").select(COLUMNS).eq("corporation_id", corpId).order("created_at", { ascending: false }),
    supabase.from("discussion_voters").select("discussion_id, user_id, vote"),
    supabase.auth.getUser(),
  ]);
  const me = auth.user?.id ?? null;
  if (error) console.error("[listDiscussions]", error.message);
  return (data ?? []).map((d) => {
    const mine = (voters ?? []).filter((v) => v.discussion_id === d.id);
    return {
      id: d.id,
      title: d.title,
      motion: d.motion,
      authorName: d.author_name,
      createdAt: d.created_at,
      closedAt: d.closed_at,
      status: displayStatus(d.status as StoredStatus, d.result as DiscussionResult | null),
      result: d.result as DiscussionResult | null,
      ratifiedAt: d.ratified_at,
      voted: mine.filter((v) => v.vote).length,
      voters: mine.length,
      // Your own vote: undefined when you aren't a voter, null when you haven't voted.
      myVote: me && mine.some((v) => v.user_id === me) ? ((mine.find((v) => v.user_id === me)?.vote as DiscussionVote | null) ?? null) : undefined,
    };
  });
}

export async function getDiscussion(corpId: string, id: string): Promise<DiscussionDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const [{ data: d }, { data: voters }, { data: comments }, { data: files }, pending] = await Promise.all([
    supabase.from("discussions").select(COLUMNS).eq("corporation_id", corpId).eq("id", id).maybeSingle(),
    supabase.from("discussion_voters").select("user_id, name, vote, recusal_reason, voted_at").eq("discussion_id", id).order("name"),
    supabase.from("discussion_comments").select("id, user_id, author_name, body, created_at").eq("discussion_id", id).order("created_at"),
    supabase.from("discussion_files").select("id, comment_id, file_name, size_bytes").eq("discussion_id", id).order("created_at"),
    discussionsOnPendingAgendas(corpId),
  ]);
  if (!d) return null;

  const voterList: DiscussionVoter[] = (voters ?? []).map((v) => ({
    userId: v.user_id,
    name: v.name,
    vote: v.vote as DiscussionVote | null,
    recusalReason: v.recusal_reason,
    votedAt: v.voted_at,
  }));
  const mine = voterList.find((v) => v.userId === user.id) ?? null;
  const recused = mine?.vote === "recused";
  const fileList: DiscussionFile[] = (files ?? []).map((f) => ({ id: f.id, commentId: f.comment_id, fileName: f.file_name, sizeBytes: f.size_bytes }));

  return {
    id: d.id,
    corporationId: d.corporation_id,
    title: d.title,
    motion: d.motion,
    background: d.background,
    financial: d.financial,
    risks: d.risks,
    authorName: d.author_name,
    createdBy: d.created_by,
    createdAt: d.created_at,
    closedAt: d.closed_at,
    storedStatus: d.status as StoredStatus,
    status: displayStatus(d.status as StoredStatus, d.result as DiscussionResult | null),
    result: d.result as DiscussionResult | null,
    ratifiedAt: d.ratified_at,
    voted: voterList.filter((v) => v.vote).length,
    voters: voterList.length,
    voterList,
    mine,
    recused,
    tally: recused ? null : tally(voterList.map((v) => v.vote)),
    closedCounts:
      d.status === "open"
        ? null
        : { for: d.votes_for ?? 0, against: d.votes_against ?? 0, abstain: d.votes_abstain ?? 0, recused: d.votes_recused ?? 0, missing: d.votes_missing ?? 0 },
    files: fileList.filter((f) => !f.commentId),
    comments: (comments ?? []).map((c) => ({
      id: c.id,
      userId: c.user_id,
      authorName: c.author_name,
      body: c.body,
      createdAt: c.created_at,
      files: fileList.filter((f) => f.commentId === c.id),
    })),
    recordDocumentId: d.record_document_id,
    ratifiedMeetingId: d.ratified_meeting_id,
    onAgendaOf: pending.get(d.id) ?? null,
  };
}

/**
 * Passed motions waiting for a council meeting, and not already on another
 * meeting's agenda. Read with the service role, because whoever builds the
 * agenda (a secretary, or anyone allowed to run meetings) needn't be on
 * council: callers check can_run_meetings first. Only what goes on the
 * agenda item is returned, never the votes by name or the comments.
 */
export async function ratificationCandidates(
  corpId: string,
  meetingId: string
): Promise<Array<{ id: string; title: string; motion: string; background: string; financial: string; risks: string; closedAt: string; recordDocumentId: string | null; tally: string }>> {
  const admin = createAdminClient();
  const [{ data }, pending] = await Promise.all([
    admin
      .from("discussions")
      .select("id, title, motion, background, financial, risks, closed_at, record_document_id, votes_for, votes_against, votes_abstain, votes_recused, votes_missing")
      .eq("corporation_id", corpId)
      .eq("status", "closed")
      .eq("result", "supported")
      .order("closed_at"),
    discussionsOnPendingAgendas(corpId, admin),
  ]);
  return (data ?? [])
    .filter((d) => !pending.has(d.id) || pending.get(d.id)!.id === meetingId)
    .map((d) => ({
      id: d.id,
      title: d.title,
      motion: d.motion,
      background: d.background,
      financial: d.financial,
      risks: d.risks,
      closedAt: d.closed_at,
      recordDocumentId: d.record_document_id,
      tally: tallyLine({ for: d.votes_for ?? 0, against: d.votes_against ?? 0, abstain: d.votes_abstain ?? 0, recused: d.votes_recused ?? 0, missing: d.votes_missing ?? 0 }),
    }));
}

/**
 * An agenda about to be saved: a ratification item keeps its discussionId
 * only if it's a passed discussion of this strata, not already on another
 * meeting's agenda. Anything else loses the link (the item itself stays).
 */
export async function checkRatificationLinks<T extends { discussionId?: string }>(corpId: string, meetingId: string, agenda: T[]): Promise<T[]> {
  const ids = agenda.map((it) => it.discussionId).filter((id): id is string => Boolean(id));
  if (ids.length === 0) return agenda;
  const allowed = new Set((await ratificationCandidates(corpId, meetingId)).map((c) => c.id));
  const seen = new Set<string>();
  return agenda.map((it) => {
    if (!it.discussionId) return it;
    if (!allowed.has(it.discussionId) || seen.has(it.discussionId)) return { ...it, discussionId: undefined };
    seen.add(it.discussionId);
    return it;
  });
}
