"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/data/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { askClaudeText, ClaudeRefusalError } from "@/lib/ai/claude";
import { estimateCostUsd } from "@/lib/ai/pricing";
import { assembleStratasphere, finalSources, type MeetingScope } from "@/lib/ai/stratasphere";
import { answerCheck, findCheck, phraseLines, sentText, type AnswerResult, type FindResult, type RecallCase } from "@/lib/ai/recall";
import { meetingTypeLabels, normalizeAgenda, type MeetingType } from "@/lib/meetings/agenda";

/**
 * The Stratasphere recall check (docs/learn-decide-remember.md §7), Super
 * Admins only. Cases and runs are server-only (0089): every read and write
 * here is the service role, after requireSuperAdmin(). The request itself is
 * built with the Super Admin's own client, exactly as for a question (RLS:
 * a Super Admin reads the strata as its admin would).
 *
 * The finding check never calls the AI. The answering check does, once per
 * case, and its cost is recorded with the run (not in stratasphere_usage,
 * which is the stratas' own use).
 */

type Fail = { ok: false; error: string };
const notAllowed: Fail = { ok: false, error: "Only Super Admins can use the recall check." };

export interface RecallCaseInput {
  id?: string;
  corporationId: string;
  question: string;
  meetingId: string | null;
  itemId: string | null;
  expectDocuments: string[];
  expectDecisions: string[];
  expectPhrases: string;
  answerPhrases: string;
  note: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuids = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && UUID.test(x)))].slice(0, 50) : []);

export async function saveRecallCase(input: RecallCaseInput): Promise<{ ok: true; id: string } | Fail> {
  const who = await requireSuperAdmin();
  if (!who) return notAllowed;
  const question = String(input.question ?? "").trim().slice(0, 4000);
  if (!question) return { ok: false, error: "Write the question." };
  const corporationId = String(input.corporationId ?? "").trim();
  if (!corporationId) return { ok: false, error: "Choose the strata." };
  const meetingId = input.meetingId && UUID.test(input.meetingId) ? input.meetingId : null;
  const itemId = meetingId && input.itemId ? String(input.itemId).slice(0, 100) : null;
  const row = {
    corporation_id: corporationId,
    question,
    meeting_id: meetingId,
    item_id: itemId,
    expect_documents: uuids(input.expectDocuments),
    expect_decisions: uuids(input.expectDecisions),
    expect_phrases: phraseLines(String(input.expectPhrases ?? "")),
    answer_phrases: phraseLines(String(input.answerPhrases ?? "")),
    note: String(input.note ?? "").trim().slice(0, 1000),
    updated_at: new Date().toISOString(),
  };
  if (!row.expect_documents.length && !row.expect_decisions.length && !row.expect_phrases.length) {
    return { ok: false, error: "Name at least one record that holds the answer: a document, a decision, or a phrase." };
  }
  const admin = createAdminClient();
  const { data, error } = input.id
    ? await admin.from("stratasphere_recall_cases").update(row).eq("id", input.id).select("id").single()
    : await admin.from("stratasphere_recall_cases").insert({ ...row, created_by: who.user.id }).select("id").single();
  if (error || !data) {
    console.error("[recall] save", error?.message);
    return { ok: false, error: error?.message.includes("foreign key") ? "That strata or meeting no longer exists." : "Couldn't save the case." };
  }
  revalidatePath("/admin/recall");
  return { ok: true, id: data.id as string };
}

export async function deleteRecallCase(id: string): Promise<{ ok: true } | Fail> {
  if (!(await requireSuperAdmin())) return notAllowed;
  const { error } = await createAdminClient().from("stratasphere_recall_cases").delete().eq("id", id);
  if (error) return { ok: false, error: "Couldn't delete the case." };
  revalidatePath("/admin/recall");
  return { ok: true };
}

