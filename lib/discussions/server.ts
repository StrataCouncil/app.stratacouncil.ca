import { tz } from "@/lib/time-zone";
import { randomUUID } from "node:crypto";
import { APP_URL } from "@/lib/app-url";
import { DOCUMENTS_BUCKET } from "@/lib/documents";
import { notifyUser } from "@/lib/email/notify";
import { discussionClosedEmail, discussionCommentEmail, discussionOpenedEmail, type DiscussionVoteLinks } from "@/lib/email/templates";
import { clockTime } from "@/lib/meetings/minutes";
import { discussionPdf } from "@/lib/exports/discussion-pdf";
import { exportFileName, todayInBC } from "@/lib/exports/filename";
import { queueDocumentFingerprints, queueDocumentIndexing } from "@/lib/kb/queue";
import { openTallyLine, RESULT_LABELS, tally, tallyLine, type DiscussionResult, type DiscussionVote } from "@/lib/discussions/tally";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Server-only work for council discussions (0070), done with the service
 * role after the caller's action has gone through the database's own
 * checks (create_discussion, close_discussion): filing the vote record in
 * Meetings & Records, and emailing council.
 */

export const DISCUSSION_FILES_BUCKET = "discussion-files";

/**
 * Files (or re-files, once a meeting has ratified it) the vote record as a
 * PDF in the strata's Meetings & Records folder, and queues it for
 * indexing like any other document. Re-filing replaces the file in place.
 */
