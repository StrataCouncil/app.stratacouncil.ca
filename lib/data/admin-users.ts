import type { User } from "@supabase/supabase-js";
import { requireSuperAdmin } from "@/lib/data/admin";
import { folderLabel } from "@/lib/documents";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  followUpReason,
  furthestStage,
  reachedStages,
  regionFromAddress,
  STAGES,
  strataName,
  type PersonFacts,
  type Stage,
} from "@/lib/admin-users";

/**
 * The Super Admin console's Users tab (/admin/users): every person on the
 * platform, how far they've got, and what they've used. Service role,
 * after requireSuperAdmin() (see lib/data/admin.ts).
 *
 * What it never reads: Stratasphere conversations (only how many questions
 * were asked, from stratasphere_usage), billing details (only whether a
 * strata is subscribed), or a strata's owner list. Region is the city of
 * the stratas a person belongs to, from the strata's own address.
 */

const DAY = 86_400_000;
const LIMIT = 100_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AdminPersonStrata {
  planNumber: string;
  name: string;
  status: "active" | "invited";
  roles: string[];
  region: string | null;
  subscribed: boolean;
}

export interface AdminPersonRow {
  id: string;
  name: string;
  email: string;
  isSuperAdmin: boolean;
  signedUpAt: string;
  lastSignInAt: string | null;
  campaign: string | null;
  stratas: AdminPersonStrata[];
  regions: string[];
  modulesFinished: number;
  modulesTotal: number;
  credentials: number;
  questions30: number;
  libraryOpens: number;
  downloads: number;
  stage: Stage;
  reached: Stage[];
  followUp: string | null;
}

export interface AdminUsersReport {
  people: AdminPersonRow[];
  /** People who've reached each milestone. */
  funnel: Array<{ stage: Stage; count: number }>;
  /** Sign-ups by the campaign they arrived from, and how many of them went on to learn. */
  campaigns: Array<{ campaign: string; signups: number; startedTraining: number; credentials: number }>;
  /** Published modules most often started and left unfinished for 7+ days. */
  stalls: Array<{ module: string; track: string; count: number }>;
}

/** Every auth account, for sign-in dates and confirmation. */
async function allAuthUsers(admin: ReturnType<typeof createAdminClient>): Promise<Map<string, User>> {
  const users = new Map<string, User>();
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) {
      console.error("[admin users] listUsers:", error.message);
      break;
    }
    for (const u of data.users) users.set(u.id, u);
    if (data.users.length < 1000) break;
  }
  return users;
}

function campaignLabel(c: unknown): string | null {
  if (!c || typeof c !== "object") return null;
  const v = c as Record<string, string>;
  return v.utm_campaign || v.utm_source || null;
}

interface Shared {
  corps: Map<string, { name: string; region: string | null; subscribed: boolean }>;
  publishedModules: Map<string, { title: string; trackId: string }>;
  trackTitles: Map<string, string>;
}

async function shared(admin: ReturnType<typeof createAdminClient>): Promise<Shared> {
  const [{ data: corpRows }, { data: subs }, { data: modules }, { data: tracks }] = await Promise.all([
    admin.from("strata_corporations").select("strata_plan_number, building_name, address").limit(LIMIT),
    admin.from("subscriptions").select("corporation_id, status, complimentary_at").limit(LIMIT),
    admin.from("training_modules").select("id, title, track_id, published_version").gt("published_version", 0).limit(LIMIT),
    admin.from("training_tracks").select("id, title").limit(LIMIT),
  ]);
  const subscribed = new Set((subs ?? []).filter((s) => s.status === "active" || s.complimentary_at).map((s) => s.corporation_id));
  return {
    corps: new Map(
      (corpRows ?? []).map((c) => [
        c.strata_plan_number,
        { name: strataName(c.strata_plan_number, c.building_name), region: regionFromAddress(c.address), subscribed: subscribed.has(c.strata_plan_number) },
      ])
    ),
    publishedModules: new Map((modules ?? []).map((m) => [m.id, { title: m.title, trackId: m.track_id }])),
    trackTitles: new Map((tracks ?? []).map((t) => [t.id, t.title])),
  };
}

