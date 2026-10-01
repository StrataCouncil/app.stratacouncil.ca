/**
 * The agenda model (doc01 §4) and how agendas are started: from a
 * template for the meeting type, empty, or parsed from an uploaded
 * agenda — every one of them bookended with Call to Order and
 * Adjournment. Pure; shared by server and browser.
 */

export const meetingTypes = ["council", "agm", "sgm", "committee"] as const;
export type MeetingType = (typeof meetingTypes)[number];

export const meetingTypeLabels: Record<MeetingType, string> = {
  council: "Strata Council Meeting",
  agm: "Annual General Meeting",
  sgm: "Special General Meeting",
  committee: "Committee Meeting",
};

export const meetingFormats = ["in_person", "virtual", "hybrid"] as const;
export type MeetingFormat = (typeof meetingFormats)[number];
export const meetingFormatLabels: Record<MeetingFormat, string> = {
  in_person: "In person",
  virtual: "Electronic",
  hybrid: "Hybrid",
};

export const meetingTimezones = [
  ["America/Vancouver", "Pacific (PT)"],
  ["America/Edmonton", "Mountain (MT)"],
  ["America/Winnipeg", "Central (CT)"],
  ["America/Toronto", "Eastern (ET)"],
  ["America/Halifax", "Atlantic (AT)"],
  ["America/St_Johns", "Newfoundland (NT)"],
] as const;

export const resolutionTypes = [
  "FOR_INFORMATION",
  "FOR_DISCUSSION",
  "FOR_DIRECTION",
  "FOR_DECISION",
  "FOR_APPROVAL",
  "FOR_RATIFICATION",
] as const;
export type ResolutionType = (typeof resolutionTypes)[number];

export const resolutionTypeLabels: Record<ResolutionType, string> = {
  FOR_INFORMATION: "For information",
  FOR_DISCUSSION: "For discussion",
  FOR_DIRECTION: "For direction",
  FOR_DECISION: "For decision",
  FOR_APPROVAL: "For approval",
  FOR_RATIFICATION: "For ratification",
};
export const resolutionTypeShort: Record<ResolutionType, string> = {
  FOR_INFORMATION: "Info",
  FOR_DISCUSSION: "Discuss",
  FOR_DIRECTION: "Direction",
  FOR_DECISION: "Decision",
  FOR_APPROVAL: "Approval",
  FOR_RATIFICATION: "Ratify",
};

/** Resolution types that carry a motion and a vote. */
export const NEEDS_MOTION: readonly ResolutionType[] = ["FOR_DECISION", "FOR_APPROVAL", "FOR_RATIFICATION", "FOR_DIRECTION"];

export const decisionTypes = ["MAJORITY", "THREE_QUARTER", "EIGHTY_PERCENT", "UNANIMOUS"] as const;
export type DecisionType = (typeof decisionTypes)[number];
export const decisionTypeLabels: Record<DecisionType, string> = {
  MAJORITY: "Majority",
  THREE_QUARTER: "3/4 resolution",
  EIGHTY_PERCENT: "80% resolution",
  UNANIMOUS: "Unanimous resolution",
};

export interface Motion {
  text: string;
  dt: DecisionType;
  for: number;
  against: number;
  abstain: number;
  outcome: "CARRIED" | "DEFEATED" | null;
  mover: string;
  sec: string;
}

export type Attachment =
  | { id: string; kind: "document"; documentId: string; title: string }
  | { id: string; kind: "link"; documentId: string | null; url: string; title: string };

export interface AgendaItem {
  id: string;
  catId: string;
  cat: string;
  num: number;
  text: string;
  type: ResolutionType;
  background: string;
  financial: string;
  risks: string;
  motion: Motion | null;
  done: boolean;
  deferred: boolean;
  /** Consensus-resolved (no vote). */
  consensus?: boolean;
  minutesSummary: string;
  atts: Attachment[];
  /** Set Next Meeting Date item only. */
  nextMeeting?: { date: string; time: string; location: string };
  /** Added during the meeting, after the agenda was approved. */
  addedDuringMeeting?: boolean;
}

function rid(prefix: string) {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}

export const newCategoryId = () => rid("c");

export function newMotion(dt: DecisionType = "MAJORITY", text = ""): Motion {
  return { text, dt, for: 0, against: 0, abstain: 0, outcome: null, mover: "", sec: "" };
}

export function makeItem(text: string, cat: string, overrides: Partial<AgendaItem> = {}): AgendaItem {
  const type = overrides.type ?? "FOR_INFORMATION";
  return {
    id: rid("i"),
    catId: overrides.catId ?? newCategoryId(),
    cat,
    num: 0,
    text: text || "New item",
    type,
    background: "",
    financial: "",
    risks: "",
    motion: NEEDS_MOTION.includes(type) ? newMotion() : null,
    done: false,
    deferred: false,
    minutesSummary: "",
    atts: [],
    ...overrides,
  };
}

