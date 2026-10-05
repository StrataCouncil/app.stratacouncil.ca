import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/AutoRefresh";
import { StrataSphereNav } from "@/components/StrataSphereNav";
import { GettingStarted, type GettingStartedStep } from "@/components/GettingStarted";
import { getCorporationRoster } from "@/lib/data/roster";
import { getStrataAccess } from "@/lib/data/strata";
import { listMeetings, type MeetingRecord } from "@/lib/data/meetings";
import { getCurrentAnnouncements } from "@/lib/data/announcements";
import { HomeAnnouncements } from "@/components/HomeAnnouncements";
import { createClient } from "@/lib/supabase/server";
import { corporationRoleLabels, councilRoles, jurisdictions } from "@/lib/strata";
import { meetingTypeLabels } from "@/lib/meetings/agenda";
import { formatMeetingWhen } from "@/lib/meetings/format";
import { meetingStatus } from "@/lib/meetings/status";

/**
 * Overview: the strata's landing page, a dashboard for the council. News
 * from StrataCouncil.ca (Super Admin announcements, to every customer,
 * subscribed or not), what needs attention, the next meeting, the latest minutes, who's on council,
 * and the strata's own details and numbers. Everything here links through
 * to the page that owns it.
 */
export default async function OverviewPage({ params }: { params: Promise<{ corpId: string }> }) {
  const { corpId } = await params;
  const access = await getStrataAccess(corpId);
  if (!access) notFound();

  const supabase = await createClient();
  const [roster, meetings, news, { data: corp }, { count: namedLots }, { count: documents }] = await Promise.all([
    getCorporationRoster(corpId),
    listMeetings(corpId),
    getCurrentAnnouncements("overview", 5),
    supabase
      .from("strata_corporations")
      .select("strata_plan_number, legal_name, building_name, address, unit_count, jurisdiction")
      .eq("strata_plan_number", corpId)
      .maybeSingle(),
    supabase.from("owners_and_council").select("id", { count: "exact", head: true }).eq("corporation_id", corpId).not("full_name", "is", null),
    supabase.from("documents").select("id", { count: "exact", head: true }).eq("corporation_id", corpId),
  ]);
  if (!corp) notFound();

  const members = roster?.members ?? [];
  const council = members.filter((m) => m.roles.some((r) => councilRoles.includes(r)));
  const officers = councilRoles
    .filter((r) => r !== "member_at_large")
    .map((role) => ({ role, holders: members.filter((m) => m.roles.includes(role)) }));
  const membersAtLarge = members.filter((m) => m.roles.includes("member_at_large"));
  const admins = members.filter((m) => m.roles.includes("admin"));
  const managers = members.filter((m) => m.roles.includes("manager"));

  const upcoming = nextMeetings(meetings);
  const next = upcoming[0] ?? null;
  const recentMinutes = meetings.filter((m) => m.status === "ADJOURNED").slice(0, 3);
  const jurisdiction = jurisdictions.find((j) => j.code === corp.jurisdiction)?.label ?? corp.jurisdiction;

  // Getting started, for the strata's own admin (not a visiting Super Admin).
  let steps: GettingStartedStep[] | null = null;
  if (roster?.isAdmin && !access.superAdminOnly) {
    const others = members.filter((m) => m.userId !== roster.currentUserId).length + roster.invites.length;
    steps = [
      {
        label: "Invite your council members",
        hint: "Everyone on council gets their own account, the agenda before each meeting, and their own Stratasphere.",
        href: `/strata/${corpId}/council#invite`,
        done: others > 0,
      },
      {
        label: "Upload your owner roster",
        hint: "Download the template on Owners, fill it in, and upload it.",
        href: `/strata/${corpId}/lots`,
        done: (namedLots ?? 0) > 0,
      },
      {
        label: "Assign council roles",
        hint: "President, Vice President, Treasurer, Secretary, Members at Large.",
        href: `/strata/${corpId}/council#roster`,
        done: members.some((m) => m.roles.some((r) => r !== "admin")),
      },
      {
        label: "Add your governing documents",
        hint: "Bylaws, rules, recent minutes, financial statements, insurance. Stratasphere answers from these.",
        href: `/strata/${corpId}/documents`,
        done: (documents ?? 0) > 0,
      },
      {
        label: "Create your first meeting",
        hint: "Build the agenda; your first meeting in Meeting Mode is free.",
        href: `/strata/${corpId}/meetings`,
        done: meetings.length > 0,
      },
    ];
  }

  // Admin to-dos: people waiting to join, invitations not yet accepted.
  const attention: Array<{ text: string; href: string }> = [];
  if (roster?.isAdmin) {
    const requests = roster.joinRequests.length;
    const invites = roster.invites.length;
    if (requests > 0) {
      attention.push({
        text: `${requests} ${requests === 1 ? "person is" : "people are"} asking to join this strata.`,
        href: `/strata/${corpId}/council`,
      });
    }
    if (invites > 0) {
      attention.push({
        text: `${invites} ${invites === 1 ? "invitation hasn't" : "invitations haven't"} been accepted yet.`,
        href: `/strata/${corpId}/council#invite`,
      });
    }
  }
  const unassigned = councilRoles
    .filter((r) => r === "president" || r === "secretary" || r === "treasurer")
    .filter((r) => !members.some((m) => m.roles.includes(r)));
  if (roster?.isAdmin && council.length > 0 && unassigned.length > 0) {
    attention.push({
      text: `No ${listOf(unassigned.map((r) => corporationRoleLabels[r]))} assigned yet.`,
      href: `/strata/${corpId}/council#roster`,
    });
  }

  return (
    <>
      <StrataSphereNav active="home" />
      <AutoRefresh />

      {steps && <GettingStarted corpId={corpId} steps={steps} />}

      {/* News from StrataCouncil.ca; admin-only posts for this strata's admins. */}
      <HomeAnnouncements
        heading="From StrataCouncil.ca"
        announcements={news.filter((a) => a.audience === "everyone" || access.isAdmin)}
      />

      {attention.length > 0 && (
        <section className="overview-attention" data-testid="overview-attention">
          <h3>Needs your attention</h3>
          <ul>
            {attention.map((a) => (
              <li key={a.text}>
                <Link href={a.href}>{a.text}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="overview-stats" data-testid="overview-stats">
        <Stat href={`/strata/${corpId}/lots`} value={corp.unit_count} label="Strata lots" meta={`${namedLots ?? 0} with an owner recorded`} />
        <Stat
          href={`/strata/${corpId}/council`}
          value={council.length}
          label="Council members"
          meta={`${members.length} ${members.length === 1 ? "person" : "people"} connected`}
        />
        <Stat
          href={`/strata/${corpId}/meetings`}
          value={upcoming.length}
          label={upcoming.length === 1 ? "Upcoming meeting" : "Upcoming meetings"}
          meta={`${meetings.length - upcoming.length} held`}
        />
        <Stat href={`/strata/${corpId}/documents`} value={documents ?? 0} label="Documents" meta="Bylaws, rules, minutes, financials" />
      </div>

      <div className="overview-grid">
        <section className="card" data-testid="overview-next-meeting">
          <h3>Next meeting</h3>
          {next ? (
            <>
              <p>
                <strong className="overview-strong">{meetingTypeLabels[next.type]}</strong>
                <br />
                {formatMeetingWhen(next)}
                {next.location ? <> &middot; {next.location}</> : null}
              </p>
              <p className="card__meta">
                {meetingStatus(next).label}
                {next.agenda.length > 0 ? ` · ${next.agenda.length} agenda ${next.agenda.length === 1 ? "item" : "items"}` : " · No agenda yet"}
              </p>
              <Link href={`/strata/${corpId}/meetings/${next.id}`} className="button button-secondary button-small overview-card__action">
                Open meeting
              </Link>
            </>
          ) : (
            <>
              <p>No meetings scheduled.</p>
              {access.canRunMeetings && (
                <Link href={`/strata/${corpId}/meetings/new`} className="button button-secondary button-small overview-card__action">
                  New meeting
                </Link>
              )}
            </>
          )}
        </section>

        <section className="card" data-testid="overview-minutes">
          <h3>Latest minutes</h3>
          {recentMinutes.length === 0 ? (
            <p>Minutes appear here when a meeting is adjourned.</p>
          ) : (
            <ul className="overview-list">
              {recentMinutes.map((m) => (
                <li key={m.id}>
                  <Link href={`/strata/${corpId}/meetings/${m.id}/minutes`}>{meetingTypeLabels[m.type]}</Link>
                  <span className="card__meta">
                    {formatMeetingWhen(m)} &middot; {m.minutesState === "FINAL" ? "Final" : "Draft"}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Link href={`/strata/${corpId}/minutes`} className="link-button overview-card__action">
            All minutes
          </Link>
        </section>

        <section className="card" data-testid="overview-council">
          <h3>Council</h3>
          <dl className="overview-details">
            {officers.map(({ role, holders }) => (
              <div key={role}>
                <dt>{corporationRoleLabels[role]}</dt>
                <dd>{holders.length ? names(holders) : <span className="card__meta">Not assigned</span>}</dd>
              </div>
            ))}
            <div>
              <dt>Members at Large</dt>
              <dd>{membersAtLarge.length ? names(membersAtLarge) : <span className="card__meta">None</span>}</dd>
            </div>
            {managers.length > 0 && (
              <div>
                <dt>Strata manager</dt>
                <dd>{names(managers)}</dd>
              </div>
            )}
            <div>
              <dt>{admins.length === 1 ? "Admin" : "Admins"}</dt>
              <dd>{admins.length ? names(admins) : <span className="card__meta">None</span>}</dd>
            </div>
          </dl>
        </section>

        <section className="card" data-testid="overview-details">
          <h3>Strata details</h3>
          <dl className="overview-details">
            <div>
              <dt>Strata plan</dt>
              <dd>{corp.strata_plan_number}</dd>
            </div>
            <div>
              <dt>Legal name</dt>
              <dd>{corp.legal_name}</dd>
            </div>
            {corp.building_name && (
              <div>
                <dt>Building</dt>
                <dd>{corp.building_name}</dd>
              </div>
            )}
            <div>
              <dt>Address</dt>
              <dd>{corp.address}</dd>
            </div>
            <div>
              <dt>Jurisdiction</dt>
              <dd>{jurisdiction}</dd>
            </div>
            <div>
              <dt>Stratasphere&trade;</dt>
              <dd>{access.subscribed ? "Subscribed" : access.pending ? "Subscription pending" : "Not subscribed"}</dd>
            </div>
          </dl>
        </section>
      </div>
    </>
  );
}

function Stat({ href, value, label, meta }: { href: string; value: number; label: string; meta: string }) {
  return (
    <Link href={href} className="overview-stat">
      <span className="overview-stat__value">{value}</span>
      <span className="overview-stat__label">{label}</span>
      <span className="overview-stat__meta">{meta}</span>
    </Link>
  );
}

/** Meetings not yet adjourned, soonest first (live ones lead). */
function nextMeetings(meetings: MeetingRecord[]) {
  return meetings
    .filter((m) => m.status !== "ADJOURNED")
    .sort((a, b) => {
      if (a.status === "LIVE" && b.status !== "LIVE") return -1;
      if (b.status === "LIVE" && a.status !== "LIVE") return 1;
      return `${a.meetingDate} ${a.startTime ?? ""}`.localeCompare(`${b.meetingDate} ${b.startTime ?? ""}`);
    });
}

function names(people: Array<{ fullName: string; email: string }>) {
  return people.map((p) => p.fullName || p.email).join(", ");
}

function listOf(items: string[]) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