export async function fileDiscussionRecord(discussionId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data: d } = await admin
    .from("discussions")
    .select("id, corporation_id, title, motion, background, financial, risks, author_name, created_by, created_at, closed_at, status, result, votes_for, votes_against, votes_abstain, votes_recused, votes_missing, record_document_id, ratified_meeting_id")
    .eq("id", discussionId)
    .maybeSingle();
  if (!d || d.status === "open" || !d.result || !d.closed_at) return null;

  const [{ data: corp }, { data: voters }, { data: files }, { data: meeting }] = await Promise.all([
    admin.from("strata_corporations").select("strata_plan_number, legal_name, building_name").eq("strata_plan_number", d.corporation_id).maybeSingle(),
    admin.from("discussion_voters").select("name, vote, recusal_reason, voted_at").eq("discussion_id", d.id).order("name"),
    admin.from("discussion_files").select("file_name").eq("discussion_id", d.id).is("comment_id", null).order("created_at"),
    d.ratified_meeting_id
      ? admin.from("meetings").select("meeting_date").eq("id", d.ratified_meeting_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (!corp) return null;

  const pdf = await discussionPdf({
    corporation: { planNumber: corp.strata_plan_number, name: corp.building_name || corp.legal_name },
    title: d.title,
    motion: d.motion,
    background: d.background,
    financial: d.financial,
    risks: d.risks,
    authorName: d.author_name,
    openedAt: d.created_at,
    closedAt: d.closed_at,
    voters: (voters ?? []).map((v) => ({ name: v.name, vote: v.vote as DiscussionVote | null, recusalReason: v.recusal_reason, votedAt: v.voted_at })),
    counts: { for: d.votes_for ?? 0, against: d.votes_against ?? 0, abstain: d.votes_abstain ?? 0, recused: d.votes_recused ?? 0, missing: d.votes_missing ?? 0 },
    result: d.result as DiscussionResult,
    attachments: (files ?? []).map((f) => f.file_name),
    ratification:
      (d.status === "ratified" || d.status === "not_ratified") && meeting
        ? { ratified: d.status === "ratified", meetingDate: (meeting as { meeting_date: string }).meeting_date }
        : null,
  });

  // Re-filing: the same document, its file replaced.
  if (d.record_document_id) {
    const { data: doc } = await admin.from("documents").select("id, storage_path").eq("id", d.record_document_id).maybeSingle();
    if (doc?.storage_path?.startsWith(`${DOCUMENTS_BUCKET}/`)) {
      const path = doc.storage_path.slice(DOCUMENTS_BUCKET.length + 1);
      const { error } = await admin.storage.from(DOCUMENTS_BUCKET).upload(path, pdf, { contentType: "application/pdf", upsert: true });
      if (error) {
        console.error("[fileDiscussionRecord] replace", error.message);
        return null;
      }
      await admin.from("documents").update({ size_bytes: pdf.byteLength, indexing_status: "pending" }).eq("id", doc.id);
      await queueDocumentIndexing([doc.id]);
      return doc.id;
    }
  }

  const name = exportFileName(corp.strata_plan_number, todayInBC(new Date(d.closed_at)), `Council Vote ${d.title}`, "pdf");
  const path = `${corp.strata_plan_number}/${randomUUID()}/${name}`;
  const { error: upErr } = await admin.storage.from(DOCUMENTS_BUCKET).upload(path, pdf, { contentType: "application/pdf" });
  if (upErr) {
    console.error("[fileDiscussionRecord] upload", upErr.message);
    return null;
  }
  const { data: doc, error } = await admin
    .from("documents")
    .insert({
      corporation_id: corp.strata_plan_number,
      category: "meetings_records",
      title: `Council vote: ${d.title}`.slice(0, 300),
      file_name: name,
      mime_type: "application/pdf",
      size_bytes: pdf.byteLength,
      storage_path: `${DOCUMENTS_BUCKET}/${path}`,
      uploaded_by: d.created_by,
      source_type: "upload",
    })
    .select("id")
    .single();
  if (error || !doc) {
    console.error("[fileDiscussionRecord] insert", error?.message);
    return null;
  }
  await admin.from("discussions").update({ record_document_id: doc.id }).eq("id", d.id);
  await queueDocumentIndexing([doc.id]);
  await queueDocumentFingerprints([doc.id]);
  return doc.id;
}

/** The vote buttons' links: each opens the confirm page for that choice (0081). */
export function voteLinks(openUrl: string): DiscussionVoteLinks {
  return { for: `${openUrl}/vote?choice=for`, against: `${openUrl}/vote?choice=against`, abstain: `${openUrl}/vote?choice=abstain` };
}

function when(iso: string) {
  const date = new Date(iso).toLocaleDateString("en-CA", { timeZone: tz("America/Vancouver", iso), month: "short", day: "numeric", year: "numeric" });
  return `${date}, ${clockTime(iso, "America/Vancouver")}`;
}

/**
 * Emails council (the discussion's voters), everyone but whoever just
 * acted: when it opens (the motion, with vote buttons), on every comment
 * (the motion, the count so far and the thread; never to anyone recused,
 * who can't see the comments), and when it closes (the result).
 */
export async function emailCouncil(discussionId: string, kind: "opened" | "comment" | "closed", actorId: string) {
  const admin = createAdminClient();
  const { data: d } = await admin
    .from("discussions")
    .select("id, corporation_id, title, motion, vote_required, status, author_name, result, votes_for, votes_against, votes_abstain, votes_recused, votes_missing")
    .eq("id", discussionId)
    .maybeSingle();
  if (!d) return;
  const [{ data: corp }, { data: voters }, { data: comments }] = await Promise.all([
    admin.from("strata_corporations").select("legal_name, building_name").eq("strata_plan_number", d.corporation_id).maybeSingle(),
    admin.from("discussion_voters").select("user_id, vote").eq("discussion_id", d.id),
    kind === "comment"
      ? admin.from("discussion_comments").select("author_name, body, created_at").eq("discussion_id", d.id).order("created_at", { ascending: false }).limit(50)
      : Promise.resolve({ data: [] as Array<{ author_name: string; body: string; created_at: string }> }),
  ]);
  const corporationName = corp?.building_name || corp?.legal_name || d.corporation_id;
  const openUrl = `${APP_URL}/strata/${encodeURIComponent(d.corporation_id)}/discussions/${d.id}`;
  const voting = Boolean(d.vote_required) && d.status === "open";
  let message;
  if (kind === "opened") {
    message = discussionOpenedEmail({ corporationName, authorName: d.author_name, title: d.title, motion: d.motion, voteLinks: voting ? voteLinks(openUrl) : null, openUrl });
  } else if (kind === "comment") {
    const counts = tally((voters ?? []).map((v) => v.vote as DiscussionVote | null));
    message = discussionCommentEmail({
      corporationName,
      title: d.title,
      motion: d.motion,
      tally: d.vote_required ? openTallyLine(counts) : null,
      comments: (comments ?? []).map((c) => ({ name: c.author_name, body: c.body, when: when(c.created_at) })),
      voteLinks: voting ? voteLinks(openUrl) : null,
      openUrl,
    });
  } else {
    message = discussionClosedEmail({
      corporationName,
      title: d.title,
      result: d.vote_required ? RESULT_LABELS[(d.result as DiscussionResult) ?? "no_majority"] : null,
      tally: d.vote_required
        ? tallyLine({ for: d.votes_for ?? 0, against: d.votes_against ?? 0, abstain: d.votes_abstain ?? 0, recused: d.votes_recused ?? 0, missing: d.votes_missing ?? 0 })
        : null,
      passed: d.result === "supported",
      openUrl,
    });
  }
  const recipients = (voters ?? [])
    .filter((v) => v.user_id && v.user_id !== actorId && !(kind === "comment" && v.vote === "recused"))
    .map((v) => v.user_id as string);
  await Promise.all(recipients.map((id) => notifyUser(id, message)));
}