export const isCallToOrder = (it: Pick<AgendaItem, "text">) => it.text.toLowerCase().includes("call to order");
export const isAdjournment = (it: Pick<AgendaItem, "text">) => it.text.toLowerCase().includes("adjourn");
export const isApproveAgenda = (it: Pick<AgendaItem, "text">) => {
  const t = it.text.toLowerCase().replace(/\s+/g, " ");
  return t.includes("approve agenda") || t.includes("approval of agenda") || t.includes("approve the agenda");
};
export const isNextMeeting = (it: Pick<AgendaItem, "text">) => {
  const t = it.text.toLowerCase();
  return t.includes("next meeting") || t.includes("set next");
};

export function renumber(agenda: AgendaItem[]): AgendaItem[] {
  return agenda.map((it, i) => ({ ...it, num: i + 1 }));
}

/** Every agenda opens with Call to Order and closes with Adjournment (a motion). */
export function ensureBookends(agenda: AgendaItem[]): AgendaItem[] {
  const out = [...agenda];
  if (!out.some(isCallToOrder)) out.unshift(makeItem("Call to Order", "Opening", { type: "FOR_INFORMATION" }));
  if (!out.some(isAdjournment)) {
    out.push(
      makeItem("Adjournment", "Adjournment", {
        type: "FOR_APPROVAL",
        motion: newMotion("MAJORITY", "THAT the meeting be adjourned."),
      })
    );
  }
  return renumber(out);
}

type TemplateItem = { text: string; type: ResolutionType; dt?: DecisionType };
type TemplateCat = { name: string; items: TemplateItem[] };

const info = (text: string): TemplateItem => ({ text, type: "FOR_INFORMATION" });
const approve = (text: string, dt: DecisionType = "MAJORITY"): TemplateItem => ({ text, type: "FOR_APPROVAL", dt });

/** Order of business per the BC Standard Bylaws (s.28) and good meeting practice. */
export const agendaTemplates: Record<MeetingType, TemplateCat[]> = {
  agm: [
    { name: "Opening", items: [info("Call to Order")] },
    { name: "Credentials", items: [info("Certify Proxies and Issue Voting Cards"), info("Determine Quorum")] },
    { name: "Chair", items: [approve("Elect Chairperson (if necessary)")] },
    { name: "Administrative", items: [info("Proof of Notice of Meeting"), approve("Approve Agenda")] },
    { name: "Minutes", items: [approve("Approve Minutes of Previous AGM")] },
    { name: "Unfinished Business", items: [info("Business Arising from Previous AGM")] },
    { name: "Council Reports", items: [info("Report on Council Activities Since Previous AGM"), info("Committee Reports")] },
    { name: "Rules", items: [approve("Ratify New Rules (if any) Under SPA s.125")] },
    { name: "Insurance", items: [info("Insurance Coverage Report (SPA s.154)")] },
    { name: "Budget", items: [approve("Approve Budget for Coming Fiscal Year (SPA s.103)")] },
    {
      name: "New Business",
      items: [approve("New Business — Majority Vote Item"), approve("New Business — 3/4 Vote Resolution", "THREE_QUARTER")],
    },
    { name: "Elections", items: [approve("Election of Strata Council (SPA s.25)")] },
    { name: "Adjournment", items: [approve("Adjournment")] },
  ],
  sgm: [
    { name: "Opening", items: [info("Call to Order")] },
    { name: "Credentials", items: [info("Certify Proxies and Issue Voting Cards"), info("Determine Quorum")] },
    { name: "Chair", items: [approve("Elect Chairperson (if necessary)")] },
    { name: "Administrative", items: [info("Proof of Notice of Meeting"), approve("Approve Agenda")] },
    { name: "Minutes", items: [approve("Approve Minutes of Previous Meeting")] },
    {
      name: "Special Business",
      items: [approve("Requisitioned Matter — [Describe]"), approve("3/4 Vote Resolution — [Describe]", "THREE_QUARTER")],
    },
    { name: "New Business", items: [approve("Other New Business")] },
    { name: "Adjournment", items: [approve("Adjournment")] },
  ],
  council: [
    { name: "Opening", items: [info("Call to Order")] },
    { name: "Administrative", items: [approve("Approve Agenda"), approve("Approve Minutes of Previous Council Meeting")] },
    { name: "Financial", items: [approve("Review Financial Statements"), approve("Collections and Receivables")] },
    { name: "Maintenance", items: [info("Review of Monthly/Annual Maintenance")] },
    { name: "Correspondence", items: [info("Review Correspondence"), approve("Bylaw Enforcement Matters")] },
    { name: "New Business", items: [approve("New Business Item")] },
    { name: "Next Meeting", items: [info("Set Next Meeting Date")] },
    { name: "Adjournment", items: [approve("Adjournment")] },
  ],
  committee: [
    { name: "Opening", items: [info("Call to Order")] },
    { name: "Administrative", items: [approve("Approve Agenda"), approve("Approve Previous Meeting Notes")] },
    {
      name: "Committee Business",
      items: [
        info("Review Committee Mandate and Terms of Reference"),
        info("Status Update — Active Projects"),
        approve("Committee Recommendation — [Describe]"),
      ],
    },
    { name: "Action Items", items: [info("Review and Assign Action Items")] },
    { name: "Next Meeting", items: [info("Set Next Meeting Date")] },
    { name: "Adjournment", items: [approve("Adjournment")] },
  ],
};

