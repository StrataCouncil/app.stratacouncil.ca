import { makeItem, newCategoryId, newMotion, renumber, type AgendaItem, type DecisionType, type ResolutionType } from "../meetings/agenda.ts";
import type { AttendanceStatus } from "../meetings/rules.ts";
import { longDate, monthYear, type KitDates } from "./dates.ts";
import { ARREARS, LEAK, ROOF } from "./documents.ts";
import { dollars, money } from "./people.ts";

/**
 * The demo strata's council meetings: two already held (adjourned, with
 * final minutes and their decisions in the ledger) and the next one, a
 * draft agenda with attachments for the visitor to open in Meeting Mode.
 * Built from the app's own agenda model. Pure.
 *
 * Movers and seconders are lots, as Meeting Mode records them:
 * SL012 president (chair), SL005 vice president, SL019 treasurer,
 * SL008 secretary, SL022 member at large (away for the first meeting).
 */

export interface KitMeeting {
  key: "meeting1" | "meeting2" | "upcoming";
  date: string;
  startTime: string;
  location: string;
  chairName: string;
  held: boolean;
  /** Clock times (Pacific) the meeting was called to order and adjourned. */
  calledToOrder?: string;
  adjourned?: string;
  attendance: Record<string, AttendanceStatus>;
  agenda: AgendaItem[];
  /** Agenda item id -> the kit documents attached to it. */
  attachments: Record<string, string[]>;
}

const LOCATION = "Amenity room, Larchwood Commons";
const CHAIR = "Margaret Chen-Whitford";

interface ItemSpec {
  type?: ResolutionType;
  background?: string;
  financial?: string;
  risks?: string;
  motion?: { text: string; dt?: DecisionType; mover?: string; sec?: string; for?: number; against?: number; abstain?: number; carried?: boolean };
  summary?: string;
  deferred?: boolean;
  consensus?: boolean;
  docs?: string[];
  nextMeeting?: { date: string; time: string; location: string };
}

/** Builds an agenda category by category; `held` marks every item decided. */
function agenda(held: boolean, sections: Array<[string, Array<[string, ItemSpec]>]>) {
  const items: AgendaItem[] = [];
  const attachments: Record<string, string[]> = {};
  for (const [cat, entries] of sections) {
    const catId = newCategoryId();
    for (const [text, spec] of entries) {
      const type = spec.type ?? (spec.motion ? "FOR_APPROVAL" : "FOR_INFORMATION");
      const m = spec.motion;
      const motion = m
        ? {
            ...newMotion(m.dt ?? "MAJORITY", m.text),
            mover: held ? (m.mover ?? "") : "",
            sec: held ? (m.sec ?? "") : "",
            for: held && !spec.deferred ? (m.for ?? 0) : 0,
            against: held && !spec.deferred ? (m.against ?? 0) : 0,
            abstain: held && !spec.deferred ? (m.abstain ?? 0) : 0,
            outcome: held && !spec.deferred ? (m.carried === false ? ("DEFEATED" as const) : ("CARRIED" as const)) : null,
          }
        : null;
      const it = makeItem(text, cat, {
        catId,
        type,
        background: spec.background ?? "",
        financial: spec.financial ?? "",
        risks: spec.risks ?? "",
        motion,
        done: held && !spec.deferred,
        deferred: held && Boolean(spec.deferred),
        consensus: spec.consensus,
        minutesSummary: held ? (spec.summary ?? "") : "",
        nextMeeting: spec.nextMeeting,
      });
      items.push(it);
      if (spec.docs?.length) attachments[it.id] = spec.docs;
    }
  }
  return { agenda: renumber(items), attachments };
}

const vote = (mover: string, sec: string, text: string, tally: [number, number, number] = [4, 0, 0], dt: DecisionType = "MAJORITY") => ({
  text,
  dt,
  mover,
  sec,
  for: tally[0],
  against: tally[1],
  abstain: tally[2],
});