export interface StrataRecords {
  documents: Array<{ id: string; title: string; category: string | null; status: string; uploadedAt: string }>;
  decisions: Array<{ id: string; title: string; decidedAt: string; meetingType: string | null }>;
  meetings: Array<{ id: string; label: string; items: Array<{ id: string; label: string }> }>;
  subscribed: boolean;
}

/** One strata's documents, ledger decisions, and meetings, to pick from when writing a case. */
export async function getStrataRecords(corporationId: string): Promise<({ ok: true } & StrataRecords) | Fail> {
  if (!(await requireSuperAdmin())) return notAllowed;
  const admin = createAdminClient();
  const [docs, decisions, meetings, sub] = await Promise.all([
    admin
      .from("documents")
      .select("id, title, category, indexing_status, uploaded_at")
      .eq("corporation_id", corporationId)
      .order("uploaded_at", { ascending: false })
      .limit(1000),
    admin.from("decisions").select("id, title, decided_at, meeting_type").eq("corporation_id", corporationId).order("decided_at", { ascending: false }).limit(2000),
    admin.from("meetings").select("id, meeting_date, type, agenda").eq("corporation_id", corporationId).order("meeting_date", { ascending: false }).limit(200),
    admin.from("subscriptions").select("status").eq("corporation_id", corporationId).maybeSingle(),
  ]);
  if (docs.error || decisions.error || meetings.error) return { ok: false, error: "Couldn't load that strata's records." };
  return {
    ok: true,
    subscribed: sub.data?.status === "active",
    documents: (docs.data ?? []).map((d) => ({
      id: d.id as string,
      title: (d.title as string) || "Untitled",
      category: (d.category as string | null) ?? null,
      status: String(d.indexing_status ?? ""),
      uploadedAt: String(d.uploaded_at).slice(0, 10),
    })),
    decisions: (decisions.data ?? []).map((d) => ({
      id: d.id as string,
      title: (d.title as string) || "Untitled decision",
      decidedAt: String(d.decided_at).slice(0, 10),
      meetingType: (d.meeting_type as string | null) ?? null,
    })),
    meetings: (meetings.data ?? []).map((m) => ({
      id: m.id as string,
      label: `${String(m.meeting_date).slice(0, 10)}, ${meetingTypeLabels[m.type as MeetingType] ?? m.type}`,
      items: normalizeAgenda(m.agenda).map((it) => ({ id: it.id, label: `${it.num}. ${it.text || it.cat || "Untitled item"}` })),
    })),
  };
}

type CaseRow = {
  id: string;
  corporation_id: string;
  question: string;
  meeting_id: string | null;
  item_id: string | null;
  expect_documents: string[];
  expect_decisions: string[];
  expect_phrases: string[];
  answer_phrases: string[];
};

const toCase = (r: CaseRow): RecallCase => ({
  expectDocuments: r.expect_documents ?? [],
  expectDecisions: r.expect_decisions ?? [],
  expectPhrases: r.expect_phrases ?? [],
  answerPhrases: r.answer_phrases ?? [],
});

/** The request for a case, built exactly as Stratasphere builds it for a question (no history). */
async function buildRequest(supabase: Parameters<typeof assembleStratasphere>[0]["supabase"], c: CaseRow) {
  let meeting: MeetingScope | undefined;
  if (c.meeting_id && c.item_id) {
    const { data: m } = await createAdminClient().from("meetings").select("type, agenda").eq("id", c.meeting_id).maybeSingle();
    const agenda = normalizeAgenda(m?.agenda);
    const item = agenda.find((i) => i.id === c.item_id);
    if (!m || !item) return { ok: false as const, error: "The agenda item this case asks about no longer exists." };
    meeting = { item, agenda, meetingLabel: meetingTypeLabels[m.type as MeetingType] ?? "meeting" };
  }
  const prepared = await assembleStratasphere({ supabase, corpId: c.corporation_id, question: c.question, history: [], meeting });
  if (!prepared.ok) return { ok: false as const, error: prepared.error };
  return { ok: true as const, prepared, meeting };
}

