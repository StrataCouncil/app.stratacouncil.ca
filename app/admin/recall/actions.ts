"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/data/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { askClaudeText, ClaudeRefusalError } from "@/lib/ai/claude";
import { estimateCostUsd } from "@/lib/ai/pricing";
import { assembleStratasphere, finishAnswer, type MeetingScope } from "@/lib/ai/stratasphere";
import { answerCheck, findCheck, phraseLines, sentText, type AnswerResult, type FindResult, type RecallCase } from "@/lib/ai/recall";
import { figureLines } from "@/lib/ai/figures";
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
  expectedAnswer: string;
  /** One per line. */
  keyFigures: string;
  expectLegislationDocuments: string[];
  expectLegislationSections: string[];
  note: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuids = (v: unknown, max = 50) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && UUID.test(x)))].slice(0, max) : []);

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
    expected_answer: String(input.expectedAnswer ?? "").trim().slice(0, 8000),
    key_figures: figureLines(String(input.keyFigures ?? "")),
    expect_legislation_documents: uuids(input.expectLegislationDocuments),
    expect_legislation_sections: uuids(input.expectLegislationSections, 200),
    note: String(input.note ?? "").trim().slice(0, 1000),
    updated_at: new Date().toISOString(),
  };
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
  documents: Array<{ id: string; title: string; category: string | null; status: string; uploadedAt: string; copyOf: string | null }>;
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
      .select("id, title, category, indexing_status, uploaded_at, content_sha256")
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
    documents: (() => {
      // Identical copies (the same file uploaded twice) are marked, oldest first.
      const firstTitle = new Map<string, string>();
      const sorted = [...(docs.data ?? [])].sort((a, b) => String(a.uploaded_at).localeCompare(String(b.uploaded_at)));
      for (const d of sorted) if (d.content_sha256 && !firstTitle.has(d.content_sha256 as string)) firstTitle.set(d.content_sha256 as string, (d.title as string) || "Untitled");
      const firstId = new Map<string, string>();
      for (const d of sorted) if (d.content_sha256 && !firstId.has(d.content_sha256 as string)) firstId.set(d.content_sha256 as string, d.id as string);
      return (docs.data ?? []).map((d) => {
        const sha = (d.content_sha256 as string | null) ?? null;
        return {
          id: d.id as string,
          title: (d.title as string) || "Untitled",
          category: (d.category as string | null) ?? null,
          status: String(d.indexing_status ?? ""),
          uploadedAt: String(d.uploaded_at).slice(0, 10),
          copyOf: sha && firstId.get(sha) !== d.id ? (firstTitle.get(sha) ?? null) : null,
        };
      });
    })(),
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

export interface KnowledgeEntry {
  id: string;
  title: string;
  kind: string;
}

/** The Knowledge Base's indexed entries (Acts, regulations, guidance), to name in a case. */
export async function getKnowledgeEntries(): Promise<({ ok: true; entries: KnowledgeEntry[] }) | Fail> {
  if (!(await requireSuperAdmin())) return notAllowed;
  const { data, error } = await createAdminClient()
    .from("legislation_documents")
    .select("id, title, short_name, kind")
    .eq("indexing_status", "indexed")
    .order("title");
  if (error) return { ok: false, error: "Couldn't load the Knowledge Base." };
  return {
    ok: true,
    entries: (data ?? []).map((e) => ({ id: e.id as string, title: e.short_name ? `${e.title} (${e.short_name})` : (e.title as string), kind: e.kind as string })),
  };
}

/** One Knowledge Base entry's sections, in order. */
export async function getKnowledgeSections(entryId: string): Promise<({ ok: true; sections: Array<{ id: string; title: string }> }) | Fail> {
  if (!(await requireSuperAdmin())) return notAllowed;
  if (!UUID.test(entryId)) return { ok: false, error: "Choose an entry." };
  const sections: Array<{ id: string; title: string }> = [];
  // Large Acts and codes run to thousands of sections: read them all, a page at a time.
  for (let from = 0; ; from += 1000) {
    const { data, error } = await createAdminClient()
      .from("knowledge_chunks")
      .select("id, title, chunk_index")
      .eq("legislation_document_id", entryId)
      .order("chunk_index")
      .range(from, from + 999);
    if (error) return { ok: false, error: "Couldn't load that entry's sections." };
    sections.push(...(data ?? []).map((c) => ({ id: c.id as string, title: (c.title as string) || `Part ${Number(c.chunk_index) + 1}` })));
    if (!data || data.length < 1000) break;
  }
  return { ok: true, sections };
}

/** Labels for Knowledge Base entries and sections named in cases, for showing them. */
export async function knowledgeLabels(entryIds: string[], sectionIds: string[]): Promise<Record<string, string>> {
  if (!(await requireSuperAdmin())) return {};
  entryIds = uuids(entryIds, 1000);
  sectionIds = uuids(sectionIds, 5000);
  const admin = createAdminClient();
  const out: Record<string, string> = {};
  const [entries, sections] = await Promise.all([
    entryIds.length ? admin.from("legislation_documents").select("id, title, short_name").in("id", entryIds) : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
    sectionIds.length ? admin.from("knowledge_chunks").select("id, title, source_act").in("id", sectionIds) : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
  ]);
  for (const e of entries.data ?? []) out[e.id as string] = (e.short_name as string) || (e.title as string);
  for (const c of sections.data ?? []) out[c.id as string] = [c.source_act, c.title].filter(Boolean).join(", ");
  return out;
}