export function kitMeetings(d: KitDates): KitMeeting[] {
  const all5 = { SL012: "present", SL005: "present", SL019: "present", SL008: "present", SL022: "present" } as Record<string, AttendanceStatus>;
  const coastline = ROOF.bids[0];

  const m1 = agenda(true, [
    ["Opening", [["Call to Order", { summary: "The meeting was called to order at 7:02 p.m. by the president. The strata manager attended." }]]],
    [
      "Administrative",
      [
        ["Approve Agenda", { motion: vote("SL008", "SL005", "THAT the agenda be approved as circulated.") }],
        [
          "Approve Minutes of Previous Council Meeting",
          { motion: vote("SL019", "SL008", `THAT the minutes of the council meeting held ${longDate(d.meeting0)} be approved as circulated.`) },
        ],
      ],
    ],
    [
      "Financial",
      [
        [
          "Review Financial Statements",
          {
            motion: vote("SL019", "SL012", "THAT the financial statements for the previous month be approved as presented."),
            summary: `The treasurer reported that the operating fund is on budget, and that the first roof levy instalment ${d.levyDue1 > d.meeting1 ? "is due" : "came due"} ${longDate(d.levyDue1)}. Repairs are slightly over budget because of the roof flashing repair above units 404 and 405.`,
          },
        ],
        [
          "Collections and Receivables",
          {
            type: "FOR_DIRECTION",
            background: "SL014 is one month behind on strata fees.",
            motion: vote("SL019", "SL005", "THAT council direct the strata manager to send a reminder letter to the owner of strata lot 14 for overdue strata fees."),
            summary: "Strata lot 14 owes one month of strata fees. Council directed a reminder letter.",
          },
        ],
      ],
    ],
    [
      "Maintenance",
      [
        [
          "Review of Monthly Maintenance",
          {
            summary: "The strata manager reported: gutters and roof drains cleaned; the annual fire alarm and sprinkler inspection was completed with no deficiencies; the parkade gate opener was serviced; two corridor light fixtures on the third floor were replaced.",
          },
        ],
        [
          "Roof Replacement: Specification and Tender",
          {
            type: "FOR_DECISION",
            background: `The owners approved a ${dollars(ROOF.levy)} special levy for the roof at the AGM. ${ROOF.engineer} prepared the roof condition assessment and offered to write the specification and manage the tender.`,
            financial: `${dollars(ROOF.engineerFee)} plus GST, from the contingency reserve fund (an expenditure contemplated by the depreciation report).`,
            motion: vote("SL005", "SL012", `THAT council retain ${ROOF.engineer} to prepare the roof replacement specification and manage the tender, for a fixed fee of ${dollars(ROOF.engineerFee)} plus GST, funded from the contingency reserve fund.`),
            summary: `Council agreed to tender to at least three contractors, with the work to start next spring. ${ROOF.engineer} was retained for the specification and tender.`,
          },
        ],
      ],
    ],
    [
      "Contracts",
      [
        [
          "Janitorial Contract Renewal",
          {
            type: "FOR_DECISION",
            background: "Cedar Clean Services' two-year term ends next month. Their fee is unchanged at $1,200 a month. Council has had no complaints this term.",
            financial: "$14,400 a year, as budgeted.",
            motion: vote("SL008", "SL019", "THAT council renew the janitorial services agreement with Cedar Clean Services Ltd. for two years at $1,200 a month plus GST."),
          },
        ],
      ],
    ],
    [
      "Correspondence",
      [
        [
          "Review Correspondence",
          {
            summary: "Council reviewed a letter from the owner of strata lot 6 about residents using visitor stall V2 overnight, and a request from the owner of strata lot 20 to book the amenity room for a birthday party (approved by the strata manager under the rules).",
            docs: ["parking-complaint"],
          },
        ],
        [
          "Bylaw Enforcement Matters",
          {
            type: "FOR_DIRECTION",
            background: "Photographs show a vehicle registered to the occupants of unit 302 (SL014) parked in visitor stall V2 overnight on at least 14 nights in four weeks. Bylaw 6.2 prohibits residents from using visitor stalls.",
            motion: vote("SL012", "SL005", "THAT council direct the strata manager to send the owner of strata lot 14 a warning letter about the use of visitor parking under Bylaws 6.2 and 6.3, with no fine at this time."),
          },
        ],
      ],
    ],
    [
      "Next Meeting",
      [
        [
          "Set Next Meeting Date",
          { nextMeeting: { date: longDate(d.meeting2), time: "7:00 p.m.", location: LOCATION } },
        ],
      ],
    ],
    ["Adjournment", [["Adjournment", { motion: vote("SL005", "SL008", "THAT the meeting be adjourned.") }]]],
  ]);

  const m2 = agenda(true, [
    ["Opening", [["Call to Order", { summary: "The meeting was called to order at 7:00 p.m. by the president. The strata manager attended." }]]],
    [
      "Administrative",
      [
        ["Approve Agenda", { motion: vote("SL008", "SL022", "THAT the agenda be approved as circulated.", [5, 0, 0]) }],
        [
          "Approve Minutes of Previous Council Meeting",
          { motion: vote("SL005", "SL019", `THAT the minutes of the council meeting held ${longDate(d.meeting1)} be approved as circulated.`, [5, 0, 0]) },
        ],
      ],
    ],
    [
      "Financial",
      [
        [
          "Review Financial Statements",
          {
            motion: vote("SL019", "SL008", "THAT the financial statements for the previous month be approved as presented.", [5, 0, 0]),
            summary: `The treasurer reported that the first roof levy instalment has been largely collected and is held in a separate account. The water damage deductible of ${dollars(LEAK.deductible)} has been paid from the operating fund, pending council's decision on a chargeback.`,
          },
        ],
        [
          "Collections and Receivables",
          {
            type: "FOR_DIRECTION",
            background: `SL014 now owes ${money(ARREARS.SL014)} (two months of fees and a late fee) and has not paid the first levy instalment.`,
            risks: "A lien can be registered only after the owner is given at least two weeks' written demand under section 112 of the Strata Property Act.",
            motion: vote("SL019", "SL012", "THAT council direct the strata manager to send the owner of strata lot 14 a demand letter for the overdue strata fees under section 112 of the Strata Property Act.", [5, 0, 0]),
          },
        ],
      ],
    ],
    [
      "Roof Replacement",
      [
        [
          "Roof Replacement: Tender Results",
          {
            type: "FOR_DECISION",
            background: `The tender closed ${longDate(d.tenderClose)} with three bids, from ${dollars(ROOF.bids[2].price)} to ${dollars(ROOF.bids[1].price)} plus GST. The lowest bid excludes the flashings and skylights.`,
            motion: { text: "THAT council award the roof replacement contract.", dt: "MAJORITY" },
            deferred: true,
            summary: "Council reviewed the three tenders. Because the lowest bid excludes required scope, council asked the engineer for a written comparison and recommendation, and deferred the decision to the next meeting.",
          },
        ],
      ],
    ],
    [
      "Insurance",
      [
        [
          "Water Leak from Unit 304 into 204",
          {
            type: "FOR_DECISION",
            background: `On ${longDate(d.leak)} a failed dishwasher supply line in unit 304 (SL016) flooded units 304 and 204 and the corridor. Total cost ${dollars(LEAK.repairs)}; the strata's water damage deductible is ${dollars(LEAK.deductible)}.`,
            financial: `${dollars(LEAK.deductible)} paid by the strata corporation; the insurer pays the rest.`,
            risks: "The owner may request a hearing before council makes its decision final.",
            motion: vote(
              "SL019",
              "SL005",
              `THAT council charge back the ${dollars(LEAK.deductible)} water damage deductible to strata lot 16 under Bylaws 9.2 and 9.3, and notify the owner in writing of the decision and of the right to request a hearing.`,
              [4, 0, 1]
            ),
            summary: "The member at large abstained, citing a friendship with the owner. The strata manager will notify the owner of the decision and of the right to a hearing.",
          },
        ],
      ],
    ],
    [
      "Bylaw Enforcement",
      [
        [
          "Visitor Parking: Strata Lot 14",
          {
            type: "FOR_DIRECTION",
            background: "The warning letter was sent, but the vehicle has continued to use visitor stall V2 on most nights.",
            risks: "Before imposing a fine, the strata corporation must give the owner and tenant the particulars of the complaint in writing and a reasonable opportunity to answer, including a hearing if requested (section 135 of the Strata Property Act).",
            motion: vote(
              "SL012",
              "SL022",
              "THAT council direct the strata manager to give the owner and tenants of strata lot 14 written particulars of the continuing contravention of Bylaw 6.2, and an opportunity to answer in writing or at a hearing, before council considers a fine of up to $200 every 7 days.",
              [5, 0, 0]
            ),
          },
        ],
      ],
    ],
    [
      "Correspondence",
      [
        [
          "Review Correspondence",
          {
            summary: "Council received complaints from the owners of strata lots 3 and 10 about a dog barking during weekdays in unit 104; a courtesy letter has been sent. Council also received an application from the owner of strata lot 21 to install an EV charger at stall P1-21 under Bylaw 7, to be considered at the next meeting with the electrician's quote.",
            docs: ["barking"],
          },
        ],
      ],
    ],
    [
      "Next Meeting",
      [["Set Next Meeting Date", { nextMeeting: { date: longDate(d.upcoming), time: "7:00 p.m.", location: LOCATION } }]],
    ],
    ["Adjournment", [["Adjournment", { motion: vote("SL005", "SL008", "THAT the meeting be adjourned.", [5, 0, 0]) }]]],
  ]);

  const next = agenda(false, [
    ["Opening", [["Call to Order", {}]]],
    [
      "Administrative",
      [
        ["Approve Agenda", { motion: { text: "THAT the agenda be approved as circulated." } }],
        [
          "Approve Minutes of Previous Council Meeting",
          {
            motion: { text: `THAT the minutes of the council meeting held ${longDate(d.meeting2)} be approved as circulated.` },
            docs: ["minutes:meeting2"],
          },
        ],
      ],
    ],
    [
      "Financial",
      [
        [
          "Review Financial Statements",
          {
            background: `The ${monthYear(d.statementMonthStart)} statement shows an operating deficit to date, caused by the ${dollars(LEAK.deductible)} leak deductible.`,
            motion: { text: `THAT the financial statements for ${monthYear(d.statementMonthStart)} be approved as presented.` },
            docs: ["statement"],
          },
        ],
        [
          "Collections and Receivables",
          {
            type: "FOR_DISCUSSION",
            background: `SL014: ${money(ARREARS.SL014)} outstanding after the section 112 demand letter; the owner says a payment is on its way. SL009: ${money(ARREARS.SL009)}.`,
            risks: "If SL014 has not paid within two weeks of the demand letter, council may decide whether to register a lien.",
          },
        ],
      ],
    ],
    [
      "Roof Replacement",
      [
        [
          "Award the Roof Replacement Contract",
          {
            type: "FOR_DECISION",
            background: `The engineer recommends ${coastline.name}, the lowest complete tender, at ${dollars(coastline.price)} plus GST. See the tender comparison and the proposal summary.`,
            financial: `Total with GST and field review about ${dollars(coastline.price * 1.05 + ROOF.fieldReview)}, within the ${dollars(ROOF.levy)} special levy.`,
            risks: "A later start risks the work running into the fall rains. Contract on CCDC 2 with a performance bond and a 10% Builders Lien Act holdback.",
            motion: {
              text: `THAT council award the roof replacement contract to ${coastline.name} for ${dollars(coastline.price)} plus GST on a CCDC 2 stipulated price contract, funded from the roof replacement special levy, and authorize the president and the strata manager to sign the contract.`,
            },
            docs: ["tender", "coastline"],
          },
        ],
      ],
    ],
    [
      "Insurance",
      [
        [
          "Hearing: Water Damage Chargeback, Strata Lot 16",
          {
            type: "FOR_DECISION",
            background: `The owner of strata lot 16 has requested a hearing about the ${dollars(LEAK.deductible)} chargeback, and asks to pay any balance over 12 months. Bylaw 3.6 requires the hearing within one month of the request.`,
            risks: "Council must give written reasons for its decision within one week of the hearing.",
            motion: {
              text: `THAT, having heard the owner of strata lot 16, council confirm the chargeback of the ${dollars(LEAK.deductible)} deductible and accept payment in 12 equal monthly instalments.`,
            },
            docs: ["hearing-request", "leak-report"],
          },
        ],
      ],
    ],
    [
      "Bylaw Enforcement",
      [
        [
          "Visitor Parking: Strata Lot 14",
          {
            type: "FOR_DECISION",
            background: "The owner responded in writing (attached), asked council to hold off on a fine, and asked whether the strata could rent the tenants the unused stall P1-23.",
            risks: "Stall P1-23 is limited common property or assigned to strata lot 23; it can't be rented to another lot without the owner's agreement and a proper assignment.",
            motion: { text: "THAT council impose a fine of $200 on strata lot 14 for the continuing contravention of Bylaw 6.2." },
            docs: ["parking-response", "parking-warning"],
          },
        ],
      ],
    ],
    [
      "Owner Requests",
      [
        [
          "EV Charger Installation: Strata Lot 21",
          {
            type: "FOR_DECISION",
            background: "The owner of strata lot 21 applied under Bylaw 7 to install a Level 2 charger at stall P1-21 at their own cost, with a sub-meter.",
            financial: "No cost to the strata corporation. The electrician recommends a parkade-wide EV-ready load study (about $4,500) before more owners install chargers.",
            motion: {
              text: "THAT council approve the installation of an EV charger at stall P1-21 at the owner's cost, subject to a signed alteration and indemnity agreement, a permit and inspection, and sub-metering.",
            },
            docs: ["ev-request"],
          },
        ],
      ],
    ],
    [
      "Correspondence",
      [
        [
          "Barking Dog, Unit 104: Follow-up",
          {
            background: "The owner of unit 104 has hired a weekday dog walker. Council to hear from the strata manager whether the complaints have stopped.",
            docs: ["barking"],
          },
        ],
      ],
    ],
    ["Next Meeting", [["Set Next Meeting Date", {}]]],
    ["Adjournment", [["Adjournment", { motion: { text: "THAT the meeting be adjourned." } }]]],
  ]);

  return [
    {
      key: "meeting1",
      date: d.meeting1,
      startTime: "19:00",
      location: LOCATION,
      chairName: CHAIR,
      held: true,
      calledToOrder: "19:02",
      adjourned: "20:31",
      attendance: { ...all5, SL022: "regrets" },
      ...m1,
    },
    {
      key: "meeting2",
      date: d.meeting2,
      startTime: "19:00",
      location: LOCATION,
      chairName: CHAIR,
      held: true,
      calledToOrder: "19:00",
      adjourned: "21:08",
      attendance: all5,
      ...m2,
    },
    {
      key: "upcoming",
      date: d.upcoming,
      startTime: "19:00",
      location: LOCATION,
      chairName: CHAIR,
      held: false,
      attendance: {},
      ...next,
    },
  ];
}
