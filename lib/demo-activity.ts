/**
 * Reading a demo visitor's activity log (demo_activity, written by
 * lib/demo-usage.ts and components/DemoGuard.tsx) for the Super Admin
 * console: a plain-language line for each event, and a summary of how far
 * the visitor got. Pure.
 */

export interface DemoActivityEvent {
  id: number;
  at: string;
  kind: string;
  path: string | null;
  detail: Record<string, unknown>;
}

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

/** Pages by what they are, not their address. */
export function demoPageName(path: string | null): string {
  if (!path) return "";
  const p = path.replace(/^\/strata\/[^/]+/, "/strata");
  const named: Array<[RegExp, string]> = [
    [/^\/training\/?$/, "Council Training"],
    [/^\/training\/.+/, "Council Training module"],
    [/^\/strata\/?$/, "Strata overview"],
    [/^\/strata\/assistant/, "Stratasphere chat"],
    [/^\/strata\/meetings\/new/, "New meeting"],
    [/^\/strata\/meetings\/[^/]+\/run/, "Meeting Mode"],
    [/^\/strata\/meetings\/[^/]+\/minutes/, "Meeting minutes"],
    [/^\/strata\/meetings\/[^/]+/, "Meeting agenda"],
    [/^\/strata\/meetings/, "Meetings"],
    [/^\/strata\/minutes/, "Minutes"],
    [/^\/strata\/documents/, "Documents"],
    [/^\/strata\/guides/, "Library"],
    [/^\/strata\/council/, "Council"],
    [/^\/strata\/lots/, "Owners"],
    [/^\/strata\/management/, "Management"],
    [/^\/strata\/decisions/, "Decisions"],
    [/^\/account/, "Account"],
    [/^\/demo/, "Demo front door"],
  ];
  return named.find(([re]) => re.test(p))?.[1] ?? path;
}

/** One line for the timeline, and longer text (a question and its answer) to open if wanted. */
export function describeDemoEvent(e: DemoActivityEvent): { line: string; more?: string; important?: boolean } {
  const d = e.detail ?? {};
  switch (e.kind) {
    case "view":
      return { line: `Opened ${demoPageName(e.path)}${d.returned ? " (came back to the tab)" : ""}` };
    case "leave":
      return { line: `Left ${demoPageName(e.path)} after ${duration(Number(d.seconds) || 0)}` };
    case "click":
      return { line: `Clicked ${str(d.label) ? `"${str(d.label)}"` : str(d.tag)}${d.href ? ` (${str(d.href)})` : ""}` };
    case "alert":
      return { line: `Saw a message: "${str(d.text)}"`, important: true };
    case "limit":
      return { line: `Reached the demo's limit: ${str(d.reason)}${d.question ? ` (asked: "${str(d.question)}")` : ""}`, important: true };
    case "error":
      return { line: `Error in the page: ${str(d.message)}`, important: true };
    case "stratasphere.chat":
    case "stratasphere.meeting": {
      const where = e.kind === "stratasphere.chat" ? "the Stratasphere chat" : `Meeting Mode${d.item ? ` (on "${str(d.item)}")` : ""}`;
      return d.failed
        ? { line: `Asked ${where} and got no answer: "${str(d.question)}"`, more: str(d.failed), important: true }
        : { line: `Asked ${where}: "${str(d.question)}"`, more: `${str(d.answer)}${d.sources ? `\n\nSources: ${str(d.sources)}` : ""}`, important: true };
    }
    case "meeting.created":
      return { line: `Created a meeting for ${str(d.date)}${d.time ? ` at ${str(d.time)}` : ""}`, important: true };
    case "agenda.saved":
      return {
        line: `Saved the agenda (${str(d.item) || "Roof Repairs"})`,
        more: [d.motion ? `Motion: ${str(d.motion)}` : "", str(d.text)].filter(Boolean).join("\n\n") || undefined,
        important: true,
      };
    case "motion.drafted":
      return { line: `Had Stratasphere draft a motion for "${str(d.item)}"`, more: str(d.motion), important: true };
    case "meeting.launched":
      return { line: "Launched the meeting", important: true };
    case "meeting.called_to_order":
      return { line: `Called the meeting to order (${str(d.present)} present)`, important: true };
    case "meeting.adjourned":
      return { line: `Adjourned the meeting: ${str(d.decided)} of ${str(d.items)} items decided, ${str(d.deferred)} deferred. Minutes made.`, important: true };
    case "meeting.deleted":
      return { line: "Deleted their meeting", important: true };
    case "meeting.exported":
      return { line: `Downloaded ${str(d.file)}`, important: true };
    case "document.downloaded":
      return { line: `Downloaded "${str(d.title)}"` };
    case "document.viewed":
      return { line: `Opened "${str(d.title)}"` };
    case "training.section":
      return {
        line: `Finished "${str(d.section)}" in ${str(d.module)}${d.credentialEarned ? ", and earned the track's credential" : d.moduleComplete ? ", completing the module" : ""}`,
        important: true,
      };
    default:
      return { line: `${e.kind}${Object.keys(d).length ? `: ${JSON.stringify(d).slice(0, 200)}` : ""}` };
  }
}

export function duration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m} min ${seconds % 60}s`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export interface DemoActivitySummary {
  firstAt: string | null;
  lastAt: string | null;
  /** Time with a page open and in view. */
  activeSeconds: number;
  pages: number;
  clicks: number;
  chatQuestions: number;
  meetingQuestions: number;
  meeting: "none" | "created" | "launched" | "adjourned";
  motionsDrafted: number;
  downloads: number;
  trainingSections: number;
  limits: number;
  problems: number;
  /** Most-visited pages, by time spent. */
  topPages: Array<{ page: string; seconds: number; visits: number }>;
}

export function summarizeDemoActivity(events: DemoActivityEvent[]): DemoActivitySummary {
  const count = (kind: string) => events.filter((e) => e.kind === kind).length;
  const byPage = new Map<string, { seconds: number; visits: number }>();
  for (const e of events) {
    if (e.kind !== "view" && e.kind !== "leave") continue;
    const page = demoPageName(e.path);
    const row = byPage.get(page) ?? { seconds: 0, visits: 0 };
    if (e.kind === "view" && !e.detail?.returned) row.visits++;
    if (e.kind === "leave") row.seconds += Number(e.detail?.seconds) || 0;
    byPage.set(page, row);
  }
  const meeting = count("meeting.adjourned") ? "adjourned" : count("meeting.launched") ? "launched" : count("meeting.created") ? "created" : "none";
  return {
    firstAt: events[0]?.at ?? null,
    lastAt: events.at(-1)?.at ?? null,
    activeSeconds: [...byPage.values()].reduce((n, p) => n + p.seconds, 0),
    pages: events.filter((e) => e.kind === "view" && !e.detail?.returned).length,
    clicks: count("click"),
    chatQuestions: events.filter((e) => e.kind === "stratasphere.chat" && !e.detail?.failed).length,
    meetingQuestions: events.filter((e) => e.kind === "stratasphere.meeting" && !e.detail?.failed).length,
    meeting,
    motionsDrafted: count("motion.drafted"),
    downloads: count("meeting.exported") + count("document.downloaded"),
    trainingSections: count("training.section"),
    limits: count("limit"),
    problems: count("error") + count("alert"),
    topPages: [...byPage.entries()]
      .map(([page, v]) => ({ page, ...v }))
      .sort((a, b) => b.seconds - a.seconds || b.visits - a.visits)
      .slice(0, 8),
  };
}
