"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { acceptedExtensions, fileExtension, MAX_DOCUMENT_BYTES } from "@/lib/documents";
import { DISCUSSION_FILES_BUCKET, emailCouncil, fileDiscussionRecord } from "@/lib/discussions/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getStrataAccess } from "@/lib/data/strata";
import { draftMotionText } from "@/lib/ai/draft-motion";
import { IS_DEMO, demoLimitFail, type DemoLimitFail } from "@/lib/demo";
import { logDemoActivity, refundDemoAllowance, takeDemoAllowance } from "@/lib/demo-usage";

/**
 * Council discussions (0070). The database decides who may do what
 * (create_discussion, update_discussion, cast_discussion_vote,
 * add_discussion_comment, close_discussion all check council membership,
 * authorship and the motion lock); these actions pass its reasons on, then
 * do what only the server can: attachments, the vote record, and email.
 */

type Fail = { ok: false; error: string };
type Ok<T = object> = { ok: true } & T;

export interface DiscussionInput {
  title: string;
  background: string;
  financial: string;
  risks: string;
  motion: string;
}

const MAX_FILES = 10;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The database's own message, without its error code prefix, for the ones written for people. */
function reason(message: string, fallback: string) {
  const known = [
    "Only council",
    "Only council members and those who run meetings",
    "Only the person",
    "free_discussion_used",
    "motion_locked",
    "closed",
    "Choose For",
    "conflict of interest",
    "weren't on council",
    "taking part",
  ];
  if (!known.some((k) => message.includes(k))) return fallback;
  return message.replace(/^[a-z_]+: /, "");
}

function refresh(corpId: string, id?: string) {
  revalidatePath(`/strata/${corpId}/discussions`);
  if (id) revalidatePath(`/strata/${corpId}/discussions/${id}`);
}

function clean(input: DiscussionInput): DiscussionInput | string {
  const out = {
    title: String(input.title ?? "").trim().slice(0, 200),
    background: String(input.background ?? "").trim().slice(0, 10000),
    financial: String(input.financial ?? "").trim().slice(0, 10000),
    risks: String(input.risks ?? "").trim().slice(0, 10000),
    motion: String(input.motion ?? "").trim().slice(0, 4000),
  };
  if (!out.title) return "Give the discussion a title.";
  if (!out.motion) return "Write the motion council is voting on.";
  return out;
}

export async function createDiscussion(corpId: string, input: DiscussionInput): Promise<Ok<{ id: string }> | Fail> {
  const fields = clean(input);
  if (typeof fields === "string") return { ok: false, error: fields };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  const { data, error } = await supabase.rpc("create_discussion", {
    p_corporation_id: corpId,
    p_title: fields.title,
    p_background: fields.background,
    p_financial: fields.financial,
    p_risks: fields.risks,
    p_motion: fields.motion,
  });
  if (error || !data) {
    console.error("[createDiscussion]", error?.message);
    return { ok: false, error: reason(error?.message ?? "", "Couldn't start the discussion.") };
  }
  await emailCouncil(data as string, "opened", user.id);
  refresh(corpId);
  return { ok: true, id: data as string };
}

export async function updateDiscussion(corpId: string, id: string, input: DiscussionInput): Promise<Ok | Fail> {
  const fields = clean(input);
  if (typeof fields === "string") return { ok: false, error: fields };
  const { error } = await (await createClient()).rpc("update_discussion", {
    p_discussion_id: id,
    p_title: fields.title,
    p_background: fields.background,
    p_financial: fields.financial,
    p_risks: fields.risks,
    p_motion: fields.motion,
  });
  if (error) return { ok: false, error: reason(error.message, "Couldn't save the changes.") };
  refresh(corpId, id);
  return { ok: true };
}

export async function castVote(corpId: string, id: string, vote: string, recusalReason?: string): Promise<Ok | Fail> {
  const { error } = await (await createClient()).rpc("cast_discussion_vote", {
    p_discussion_id: id,
    p_vote: vote,
    p_reason: recusalReason?.slice(0, 1000) ?? null,
  });
  if (error) return { ok: false, error: reason(error.message, "Couldn't record your vote.") };
  refresh(corpId, id);
  return { ok: true };
}

export async function addComment(corpId: string, id: string, body: string): Promise<Ok<{ commentId: string }> | Fail> {
  const text = String(body ?? "").trim().slice(0, 5000);
  if (!text) return { ok: false, error: "Write your comment first." };
  const { data, error } = await (await createClient()).rpc("add_discussion_comment", { p_discussion_id: id, p_body: text });
  if (error || !data) return { ok: false, error: reason(error?.message ?? "", "Couldn't post your comment.") };
  refresh(corpId, id);
  return { ok: true, commentId: data as string };
}

export async function closeDiscussion(corpId: string, id: string): Promise<Ok | Fail> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  const { error } = await supabase.rpc("close_discussion", { p_discussion_id: id });
  if (error) return { ok: false, error: reason(error.message, "Couldn't close the discussion.") };
  // The vote is closed whatever happens next; a record or email that fails is logged, not undone.
  await fileDiscussionRecord(id);
  await emailCouncil(id, "closed", user.id);
  refresh(corpId, id);
  revalidatePath(`/strata/${corpId}/documents`, "layout");
  return { ok: true };
}

/**
 * Attachments: to the motion (the author, before anyone has voted) or to a
 * comment (its author, while the discussion is open). Signed upload links
 * into the private discussion-files bucket.
 */
