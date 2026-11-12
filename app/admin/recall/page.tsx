import { notFound } from "next/navigation";
import { AdminTabs } from "@/components/AdminTabs";
import { AppShell } from "@/components/AppShell";
import { RecallAdmin, type RecallCaseView } from "@/components/RecallAdmin";
import { requireSuperAdmin } from "@/lib/data/admin";
import { createAdminClient } from "@/lib/supabase/admin";

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
      .select("id, corporation_id, question, meeting_id, item_id, expect_documents, expect_decisions, expect_phrases, answer_phrases, note, created_at")
      .order("corporation_id")
      .order("created_at"),
    admin.from("stratasphere_recall_runs").select("case_id, kind, passed, details, cost_usd, created_at").order("created_at", { ascending: false }).limit(3000),
    admin.from("strata_corporations").select("strata_plan_number, building_name, legal_name").order("strata_plan_number"),
    admin.from("stratasphere_usage").select("cost_usd").eq("surface", "assistant").order("created_at", { ascending: false }).limit(200),
  ]);

  // The newest run of each kind, per case.
  const latest = new Map<string, RecallCaseView["find"]>();
  for (const r of runs.data ?? []) {
    const key = `${r.case_id}:${r.kind}`;
    if (!latest.has(key)) latest.set(key, { passed: r.passed, at: r.created_at, details: r.details as Record<string, unknown>, costUsd: Number(r.cost_usd) });
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
    note: c.note ?? "",
    find: latest.get(`${c.id}:find`) ?? null,
    answer: latest.get(`${c.id}:answer`) ?? null,
  }));
  const costs = (usage.data ?? []).map((u) => Number(u.cost_usd)).filter((n) => n > 0);
  const costPerQuestion = costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : FALLBACK_COST_USD;

  return (
    <AppShell active="admin">
      <div className="wrap page">
        <AdminTabs active="recall" />
        <div className="page-header">
          <h1>Stratasphere recall</h1>
          <p>
            Questions with the records that answer them. <strong>Check finding</strong> builds the request exactly as
            Stratasphere would and checks that each record reaches the AI. It doesn&rsquo;t call the AI, so it costs
            nothing. <strong>Check answer</strong> also asks the AI and checks the answer states what it should and
            cites the records. No change to how Stratasphere finds records ships unless every case passes the finding
            check.
          </p>
        </div>
        <RecallAdmin
          cases={view}
          corporations={(corps.data ?? []).map((c) => ({ id: c.strata_plan_number, name: c.building_name || c.legal_name || c.strata_plan_number }))}
          costPerQuestion={costPerQuestion}
        />
      </div>
    </AppShell>
  );
}
