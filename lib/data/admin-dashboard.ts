import { requireSuperAdmin } from "@/lib/data/admin";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Everything the Super Admin needs to see about one strata at a glance:
 * people, records, meetings, decisions, subscription and Stratasphere
 * usage. Service-role reads, after requireSuperAdmin(). Null for anyone
 * else.
 */
export interface StrataDashboard {
  createdAt: string | null;
  people: { active: number; invited: number; pendingInvites: number; pendingJoinRequests: number };
  lots: { total: number; named: number };
  documents: {
    total: number;
    indexed: number;
    inProgress: number;
    problems: number;
    lastUploadedAt: string | null;
    byCategory: { category: string; count: number }[];
  };
  meetings: { total: number; draft: number; live: number; adjourned: number; noQuorum: number; lastHeldAt: string | null; nextDate: string | null };
  decisions: { total: number; lastDecidedAt: string | null };
  conversations: number;
  subscription: { status: string; interval: string | null; activatedAt: string | null; periodEnd: string | null; freeMeetingUsed: boolean };
  /** Stripe test mode (0029), and whether Stripe IDs are on file. */
  stripe: { sandbox: boolean; hasCustomer: boolean; hasSubscription: boolean };
  usage: {
    questions: number;
    questions30: number;
    costUsd: number;
    cost30Usd: number;
    users30: number;
    meetingQuestions: number;
    lastAt: string | null;
  };
}

export async function getStrataDashboard(corpId: string): Promise<StrataDashboard | null> {
  if (!(await requireSuperAdmin())) return null;
  const admin = createAdminClient();
  const count = (q: PromiseLike<{ count: number | null }>) => q.then((r) => r.count ?? 0);
  const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString();

  const [
    corp,
    sub,
    memberships,
    pendingInvites,
    pendingJoinRequests,
    lotsTotal,
    lotsNamed,
    docs,
    meetings,
    decisionsTotal,
    lastDecision,
    conversations,
    usage,
  ] = await Promise.all([
    admin.from("strata_corporations").select("created_at, free_meeting_used, stripe_sandbox").eq("strata_plan_number", corpId).maybeSingle(),
    admin.from("subscriptions").select("status, billing_interval, activated_at, current_period_end, stripe_customer_id, stripe_subscription_id").eq("corporation_id", corpId).maybeSingle(),
    admin.from("corporation_memberships").select("status").eq("corporation_id", corpId),
    count(admin.from("corporation_invites").select("id", { count: "exact", head: true }).eq("corporation_id", corpId).eq("status", "pending")),
    count(admin.from("corporation_join_requests").select("id", { count: "exact", head: true }).eq("corporation_id", corpId).eq("status", "pending")),
    count(admin.from("owners_and_council").select("id", { count: "exact", head: true }).eq("corporation_id", corpId)),
    count(admin.from("owners_and_council").select("id", { count: "exact", head: true }).eq("corporation_id", corpId).not("full_name", "is", null)),
    admin.from("documents").select("category, indexing_status, uploaded_at").eq("corporation_id", corpId).limit(10000),
    admin.from("meetings").select("status, meeting_date, actual_start_at, adjourned_at").eq("corporation_id", corpId).limit(5000),
    count(admin.from("decisions").select("id", { count: "exact", head: true }).eq("corporation_id", corpId)),
    admin.from("decisions").select("decided_at").eq("corporation_id", corpId).order("decided_at", { ascending: false }).limit(1).maybeSingle(),
    count(admin.from("conversations").select("id", { count: "exact", head: true }).eq("corporation_id", corpId)),
    admin.from("stratasphere_usage").select("user_id, surface, cost_usd, created_at").eq("corporation_id", corpId).order("created_at", { ascending: false }).limit(20000),
  ]);

  const docRows = docs.data ?? [];
  const byCategory = new Map<string, number>();
  for (const d of docRows) byCategory.set(d.category ?? "uncategorized", (byCategory.get(d.category ?? "uncategorized") ?? 0) + 1);

  const meetingRows = meetings.data ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const adjourned = meetingRows.filter((m) => m.status === "ADJOURNED");
  const upcoming = meetingRows.filter((m) => m.status !== "ADJOURNED" && m.meeting_date >= today).map((m) => m.meeting_date).sort();

  const usageRows = usage.data ?? [];
  const recent = usageRows.filter((u) => u.created_at >= since30);
  const sum = (rows: typeof usageRows) => rows.reduce((n, u) => n + Number(u.cost_usd ?? 0), 0);

  const memberRows = memberships.data ?? [];
  return {
    createdAt: corp.data?.created_at ?? null,
    people: {
      active: memberRows.filter((m) => m.status === "active").length,
      invited: memberRows.filter((m) => m.status === "invited").length,
      pendingInvites,
      pendingJoinRequests,
    },
    lots: { total: lotsTotal, named: lotsNamed },
    documents: {
      total: docRows.length,
      indexed: docRows.filter((d) => d.indexing_status === "indexed").length,
      inProgress: docRows.filter((d) => d.indexing_status === "pending" || d.indexing_status === "processing").length,
      problems: docRows.filter((d) => ["failed", "needs_text", "not_indexable"].includes(d.indexing_status)).length,
      lastUploadedAt: docRows.map((d) => d.uploaded_at).sort().pop() ?? null,
      byCategory: [...byCategory].map(([category, n]) => ({ category, count: n })).sort((a, b) => b.count - a.count),
    },
    meetings: {
      total: meetingRows.length,
      draft: meetingRows.filter((m) => m.status === "DRAFT").length,
      live: meetingRows.filter((m) => m.status === "LIVE").length,
      adjourned: adjourned.filter((m) => m.actual_start_at).length,
      noQuorum: adjourned.filter((m) => !m.actual_start_at).length,
      lastHeldAt: adjourned.map((m) => m.adjourned_at as string | null).filter(Boolean).sort().pop() ?? null,
      nextDate: upcoming[0] ?? null,
    },
    decisions: { total: decisionsTotal, lastDecidedAt: lastDecision.data?.decided_at ?? null },
    conversations,
    subscription: {
      status: sub.data?.status ?? "none",
      interval: sub.data?.billing_interval ?? null,
      activatedAt: sub.data?.activated_at ?? null,
      periodEnd: sub.data?.current_period_end ?? null,
      freeMeetingUsed: Boolean(corp.data?.free_meeting_used),
    },
    stripe: {
      sandbox: Boolean(corp.data?.stripe_sandbox),
      hasCustomer: Boolean(sub.data?.stripe_customer_id),
      hasSubscription: Boolean(sub.data?.stripe_subscription_id),
    },
    usage: {
      questions: usageRows.length,
      questions30: recent.length,
      costUsd: sum(usageRows),
      cost30Usd: sum(recent),
      users30: new Set(recent.map((u) => u.user_id).filter(Boolean)).size,
      meetingQuestions: usageRows.filter((u) => u.surface === "meeting").length,
      lastAt: usageRows[0]?.created_at ?? null,
    },
  };
}