const group = <T, K>(rows: T[], key: (r: T) => K) => {
  const out = new Map<K, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = out.get(k);
    if (list) list.push(r);
    else out.set(k, [r]);
  }
  return out;
};

export async function getAdminUsers(): Promise<AdminUsersReport | null> {
  if (!(await requireSuperAdmin())) return null;
  const admin = createAdminClient();
  const since30 = new Date(Date.now() - 30 * DAY).toISOString();

  const [
    { data: profiles, error: profilesError },
    authUsers,
    common,
    { data: memberships },
    { data: roles },
    { data: progress },
    { data: credentials },
    { data: usage },
    { data: launched },
    { data: invites },
    { data: activity },
  ] = await Promise.all([
    admin.from("profiles").select("id, full_name, email, is_super_admin, created_at, signup_campaign").order("created_at", { ascending: false }).limit(LIMIT),
    allAuthUsers(admin),
    shared(admin),
    admin.from("corporation_memberships").select("user_id, corporation_id, status").in("status", ["active", "invited"]).limit(LIMIT),
    admin.from("corporation_role_assignments").select("user_id, corporation_id, role").limit(LIMIT),
    admin.from("training_progress").select("user_id, module_id, completed_at, updated_at").limit(LIMIT),
    admin.from("training_credentials").select("user_id").limit(LIMIT),
    admin.from("stratasphere_usage").select("user_id").gte("created_at", since30).limit(LIMIT),
    admin.from("meetings").select("launched_by").not("launched_by", "is", null).limit(LIMIT),
    admin.from("corporation_invites").select("invited_email, corporation_id, created_at").eq("status", "pending").limit(LIMIT),
    admin.from("user_activity").select("user_id, kind").limit(LIMIT),
  ]);
  if (profilesError) console.error("[getAdminUsers] profiles:", profilesError.message);

  const membershipsBy = group(memberships ?? [], (m) => m.user_id);
  const rolesBy = group(roles ?? [], (r) => r.user_id);
  const progressBy = group(progress ?? [], (p) => p.user_id);
  const credentialsBy = group(credentials ?? [], (c) => c.user_id);
  const usageBy = group(usage ?? [], (u) => u.user_id);
  const ranMeeting = new Set((launched ?? []).map((m) => m.launched_by));
  const invitesBy = group(invites ?? [], (i) => i.invited_email.toLowerCase());
  const activityBy = group(activity ?? [], (a) => a.user_id);
  const modulesTotal = common.publishedModules.size;

  const people: AdminPersonRow[] = (profiles ?? []).map((p) => {
    const auth = authUsers.get(p.id);
    const stratas: AdminPersonStrata[] = (membershipsBy.get(p.id) ?? []).map((m) => {
      const corp = common.corps.get(m.corporation_id);
      return {
        planNumber: m.corporation_id,
        name: corp?.name ?? m.corporation_id,
        status: m.status as "active" | "invited",
        roles: (rolesBy.get(p.id) ?? []).filter((r) => r.corporation_id === m.corporation_id).map((r) => r.role),
        region: corp?.region ?? null,
        subscribed: corp?.subscribed ?? false,
      };
    });
    const active = stratas.filter((s) => s.status === "active");
    const mine = (progressBy.get(p.id) ?? []).filter((r) => common.publishedModules.has(r.module_id));
    const unfinished = mine.filter((r) => !r.completed_at).map((r) => r.updated_at).sort();
    const facts: PersonFacts = {
      signedUpAt: p.created_at,
      modulesStarted: mine.length,
      modulesFinished: mine.filter((r) => r.completed_at).length,
      credentials: (credentialsBy.get(p.id) ?? []).length,
      unfinishedSince: unfinished.length ? unfinished[unfinished.length - 1] : null,
      activeStratas: active.length,
      ranMeeting: ranMeeting.has(p.id),
      subscribedStrata: active.some((s) => s.subscribed),
      pendingInvites: (invitesBy.get((p.email ?? "").toLowerCase()) ?? [])
        .filter((i) => !active.some((s) => s.planNumber === i.corporation_id))
        .map((i) => ({ strata: common.corps.get(i.corporation_id)?.name ?? i.corporation_id, sentAt: i.created_at })),
    };
    const acts = activityBy.get(p.id) ?? [];
    return {
      id: p.id,
      name: p.full_name || "(no name)",
      email: p.email ?? auth?.email ?? "",
      isSuperAdmin: Boolean(p.is_super_admin),
      signedUpAt: p.created_at,
      lastSignInAt: auth?.last_sign_in_at ?? null,
      campaign: campaignLabel(p.signup_campaign),
      stratas,
      regions: [...new Set(active.map((s) => s.region).filter((r): r is string => Boolean(r)))],
      modulesFinished: facts.modulesFinished,
      modulesTotal,
      credentials: facts.credentials,
      questions30: (usageBy.get(p.id) ?? []).length,
      libraryOpens: acts.filter((a) => a.kind === "guide_opened").length,
      downloads: acts.filter((a) => a.kind !== "guide_opened" && a.kind !== "document_viewed").length,
      stage: furthestStage(facts),
      reached: reachedStages(facts),
      followUp: p.is_super_admin ? null : followUpReason(facts),
    };
  });

  const learners = people.filter((p) => !p.isSuperAdmin);
  const funnel = STAGES.map((stage) => ({ stage, count: learners.filter((p) => p.reached.includes(stage)).length }));

  const campaigns = [...group(learners.filter((p) => p.campaign), (p) => p.campaign!).entries()]
    .map(([campaign, list]) => ({
      campaign,
      signups: list.length,
      startedTraining: list.filter((p) => p.reached.includes("training_started")).length,
      credentials: list.filter((p) => p.credentials > 0).length,
    }))
    .sort((a, b) => b.signups - a.signups);

  const cutoff = Date.now() - 7 * DAY;
  const stalledCounts = new Map<string, number>();
  for (const r of progress ?? []) {
    if (r.completed_at || !common.publishedModules.has(r.module_id) || new Date(r.updated_at).getTime() > cutoff) continue;
    stalledCounts.set(r.module_id, (stalledCounts.get(r.module_id) ?? 0) + 1);
  }
  const stalls = [...stalledCounts.entries()]
    .map(([id, count]) => {
      const m = common.publishedModules.get(id)!;
      return { module: m.title, track: common.trackTitles.get(m.trackId) ?? "", count };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return { people, funnel, campaigns, stalls };
}

export interface AdminPersonTrackModule {
  id: string;
  title: string;
  sectionsDone: number;
  startedAt: string | null;
  completedAt: string | null;
}

export interface AdminPersonEvent {
  at: string;
  text: string;
  important?: boolean;
}

export interface AdminPersonDetail {
  row: AdminPersonRow;
  emailConfirmed: boolean;
  twoStep: boolean;
  marketingOptIn: boolean;
  campaignTags: Record<string, string> | null;
  phone: string | null;
  tracks: Array<{ id: string; title: string; credentialAt: string | null; modules: AdminPersonTrackModule[] }>;
  questions: { last30: number; total: number; byStrata: Array<{ strata: string; count: number }> };
  meetings: Array<{ id: string; strata: string; planNumber: string; type: string; date: string; status: string; role: string }>;
  documentsUploaded: number;
  library: Array<{ at: string; kind: string; strata: string | null; label: string | null; ref: string | null }>;
  demoRequestedAt: string | null;
  joinRequests: Array<{ strata: string; status: string; at: string }>;
  timeline: AdminPersonEvent[];
}

const ACTIVITY_TEXT: Record<string, string> = {
  guide_opened: "Opened the guide",
  template_downloaded: "Downloaded the template",
  document_viewed: "Opened a document",
  document_downloaded: "Downloaded a document",
  agenda_downloaded: "Downloaded an agenda",
  minutes_downloaded: "Downloaded minutes",
};

export async function getAdminPerson(userId: string): Promise<AdminPersonDetail | null> {
  if (!UUID.test(userId) || !(await requireSuperAdmin())) return null;
  const report = await getAdminUsers();
  const row = report?.people.find((p) => p.id === userId);
  if (!row) return null;
  const admin = createAdminClient();

  const [
    { data: authData },
    { data: profile },
    common,
    { data: progress },
    { data: credentials },
    { data: usage },
    { data: meetingRows },
    { count: documentsUploaded },
    { data: activity },
    { data: joinRows },
    { data: demo },
    { data: memberships },
  ] = await Promise.all([
    admin.auth.admin.getUserById(userId),
    admin.from("profiles").select("marketing_opt_in, signup_campaign, phone").eq("id", userId).maybeSingle(),
    shared(admin),
    admin.from("training_progress").select("module_id, completed_sections, completed_at, updated_at").eq("user_id", userId).limit(LIMIT),
    admin.from("training_credentials").select("track_id, issued_at").eq("user_id", userId).limit(LIMIT),
    admin.from("stratasphere_usage").select("corporation_id, created_at").eq("user_id", userId).limit(LIMIT),
    admin
      .from("meetings")
      .select("id, corporation_id, type, meeting_date, status, created_by, launched_by, launched_at, adjourned_at, minutes_finalized_by, minutes_finalized_at, created_at")
      .or(`created_by.eq.${userId},launched_by.eq.${userId},minutes_finalized_by.eq.${userId}`)
      .order("meeting_date", { ascending: false })
      .limit(500),
    admin.from("documents").select("id", { count: "exact", head: true }).eq("uploaded_by", userId),
    admin.from("user_activity").select("kind, strata, ref, label, created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(500),
    admin.from("corporation_join_requests").select("corporation_id, status, requested_at").eq("requested_by", userId).limit(100),
    row.email ? admin.from("demo_requests").select("created_at").eq("email", row.email.toLowerCase()).order("created_at").limit(1) : Promise.resolve({ data: [] }),
    admin.from("corporation_memberships").select("corporation_id, joined_at").eq("user_id", userId).eq("status", "active").limit(100),
  ]);
  const auth = authData?.user ?? null;
  const corpName = (id: string | null) => (id ? common.corps.get(id)?.name ?? id : "");

  // Training, by track, with every published module.
  const progressBy = new Map((progress ?? []).map((p) => [p.module_id, p]));
  const credentialBy = new Map((credentials ?? []).map((c) => [c.track_id, c.issued_at]));
  const byTrack = group([...common.publishedModules.entries()], ([, m]) => m.trackId);
  const tracks = [...byTrack.entries()]
    .map(([trackId, mods]) => ({
      id: trackId,
      title: common.trackTitles.get(trackId) ?? "",
      credentialAt: credentialBy.get(trackId) ?? null,
      modules: mods.map(([id, m]) => {
        const p = progressBy.get(id);
        return {
          id,
          title: m.title,
          sectionsDone: p?.completed_sections?.length ?? 0,
          startedAt: p ? p.updated_at : null,
          completedAt: p?.completed_at ?? null,
        };
      }),
    }))
    .filter((t) => t.modules.some((m) => m.startedAt) || t.credentialAt)
    .sort((a, b) => a.title.localeCompare(b.title));

  // Stratasphere: counts only.
  const since30 = Date.now() - 30 * DAY;
  const usageRows = usage ?? [];
  const questionsByStrata = [...group(usageRows, (u) => u.corporation_id).entries()].map(([id, list]) => ({ strata: corpName(id), count: list.length }));

  const meetings = (meetingRows ?? []).map((m) => ({
    id: m.id,
    strata: corpName(m.corporation_id),
    planNumber: m.corporation_id,
    type: m.type,
    date: m.meeting_date,
    status: m.status,
    role: [m.created_by === userId && "created", m.launched_by === userId && "ran", m.minutes_finalized_by === userId && "finalized the minutes"]
      .filter(Boolean)
      .join(", "),
  }));

  const library = (activity ?? []).map((a) => ({
    at: a.created_at,
    kind: a.kind,
    strata: a.strata ? corpName(a.strata) : null,
    label: a.kind.startsWith("document_") ? folderLabel(a.label) : a.label,
    ref: a.ref,
  }));

  // One timeline, newest first.
  const timeline: AdminPersonEvent[] = [{ at: row.signedUpAt, text: row.campaign ? `Signed up (from ${row.campaign})` : "Signed up", important: true }];
  for (const m of memberships ?? []) if (m.joined_at) timeline.push({ at: m.joined_at, text: `Joined ${corpName(m.corporation_id)}`, important: true });
  for (const j of joinRows ?? []) timeline.push({ at: j.requested_at, text: `Asked to join ${corpName(j.corporation_id)} (${j.status})` });
  const moduleTitle = (id: string) => common.publishedModules.get(id)?.title ?? "a module";
  for (const p of progress ?? []) if (p.completed_at) timeline.push({ at: p.completed_at, text: `Finished “${moduleTitle(p.module_id)}”` });
  for (const c of credentials ?? []) timeline.push({ at: c.issued_at, text: `Earned the ${common.trackTitles.get(c.track_id) ?? ""} credential`, important: true });
  for (const m of meetingRows ?? []) {
    if (m.launched_by === userId && m.launched_at) timeline.push({ at: m.launched_at, text: `Ran a ${m.type} meeting in ${corpName(m.corporation_id)}`, important: true });
    if (m.minutes_finalized_by === userId && m.minutes_finalized_at) timeline.push({ at: m.minutes_finalized_at, text: `Finalized minutes in ${corpName(m.corporation_id)}` });
  }
  for (const a of library) {
    timeline.push({ at: a.at, text: `${ACTIVITY_TEXT[a.kind] ?? a.kind}${a.label ? ` “${a.label}”` : ""}${a.strata ? ` in ${a.strata}` : ""}` });
  }
  // Questions as a count per day and strata, never what was asked.
  const questionDays = group(usageRows, (u) => `${u.created_at.slice(0, 10)}|${u.corporation_id}`);
  for (const [key, list] of questionDays) {
    const latest = list.map((u) => u.created_at).sort().pop()!;
    const n = list.length;
    timeline.push({ at: latest, text: `Asked Stratasphere ${n} ${n === 1 ? "question" : "questions"} in ${corpName(key.split("|")[1])}` });
  }
  timeline.sort((a, b) => (a.at < b.at ? 1 : -1));

  return {
    row,
    emailConfirmed: Boolean(auth?.email_confirmed_at),
    twoStep: (auth?.factors ?? []).some((f) => f.status === "verified"),
    marketingOptIn: Boolean(profile?.marketing_opt_in),
    campaignTags: (profile?.signup_campaign as Record<string, string> | null) ?? null,
    phone: profile?.phone ?? null,
    tracks,
    questions: {
      last30: usageRows.filter((u) => new Date(u.created_at).getTime() >= since30).length,
      total: usageRows.length,
      byStrata: questionsByStrata,
    },
    meetings,
    documentsUploaded: documentsUploaded ?? 0,
    library,
    demoRequestedAt: (demo as Array<{ created_at: string }> | null)?.[0]?.created_at ?? null,
    joinRequests: (joinRows ?? []).map((j) => ({ strata: corpName(j.corporation_id), status: j.status, at: j.requested_at })),
    timeline,
  };
}
