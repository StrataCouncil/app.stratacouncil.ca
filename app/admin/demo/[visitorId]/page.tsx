import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminTabs } from "@/components/AdminTabs";
import { AppShell } from "@/components/AppShell";
import { getDemoActivity } from "@/lib/data/demo-visitors";
import { DEMO_LANDINGS, DEMO_LIMITS } from "@/lib/demo";
import { demoPageName, describeDemoEvent, duration, summarizeDemoActivity } from "@/lib/demo-activity";
import { getCurrentProfile } from "@/lib/data/profile";

const PACIFIC = "America/Los_Angeles";
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-CA", { timeZone: PACIFIC, hour: "numeric", minute: "2-digit", second: "2-digit" });
const day = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: PACIFIC, weekday: "long", month: "long", day: "numeric" });

const MEETING_PROGRESS = {
  none: "Didn't create one",
  created: "Created, not launched",
  launched: "Launched, not adjourned",
  adjourned: "Ran it to adjournment (minutes made)",
};

/**
 * One demo visitor's activity (lib/demo-activity.ts): how far they got,
 * then everything they did, in order. Kept for 7 days.
 */
export default async function DemoActivityPage({ params }: { params: Promise<{ visitorId: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile?.isSuperAdmin) notFound();
  const { visitorId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(visitorId)) notFound();
  const result = await getDemoActivity(visitorId);
  if (!result) notFound();

  return (
    <AppShell active="admin">
      <div className="wrap page">
        <AdminTabs active="demo" />
        <Link href="/admin/demo" className="kb-article__back">
          &larr; Demo
        </Link>
        {!result.ok ? (
          <p className="form-alert form-alert--error" role="alert">
            {result.error}
          </p>
        ) : (
          <Timeline {...result} />
        )}
      </div>
    </AppShell>
  );
}

function Timeline({ visitor, events, truncated }: Extract<Awaited<ReturnType<typeof getDemoActivity>>, { ok: true }>) {
  const s = summarizeDemoActivity(events);
  const n = (x: number) => x.toLocaleString("en-CA");
  let lastDay = "";

  return (
    <>
      <div className="page-header">
        <h1>{visitor.fullName}</h1>
        <p>
          {visitor.email} &middot; opens on {DEMO_LANDINGS.find((l) => l.value === visitor.landing)?.label} &middot;{" "}
          {visitor.active ? "link still works today" : "link has ended"}
        </p>
      </div>

      {events.length === 0 ? (
        <p className="roster-notice" data-testid="demo-activity-empty">
          Nothing yet. {visitor.firstOpenedAt ? "They opened the link but haven't done anything since." : "They haven't opened the link."}
        </p>
      ) : (
        <>
          <div className="admin-stats" data-testid="demo-activity-summary">
            <Stat title="Time in the demo" main={duration(s.activeSeconds)}>
              {n(s.pages)} pages and {n(s.clicks)} clicks{s.firstAt && s.lastAt ? `, from ${clock(s.firstAt)} to ${clock(s.lastAt)}` : ""}
            </Stat>
            <Stat title="Stratasphere™" main={`${s.chatQuestions + s.meetingQuestions} questions`}>
              {s.chatQuestions} of {DEMO_LIMITS.chat} in the chat, {s.meetingQuestions} of {DEMO_LIMITS.meeting} in Meeting Mode.
            </Stat>
            <Stat title="Their meeting" main={MEETING_PROGRESS[s.meeting]}>
              {s.motionsDrafted} motions drafted, {s.downloads} downloads.
            </Stat>
            <Stat title="Council Training" main={`${n(s.trainingSections)} sections finished`}>
              Only the first module is open in the demo.
            </Stat>
            <Stat title="Where they got stuck" main={`${s.limits} limits, ${s.problems} messages`}>
              Limits reached, and error or warning messages they saw. Highlighted below.
            </Stat>
          </div>

          {s.topPages.length > 0 && (
            <>
              <h2 style={{ marginBottom: "0.75rem" }}>Where they spent their time</h2>
              <ul className="demo-activity__pages">
                {s.topPages.map((p) => (
                  <li key={p.page}>
                    <strong>{p.page}</strong> {duration(p.seconds)}, {p.visits} {p.visits === 1 ? "visit" : "visits"}
                  </li>
                ))}
              </ul>
            </>
          )}

          <h2 style={{ margin: "2rem 0 0.75rem" }}>Everything they did</h2>
          {truncated && <p className="card__meta">Showing the first {n(events.length)} entries.</p>}
          <ol className="demo-activity" data-testid="demo-activity">
            {events.map((e) => {
              const { line, more, important } = describeDemoEvent(e);
              const today = day(e.at);
              const heading = today !== lastDay ? today : null;
              lastDay = today;
              return (
                <li key={e.id} data-important={important || undefined} data-kind={e.kind}>
                  {heading && <div className="demo-activity__day">{heading}</div>}
                  <time dateTime={e.at}>{clock(e.at)}</time>
                  <div>
                    <span>{line}</span>
                    {e.path && e.kind !== "view" && e.kind !== "leave" && <span className="roster-table__meta"> on {demoPageName(e.path)}</span>}
                    {more && (
                      <details>
                        <summary>Show</summary>
                        <p className="demo-activity__more">{more}</p>
                      </details>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </>
  );
}

function Stat({ title, main, children }: { title: string; main: string; children: React.ReactNode }) {
  return (
    <section className="card admin-stat">
      <h3>{title}</h3>
      <p className="admin-stat__main">{main}</p>
      <p className="card__meta">{children}</p>
    </section>
  );
}