async function loadCase(id: string) {
  const { data } = await createAdminClient()
    .from("stratasphere_recall_cases")
    .select("id, corporation_id, question, meeting_id, item_id, expect_documents, expect_decisions, expect_phrases, answer_phrases")
    .eq("id", id)
    .maybeSingle();
  return (data as CaseRow | null) ?? null;
}

async function isSubscribed(corporationId: string) {
  const { data } = await createAdminClient().from("subscriptions").select("status").eq("corporation_id", corporationId).maybeSingle();
  return data?.status === "active";
}

async function saveRun(caseId: string, kind: "find" | "answer", passed: boolean, details: Record<string, unknown>, userId: string, cost = 0) {
  const { error } = await createAdminClient()
    .from("stratasphere_recall_runs")
    .insert({ case_id: caseId, kind, passed, details, cost_usd: Number(cost.toFixed(5)), created_by: userId });
  if (error) console.error("[recall] save run", error.message);
}

export type FindRun = { ok: true; passed: boolean; result: FindResult | null; problem: string | null };

/** The finding check for one case: builds the request, never calls the AI. */
export async function runFindCheck(caseId: string): Promise<FindRun | Fail> {
  const who = await requireSuperAdmin();
  if (!who) return notAllowed;
  const c = await loadCase(caseId);
  if (!c) return { ok: false, error: "That case no longer exists." };
  if (!(await isSubscribed(c.corporation_id))) {
    // Stratasphere can't search an unsubscribed strata, so a run would only measure that.
    const problem = "This strata isn't subscribed, so Stratasphere can't search it. Subscribe it (complimentary works) to check it.";
    await saveRun(c.id, "find", false, { problem }, who.user.id);
    return { ok: true, passed: false, result: null, problem };
  }
  const built = await buildRequest(who.supabase, c);
  if (!built.ok) {
    await saveRun(c.id, "find", false, { problem: built.error }, who.user.id);
    return { ok: true, passed: false, result: null, problem: built.error };
  }
  const result = findCheck(toCase(c), built.prepared.diagnostics, sentText(built.prepared.system, built.prepared.messages));
  await saveRun(c.id, "find", result.passed, { ...result }, who.user.id);
  revalidatePath("/admin/recall");
  return { ok: true, passed: result.passed, result, problem: null };
}

export type AnswerRun = { ok: true; passed: boolean; answer: string; result: AnswerResult | null; costUsd: number; problem: string | null };

/** The answering check for one case: asks the AI once, exactly as Stratasphere would. */
export async function runAnswerCheck(caseId: string): Promise<AnswerRun | Fail> {
  const who = await requireSuperAdmin();
  if (!who) return notAllowed;
  const c = await loadCase(caseId);
  if (!c) return { ok: false, error: "That case no longer exists." };
  if (!(await isSubscribed(c.corporation_id))) {
    return { ok: false, error: "This strata isn't subscribed, so Stratasphere can't answer for it." };
  }
  const built = await buildRequest(who.supabase, c);
  if (!built.ok) return { ok: false, error: built.error };
  const { prepared } = built;
  try {
    const { text, truncated, usage } = await askClaudeText({
      system: prepared.system,
      messages: prepared.messages,
      effort: prepared.effort,
      maxTokens: prepared.maxTokens,
      cache: true,
    });
    const cost = estimateCostUsd(usage);
    const answer = truncated ? `${text}\n[Answer cut short.]` : text;
    const sources = finalSources(prepared, text);
    const result = answerCheck(toCase(c), answer, sources);
    await saveRun(c.id, "answer", result.passed, { ...result, answer, sources, usage }, who.user.id, cost);
    revalidatePath("/admin/recall");
    return { ok: true, passed: result.passed, answer, result, costUsd: cost, problem: null };
  } catch (err) {
    if (err instanceof ClaudeRefusalError) return { ok: false, error: "The AI declined this question." };
    console.error("[recall] answer", err instanceof Error ? err.message : err);
    return { ok: false, error: "The AI couldn't answer right now. Try again." };
  }
}