async function canAttach(corpId: string, id: string, commentId: string | null): Promise<string | null> {
  if (!UUID.test(id) || (commentId && !UUID.test(commentId))) return "That discussion isn't available.";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "Please sign in again.";
  const { data: d } = await supabase.from("discussions").select("id, status, created_by").eq("id", id).eq("corporation_id", corpId).maybeSingle();
  if (!d) return "That discussion isn't available.";
  if (d.status !== "open") return "This discussion is closed.";
  if (commentId) {
    const { data: c } = await supabase.from("discussion_comments").select("user_id").eq("id", commentId).eq("discussion_id", id).maybeSingle();
    if (!c || c.user_id !== user.id) return "You can only add files to your own comment.";
    return null;
  }
  if (d.created_by !== user.id) return "Only the person who started this discussion can attach files to the motion.";
  const { count } = await supabase.from("discussion_voters").select("id", { count: "exact", head: true }).eq("discussion_id", id).not("vote", "is", null);
  if ((count ?? 0) > 0) return "Someone has voted, so the motion's attachments can no longer change.";
  return null;
}

export interface DiscussionUploadTicket {
  name: string;
  path: string;
  token: string;
}

export async function createDiscussionUploads(
  corpId: string,
  id: string,
  commentId: string | null,
  files: Array<{ name: string; size: number }>
): Promise<Ok<{ tickets: DiscussionUploadTicket[] }> | Fail> {
  const denied = await canAttach(corpId, id, commentId);
  if (denied) return { ok: false, error: denied };
  if (files.length > MAX_FILES) return { ok: false, error: `Attach up to ${MAX_FILES} files at a time.` };
  for (const f of files) {
    if (!(acceptedExtensions as readonly string[]).includes(fileExtension(f.name))) {
      return { ok: false, error: `${f.name}: only ${acceptedExtensions.join(", ")} files can be attached.` };
    }
    if (f.size > MAX_DOCUMENT_BYTES) return { ok: false, error: `${f.name} is over the 50 MB limit.` };
    if (f.size === 0) return { ok: false, error: `${f.name} is empty.` };
  }
  const admin = createAdminClient();
  const tickets: DiscussionUploadTicket[] = [];
  for (const f of files) {
    const safe = f.name.normalize("NFKD").replace(/[^\w.\- ]+/g, "").replace(/\s+/g, "_").slice(-120) || "file";
    const path = `${corpId}/${id}/${randomUUID()}/${safe}`;
    const { data, error } = await admin.storage.from(DISCUSSION_FILES_BUCKET).createSignedUploadUrl(path);
    if (error || !data) {
      console.error("[createDiscussionUploads]", error?.message);
      return { ok: false, error: "Couldn't start the upload. Please try again." };
    }
    tickets.push({ name: f.name, path, token: data.token });
  }
  return { ok: true, tickets };
}

export async function registerDiscussionFiles(
  corpId: string,
  id: string,
  commentId: string | null,
  files: Array<{ path: string; name: string; size: number; type: string }>
): Promise<Ok | Fail> {
  const denied = await canAttach(corpId, id, commentId);
  if (denied) return { ok: false, error: denied };
  const {
    data: { user },
  } = await (await createClient()).auth.getUser();
  const admin = createAdminClient();
  for (const f of files) {
    const parts = f.path.split("/");
    if (parts.length !== 4 || parts[0] !== corpId || parts[1] !== id || parts.some((p) => !p || p === "..")) {
      return { ok: false, error: "That upload doesn't belong to this discussion." };
    }
    const { data: listed } = await admin.storage.from(DISCUSSION_FILES_BUCKET).list(parts.slice(0, 3).join("/"), { search: parts[3] });
    if (!listed?.some((o) => o.name === parts[3])) return { ok: false, error: `${f.name} didn't finish uploading. Please try again.` };
  }
  const { error } = await admin.from("discussion_files").insert(
    files.map((f) => ({
      discussion_id: id,
      comment_id: commentId,
      storage_path: f.path,
      file_name: f.name.slice(0, 300),
      mime_type: f.type || null,
      size_bytes: f.size,
      uploaded_by: user?.id ?? null,
    }))
  );
  if (error) {
    console.error("[registerDiscussionFiles]", error.message);
    return { ok: false, error: "Couldn't save the attachments." };
  }
  refresh(corpId, id);
  return { ok: true };
}

/**
 * Draft a discussion's motion with Stratasphere, from its title and context
 * fields (personal details swapped out first, as for agenda items). Nothing
 * is saved: the draft lands in the motion field to edit.
 */
export async function draftDiscussionMotion(
  corpId: string,
  input: { title: string; background: string; financial: string; risks: string }
): Promise<Ok<{ motionText: string }> | Fail | DemoLimitFail> {
  const access = await getStrataAccess(corpId);
  if (!access?.seesDiscussions) return { ok: false, error: "Only council members and those who run meetings can start a discussion." };
  if (!access.subscribed && access.freeMeetingUsed) {
    return { ok: false, error: "Drafting a motion uses Stratasphere AI, which needs a subscription." };
  }
  if (!String(input.title ?? "").trim()) return { ok: false, error: "Give the discussion a title first." };
  if (IS_DEMO && !(await takeDemoAllowance("motions"))) {
    await logDemoActivity({ kind: "limit", detail: { reason: "motion drafts" } });
    return demoLimitFail();
  }
  const r = await draftMotionText(access.corpId, "council, voting on a motion between meetings", {
    label: "Discussion",
    text: String(input.title).slice(0, 500),
    background: String(input.background ?? ""),
    financial: String(input.financial ?? ""),
    risks: String(input.risks ?? ""),
    decisionType: "Majority of council",
  });
  if (!r.ok) {
    if (IS_DEMO) await refundDemoAllowance("motions");
    return r;
  }
  await logDemoActivity({ kind: "motion.drafted", detail: { item: input.title, motion: r.motionText } });
  return r;
}