/** Which Knowledge Base entry each passage sent belongs to. */
async function entriesOf(hits: Array<{ id?: string; scope: string }>) {
  const ids = hits.filter((h) => h.scope === "legislation" && h.id).map((h) => h.id!);
  const map = new Map<string, string>();
  if (!ids.length) return map;
  const { data } = await createAdminClient().from("knowledge_chunks").select("id, legislation_document_id").in("id", ids);
  for (const r of data ?? []) if (r.legislation_document_id) map.set(r.id as string, r.legislation_document_id as string);
  return map;
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
  key_figures: string[];
  expect_legislation_documents: string[];
  expect_legislation_sections: string[];
};

const toCase = (r: CaseRow): RecallCase => ({
  expectDocuments: r.expect_documents ?? [],
  expectDecisions: r.expect_decisions ?? [],
  expectPhrases: r.expect_phrases ?? [],
  answerPhrases: r.answer_phrases ?? [],
  keyFigures: r.key_figures ?? [],
  expectLegislationDocuments: r.expect_legislation_documents ?? [],
  expectLegislationSections: r.expect_legislation_sections ?? [],
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
    .select("id, corporation_id, question, meeting_id, item_id, expect_documents, expect_decisions, expect_phrases, answer_phrases, key_figures, expect_legislation_documents, expect_legislation_sections")
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
  const result = findCheck(
    toCase(c),
    built.prepared.diagnostics,
    sentText(built.prepared.system, built.prepared.messages),
    await entriesOf(built.prepared.diagnostics.hits)
  );
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
  const calculations: Array<{ name: string; input: unknown; result: string }> = [];
  try {
    const { text, truncated, usage } = await askClaudeText({
      system: prepared.system,
      messages: prepared.messages,
      effort: prepared.effort,
      maxTokens: prepared.maxTokens,
      tools: prepared.tools,
      cache: true,
      onToolCall: (call) => calculations.push(call),
    });
    const cost = estimateCostUsd(usage);
    const done = finishAnswer(prepared, text);
    const answer = truncated ? `${done.text}\n[Answer cut short.]` : done.text;
    const result = answerCheck(toCase(c), answer, done.sources);
    // How it got the answer: each record it cited, with the text that was
    // sent, in the order it cited them; and the search results it didn't use.
    const cited = done.cited.map((r) => ({ ...r, excerpt: r.excerpt?.slice(0, 6000) }));
    const unused = prepared.records
      .filter((r) => !done.tags.includes(r.tag) && ["document", "legislation", "precedent", "attachment"].includes(r.kind))
      .map((r) => ({ ...r, excerpt: r.excerpt?.slice(0, 1500) }));
    // What was sent with it, so a wrong answer can be traced to a missing record.
    const find = findCheck(toCase(c), prepared.diagnostics, sentText(prepared.system, prepared.messages), await entriesOf(prepared.diagnostics.hits));
    await saveRun(
      c.id,
      "answer",
      result.passed,
      { ...result, answer, rawAnswer: text, sources: done.sources, cited, unused, usage, calculations, find },
      who.user.id,
      cost
    );
    revalidatePath("/admin/recall");
    return { ok: true, passed: result.passed, answer, result, costUsd: cost, problem: null };
  } catch (err) {
    if (err instanceof ClaudeRefusalError) return { ok: false, error: "The AI declined this question." };
    console.error("[recall] answer", err instanceof Error ? err.message : err);
    return { ok: false, error: "The AI couldn't answer right now. Try again." };
  }
}

/** A person's verdict on an answering run: Right, Partly, or Wrong, with a note. */
export async function markRecallAnswer(runId: string, verdict: "right" | "partly" | "wrong" | null, note: string): Promise<{ ok: true } | Fail> {
  const who = await requireSuperAdmin();
  if (!who) return notAllowed;
  if (!UUID.test(runId)) return { ok: false, error: "That result no longer exists." };
  if (verdict !== null && !["right", "partly", "wrong"].includes(verdict)) return { ok: false, error: "Choose Right, Partly, or Wrong." };
  const { error } = await createAdminClient()
    .from("stratasphere_recall_runs")
    .update({
      verdict,
      verdict_note: String(note ?? "").trim().slice(0, 4000),
      verdict_by: verdict ? who.user.id : null,
      verdict_at: verdict ? new Date().toISOString() : null,
    })
    .eq("id", runId)
    .eq("kind", "answer");
  if (error) {
    console.error("[recall] verdict", error.message);
    return { ok: false, error: "Couldn't save the marking." };
  }
  revalidatePath("/admin/recall");
  return { ok: true };
}
