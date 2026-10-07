import { requireSuperAdmin } from "@/lib/data/admin";
import { demoDatabase } from "@/lib/data/demo-visitors";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The Super Admin console's Overview (/admin): platform-wide numbers and
 * the short list of things waiting on platform staff. Service role, after
 * requireSuperAdmin() (see lib/data/admin.ts). Counts only: nothing here
 * names an owner or reads a document.
 */

export interface AttentionItem {
  key: string;
  count: number;
  label: string;
  href: string;
}

export interface AdminOverview {
  stratas: { total: number; subscribed: number; sandbox: number; new30: number };
  people: { users: number; activeMembers: number; invited: number; new30: number };
  meetings: { held30: number; upcoming: number; total: number };
  documents: { total: number; indexed: number };
  stratasphere: { questions30: number; cost30Usd: number; askers30: number };
  training: { credentials: number; completions30: number; learners30: number };
  /** Null when the demo database isn't connected. */
  demo: { today: number; opened: number } | null;
  attention: AttentionItem[];
}

const DAY = 86_400_000;

export async function getAdminOverview(): Promise<AdminOverview | null> {
  if (!(await requireSuperAdmin())) return null;
  const admin = createAdminClient();
  const since30 = new Date(Date.now() - 30 * DAY).toISOString();
  const today = new Date().toISOString().slice(0, 10);
  const count = (q: PromiseLike<{ count: number | null; error: { message: string } | null }>, what: string) =>
    q.then((r) => {
      if (r.error) console.error(`[getAdminOverview] ${what}:`, r.error.message);
      return r.count ?? 0;
    });
  const head = { count: "exact" as const, head: true };

  const [
    corps,
    corpsSandbox,
    corpsNew,
    subscribed,
    paymentPending,
    users,
    usersNew,
    activeMembers,
    invited,
    meetingsTotal,
    held30,
    upcoming,
    docsTotal,
    docsIndexed,
    docsProblems,
    usage,
    credentials,
    completions,
    requests,
    legislationProblems,
    review,
    demo,
  ] = await Promise.all([
    count(admin.from("strata_corporations").select("strata_plan_number", head), "stratas"),
    count(admin.from("strata_corporations").select("strata_plan_number", head).eq("stripe_sandbox", true), "sandbox"),
    count(admin.from("strata_corporations").select("strata_plan_number", head).gte("created_at", since30), "new stratas"),
    count(admin.from("subscriptions").select("corporation_id", head).eq("status", "active"), "subscribed"),
    count(
      admin.from("subscriptions").select("corporation_id", head).neq("status", "active").eq("stripe_status", "incomplete"),
      "payment pending"
    ),
    count(admin.from("profiles").select("id", head), "users"),
    count(admin.from("profiles").select("id", head).gte("created_at", since30), "new users"),
    count(admin.from("corporation_memberships").select("id", head).eq("status", "active"), "members"),
    count(admin.from("corporation_memberships").select("id", head).eq("status", "invited"), "invited"),
    count(admin.from("meetings").select("id", head), "meetings"),
    count(admin.from("meetings").select("id", head).eq("status", "ADJOURNED").gte("adjourned_at", since30), "held"),
    count(admin.from("meetings").select("id", head).neq("status", "ADJOURNED").gte("meeting_date", today), "upcoming"),
    count(admin.from("documents").select("id", head), "documents"),
    count(admin.from("documents").select("id", head).eq("indexing_status", "indexed"), "indexed"),
    count(admin.from("documents").select("id", head).in("indexing_status", ["failed", "needs_text"]), "document problems"),
    admin.from("stratasphere_usage").select("user_id, cost_usd").gte("created_at", since30).limit(50000),
    count(admin.from("training_credentials").select("id", head), "credentials"),
    admin.from("training_progress").select("user_id").gte("completed_at", since30).limit(50000),
    count(admin.from("corporation_creation_requests").select("id", head).eq("status", "pending"), "requests"),
    count(admin.from("legislation_documents").select("id", head).in("indexing_status", ["failed", "needs_text"]), "legislation"),
    count(admin.from("training_modules").select("id", head).not("ready_for_review_at", "is", null), "review"),
    demoToday(),
  ]);

  if (usage.error) console.error("[getAdminOverview] usage:", usage.error.message);
  if (completions.error) console.error("[getAdminOverview] completions:", completions.error.message);
  const usageRows = usage.data ?? [];
  const completionRows = completions.data ?? [];

  const attention: AttentionItem[] = [
    { key: "requests", count: requests, label: "new corporation requests to review", href: "/admin/stratas" },
    { key: "payment", count: paymentPending, label: "subscriptions waiting on a payment to go through", href: "/admin/stratas" },
    { key: "documents", count: docsProblems, label: "strata documents that couldn't be indexed (failed, or need text)", href: "/admin/stratas" },
    { key: "legislation", count: legislationProblems, label: "Legislation Library entries that couldn't be indexed", href: "/admin/legislation" },
    { key: "review", count: review, label: "training modules ready for review", href: "/admin/training" },
  ].filter((a) => a.count > 0);
  if (!demo) attention.push({ key: "demo", count: 0, label: "The demo database isn't connected", href: "/admin/demo" });

  return {
    stratas: { total: corps, subscribed, sandbox: corpsSandbox, new30: corpsNew },
    people: { users, activeMembers, invited, new30: usersNew },
    meetings: { held30, upcoming, total: meetingsTotal },
    documents: { total: docsTotal, indexed: docsIndexed },
    stratasphere: {
      questions30: usageRows.length,
      cost30Usd: usageRows.reduce((n, u) => n + Number(u.cost_usd ?? 0), 0),
      askers30: new Set(usageRows.map((u) => u.user_id)).size,
    },
    training: {
      credentials,
      completions30: completionRows.length,
      learners30: new Set(completionRows.map((c) => c.user_id)).size,
    },
    demo,
    attention,
  };
}

/** Links still open today, and how many of them have been opened. */
async function demoToday(): Promise<AdminOverview["demo"]> {
  const db = demoDatabase();
  if (!db) return null;
  const { data, error } = await db
    .from("demo_visitors")
    .select("first_opened_at")
    .gt("expires_at", new Date().toISOString())
    .limit(1000);
  if (error) {
    console.error("[getAdminOverview] demo:", error.message);
    return { today: 0, opened: 0 };
  }
  return { today: data.length, opened: data.filter((v) => v.first_opened_at).length };
}
