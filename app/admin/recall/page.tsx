import { notFound } from "next/navigation";
import { AdminTabs } from "@/components/AdminTabs";
import { AppShell } from "@/components/AppShell";
import { RecallAdmin, type RecallCaseView } from "@/components/RecallAdmin";
import { requireSuperAdmin } from "@/lib/data/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { knowledgeLabels } from "@/app/admin/recall/actions";
import { compareWithReference } from "@/lib/ai/recall";

/** Answering checks call the AI once per case; leave room for one slow answer. */
export const maxDuration = 300;

/** What an assistant question costs when nothing has been measured yet (EPS9048, 2026-11-12). */
const FALLBACK_COST_USD = 0.27;

/**
 * The Stratasphere recall check (docs/learn-decide-remember.md §7): test
 * questions with the records that answer them, checked against the request
 * Stratasphere really builds. Super Admins only.
 */
export default async function RecallPage() {
  if (!(await requireSuperAdmin())) notFound();
  const admin = createAdminClient();
  const [cases, runs, corps, usage] = await Promise.all([
    admin
      .from("stratasphere_recall_cases")
      .select("id, corporation_id, question, meeting_id, item_id, expect_documents, expect_decisions, expect_phrases, answer_phrases, expected_answer, key_figures, expect_legislation_documents, expect_legislation_sections, note, created_at")
      .order("corporation_id")
      .order("created_at"),
    admin.from("stratasphere_recall_runs").select("id, case_id, kind, passed, details, cost_usd, created_at, verdict, verdict_note").order("created_at", { ascending: false }).limit(3000),
    admin.from("strata_corporations").select("strata_plan_number, building_name, legal_name").order("strata_plan_number"),
    admin.from("stratasphere_usage").select("cost_usd").eq("surface", "assistant").order("created_at", { ascending: false }).limit(200),
  ]);

  // The newest run of each kind, per case; and the newest answer marked Right.
  const latest = new Map<string, RecallCaseView["find"]>();
  const rightRun = new Map<string, { id: string; at: string; details: Record<string, unknown> }>();
  for (const r of runs.data ?? []) {
    if (r.kind === "answer" && r.verdict === "right" && !rightRun.has(r.case_id)) {
      rightRun.set(r.case_id, { id: r.id, at: r.created_at, details: r.details as Record<string, unknown> });
    }
  }
  for (const r of runs.data ?? []) {
    const key = `${r.case_id}:${r.kind}`;
    if (!latest.has(key)) {
      latest.set(key, {
        id: r.id,
        passed: r.passed,
        at: r.created_at,
        details: r.details as Record<string, unknown>,
        costUsd: Number(r.cost_usd),
        verdict: (r.verdict as "right" | "partly" | "wrong" | null) ?? null,
        verdictNote: r.verdict_note ?? "",
      });
    }
  }
  const view: RecallCaseView[] = (cases.data ?? []).map((c) => ({
    id: c.id,
    corporationId: c.corporation_id,
    question: c.question,
    meetingId: c.meeting_id,
    itemId: c.item_id,
    expectDocuments: c.expect_documents ?? [],
    expectDecisions: c.expect_decisions ?? [],
    expectPhrases: c.expect_phrases ?? [],
    answerPhrases: c.answer_phrases ?? [],
    expectedAnswer: c.expected_answer ?? "",
    keyFigures: c.key_figures ?? [],
    expectLegislationDocuments: c.expect_legislation_documents ?? [],
    expectLegislationSections: c.expect_legislation_sections ?? [],
    note: c.note ?? "",
    find: latest.get(`${c.id}:find`) ?? null,
    answer: latest.get(`${c.id}:answer`) ?? null,
    reference: (() => {
      const ref = rightRun.get(c.id);
      const now = latest.get(`${c.id}:answer`);
      if (!ref) return null;
      if (!now || now.id === ref.id) return { at: ref.at, comparison: null };
      type Cited = { kind: string; title: string; documentId?: string; decisionId?: string; chunkId?: string };
      const shape = (d: Record<string, unknown>) => ({ answer: String(d.answer ?? ""), cited: (Array.isArray(d.cited) ? d.cited : []) as Cited[] });
      return { at: ref.at, comparison: compareWithReference(shape(now.details), shape(ref.details)) };
    })(),
  }));
  const labels = await knowledgeLabels(
    [...new Set(view.flatMap((c) => c.expectLegislationDocuments))],
    [...new Set(view.flatMap((c) => c.expectLegislationSections))]
  );
  const costs = (usage.data ?? []).map((u) => Number(u.cost_usd)).filter((n) => n > 0);
  const costPerQuestion = costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : FALLBACK_COST_USD;

  return (
    <AppShell active="admin">
      <div className="wrap page">
        <AdminTabs active="recall" />
        <div className="page-header">
          <h1>Stratasphere recall</h1>
          <p>
            Questions a council member would ask. <strong>Ask</strong> puts each one to Stratasphere exactly as a member
            would. Its answer comes with how it got there: each record it used, with the passage itself, and its
            calculations. Check them, then mark the answer Right, Partly, or Wrong. Once an answer is marked Right,
            each new answer is compared with it, so only one that changes needs reading again.
          </p>
        </div>
        <RecallAdmin
          cases={view}
          corporations={(corps.data ?? []).map((c) => ({ id: c.strata_plan_number, name: c.building_name || c.legal_name || c.strata_plan_number }))}
          costPerQuestion={costPerQuestion}
          knowledgeLabels={labels}
        />
      </div>
    </AppShell>
  );
}