export function agendaFromTemplate(type: MeetingType): AgendaItem[] {
  const agenda: AgendaItem[] = [];
  for (const cat of agendaTemplates[type]) {
    const catId = newCategoryId();
    for (const item of cat.items) {
      const needs = NEEDS_MOTION.includes(item.type);
      agenda.push(
        makeItem(item.text, cat.name, {
          catId,
          type: item.type,
          motion: needs ? newMotion(item.dt ?? "MAJORITY") : null,
        })
      );
    }
  }
  return ensureBookends(agenda.map(autoPopulate));
}

/** Standard motion wording and minutes text for the procedural items. */
export function autoPopulate(it: AgendaItem): AgendaItem {
  const next = { ...it, motion: it.motion ? { ...it.motion } : null };
  const t = next.text.toLowerCase();
  if (isApproveAgenda(next) && next.motion && !next.motion.text) {
    next.motion.text = "THAT the agenda be approved as presented.";
  }
  if (t.includes("approve") && t.includes("minute") && t.includes("previous") && next.motion && !next.motion.text) {
    next.motion.text = "THAT the minutes of the previous meeting be approved as circulated.";
  }
  if (isAdjournment(next)) {
    if (!next.motion) {
      next.motion = newMotion();
      next.type = "FOR_APPROVAL";
    }
    if (!next.motion.text) next.motion.text = "THAT the meeting be adjourned.";
  }
  return next;
}

/** Items grouped by category, in agenda order. */
export function groupByCategory(agenda: AgendaItem[]) {
  const cats: Array<{ id: string; name: string; items: AgendaItem[] }> = [];
  const byId = new Map<string, (typeof cats)[number]>();
  for (const it of agenda) {
    let cat = byId.get(it.catId);
    if (!cat) {
      cat = { id: it.catId, name: it.cat, items: [] };
      byId.set(it.catId, cat);
      cats.push(cat);
    }
    cat.items.push(it);
  }
  return cats;
}

/** Defensive parse of a stored agenda (jsonb) into the current shape. */
export function normalizeAgenda(raw: unknown): AgendaItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === "object")
    .map((r, i) => {
      const type = (resolutionTypes as readonly string[]).includes(r.type as string)
        ? (r.type as ResolutionType)
        : "FOR_INFORMATION";
      const m = r.motion as Record<string, unknown> | null | undefined;
      const motion: Motion | null = m
        ? {
            text: String(m.text ?? ""),
            dt: (decisionTypes as readonly string[]).includes(m.dt as string) ? (m.dt as DecisionType) : "MAJORITY",
            for: Number(m.for) || 0,
            against: Number(m.against) || 0,
            abstain: Number(m.abstain) || 0,
            outcome: m.outcome === "CARRIED" || m.outcome === "DEFEATED" ? m.outcome : null,
            mover: String(m.mover ?? ""),
            sec: String(m.sec ?? ""),
          }
        : null;
      return {
        id: String(r.id ?? rid("i")),
        catId: String(r.catId ?? "c_default"),
        cat: String(r.cat ?? ""),
        num: i + 1,
        text: String(r.text ?? ""),
        type,
        background: String(r.background ?? ""),
        financial: String(r.financial ?? ""),
        risks: String(r.risks ?? ""),
        motion,
        done: Boolean(r.done),
        deferred: Boolean(r.deferred),
        consensus: Boolean(r.consensus) || undefined,
        minutesSummary: String(r.minutesSummary ?? ""),
        atts: Array.isArray(r.atts) ? (r.atts as Attachment[]) : [],
        nextMeeting: (r.nextMeeting as AgendaItem["nextMeeting"]) ?? undefined,
        addedDuringMeeting: Boolean(r.addedDuringMeeting) || undefined,
      };
    });
}
