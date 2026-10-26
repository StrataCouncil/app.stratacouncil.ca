/** Meeting rules and agenda building. Run: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  agendaFromTemplate,
  ensureBookends,
  isAdjournment,
  isCallToOrder,
  makeItem,
  meetingTypes,
  newMotion,
  normalizeAgenda,
} from "../lib/meetings/agenda.ts";
import {
  councilQuorum,
  deferUnresolved,
  effectiveDecisionType,
  evaluateVote,
  isTie,
  minutesSummary,
  quorum,
  tieBreakAllowed,
  unresolvedItems,
} from "../lib/meetings/rules.ts";

type Dt = "MAJORITY" | "THREE_QUARTER" | "EIGHTY_PERCENT" | "UNANIMOUS";
/** A general-meeting vote: `present` voters in the room, `eligible` lots in the strata. */
const gm = (dt: Dt, f: number, a: number, ab = 0, eligible = 100, tieBreak: "for" | "against" | null = null) =>
  evaluateVote({ dt, for: f, against: a, abstain: ab, tieBreak }, { type: "agm", present: f + a + ab, eligible, lotCount: eligible });
/** A council vote with `present` members present. */
const cv = (present: number, f: number, a: number, ab = 0, tieBreak: "for" | "against" | null = null, lotCount = 50) =>
  evaluateVote({ dt: "MAJORITY", for: f, against: a, abstain: ab, tieBreak }, { type: "council", present, eligible: lotCount, lotCount });

test("general majority: more than 1/2 of votes cast; abstentions aren't votes cast (SPA s.1)", () => {
  assert.equal(gm("MAJORITY", 3, 2).passing, true);
  assert.equal(gm("MAJORITY", 2, 2).passing, false);
  assert.equal(gm("MAJORITY", 2, 1, 5).passing, true);
  assert.equal(gm("MAJORITY", 2, 2).needed, 3);
  assert.equal(gm("MAJORITY", 0, 0).passing, false);
  assert.equal(gm("MAJORITY", 0, 0, 4).passing, false);
});

test("3/4: at least 3/4 of votes cast, exactly at the line passes", () => {
  assert.equal(gm("THREE_QUARTER", 3, 1).passing, true);
  assert.equal(gm("THREE_QUARTER", 5, 2).passing, false);
  assert.equal(gm("THREE_QUARTER", 6, 2).passing, true);
  assert.equal(gm("THREE_QUARTER", 6, 2).needed, 6);
  assert.equal(gm("THREE_QUARTER", 6, 2, 10).passing, true);
  assert.equal(gm("THREE_QUARTER", 0, 0, 3).passing, false);
});

test("80%: of the votes of ALL eligible voters, not of votes cast (SPA s.1)", () => {
  // 100 lots: 80 needed, however few turn up.
  assert.equal(gm("EIGHTY_PERCENT", 40, 0, 0, 100).passing, false);
  assert.equal(gm("EIGHTY_PERCENT", 79, 0, 0, 100).passing, false);
  assert.equal(gm("EIGHTY_PERCENT", 80, 15, 0, 100).passing, true);
  assert.equal(gm("EIGHTY_PERCENT", 80, 0, 0, 100).needed, 80);
  // 11 lots: 80% is 8.8, so 9.
  assert.equal(gm("EIGHTY_PERCENT", 8, 0, 0, 11).passing, false);
  assert.equal(gm("EIGHTY_PERCENT", 9, 2, 0, 11).passing, true);
  assert.equal(gm("EIGHTY_PERCENT", 9, 0, 0, 11).needed, 9);
});

test("unanimous: every vote of every eligible voter, present or not (SPA s.1)", () => {
  assert.equal(gm("UNANIMOUS", 5, 0, 0, 5).passing, true);
  assert.equal(gm("UNANIMOUS", 5, 0, 0, 6).passing, false);
  assert.equal(gm("UNANIMOUS", 4, 0, 1, 5).passing, false);
  assert.equal(gm("UNANIMOUS", 4, 1, 0, 5).passing, false);
  assert.equal(gm("UNANIMOUS", 6, 0, 0, 6).needed, 6);
});

test("council: a majority of the council members present; an abstention counts against (Standard Bylaws 18(1))", () => {
  assert.equal(cv(5, 3, 2).passing, true);
  assert.equal(cv(5, 2, 1, 2).passing, false); // a majority of votes cast, but not of members present
  assert.equal(cv(5, 3, 0, 2).passing, true);
  assert.equal(cv(4, 2, 1, 1).passing, false);
  assert.equal(cv(5, 2, 1).needed, 3);
  assert.equal(cv(0, 0, 0).passing, false);
});

test("council ignores 3/4, 80% and unanimous markings: they're general-meeting thresholds", () => {
  for (const dt of ["THREE_QUARTER", "EIGHTY_PERCENT", "UNANIMOUS"] as const) {
    const v = evaluateVote({ dt, for: 3, against: 2, abstain: 0 }, { type: "council", present: 5, eligible: 100, lotCount: 100 });
    assert.equal(v.dt, "MAJORITY");
    assert.equal(v.passing, true);
  }
  assert.equal(effectiveDecisionType("committee", "THREE_QUARTER"), "MAJORITY");
  assert.equal(effectiveDecisionType("sgm", "THREE_QUARTER"), "THREE_QUARTER");
});

test("ties: the president's deciding vote counts, except with only 2 strata lots (Standard Bylaws 18(2), 27(5)-(6))", () => {
  assert.equal(cv(4, 2, 2).passing, false);
  assert.equal(cv(4, 2, 2, 0, "for").passing, true);
  assert.equal(cv(4, 2, 2, 0, "for").tieBroken, true);
  assert.equal(cv(4, 2, 2, 0, "against").passing, false);
  assert.equal(cv(5, 2, 2, 1, "for").passing, true);
  assert.equal(cv(2, 1, 1, 0, "for", 2).passing, false); // 2 lots: no deciding vote
  assert.equal(tieBreakAllowed({ for: 1, against: 1 }, { lotCount: 2 }), false);
  assert.equal(cv(5, 3, 2, 0, "against").tieBroken, false); // not a tie: ignored
  assert.equal(gm("MAJORITY", 10, 10, 0, 100, "for").passing, true);
  assert.equal(isTie({ for: 0, against: 0 }), false);
});

test("every threshold matches the Act's definitions, for every small vote", () => {
  for (let eligible = 1; eligible <= 12; eligible++) {
    for (let f = 0; f <= eligible; f++) {
      for (let a = 0; f + a <= eligible; a++) {
        for (let ab = 0; f + a + ab <= eligible; ab++) {
          const cast = f + a;
          const present = f + a + ab;
          assert.equal(gm("MAJORITY", f, a, ab, eligible).passing, cast > 0 && f / cast > 1 / 2);
          assert.equal(gm("THREE_QUARTER", f, a, ab, eligible).passing, cast > 0 && f / cast >= 3 / 4 - 1e-12);
          assert.equal(gm("EIGHTY_PERCENT", f, a, ab, eligible).passing, f / eligible >= 0.8 - 1e-12);
          assert.equal(gm("UNANIMOUS", f, a, ab, eligible).passing, f === eligible);
          assert.equal(cv(present, f, a, ab).passing, present > 0 && f / present > 1 / 2);
          for (const dt of ["MAJORITY", "THREE_QUARTER", "EIGHTY_PERCENT", "UNANIMOUS"] as const) {
            const v = gm(dt, f, a, ab, eligible);
            if (v.needed !== null) assert.equal(v.passing, f >= v.needed && (dt !== "UNANIMOUS" || a === 0), `${dt} ${f}/${a}/${ab} of ${eligible}`);
          }
        }
      }
    }
  }
});

test("council quorum follows Standard Bylaws 16(1); proxies don't count", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(councilQuorum), [1, 2, 2, 2, 3, 3, 4]);
  const q = quorum("council", { lotCount: 100, councilCount: 5, attendance: { SL1: "present", SL2: "present", SL3: "proxy" } });
  assert.equal(q.required, 3);
  assert.equal(q.counted, 2);
  assert.equal(q.met, false);
  assert.equal(quorum("council", { lotCount: 100, councilCount: 2, attendance: { SL1: "present" } }).met, false);
  assert.equal(quorum("council", { lotCount: 100, councilCount: 4, attendance: { SL1: "present", SL2: "present" } }).met, true);
});

test("AGM/SGM quorum: eligible voters holding 1/3 of the votes, proxies count (SPA s.48(2)(a))", () => {
  const attendance: Record<string, "present" | "proxy" | "regrets"> = {};
  for (let i = 1; i <= 20; i++) attendance[`SL${i}`] = "present";
  for (let i = 21; i <= 34; i++) attendance[`SL${i}`] = "proxy";
  attendance.SL99 = "regrets";
  const q = quorum("agm", { lotCount: 100, councilCount: 5, attendance });
  assert.equal(q.required, 34);
  assert.equal(q.counted, 34);
  assert.equal(q.met, true);
  assert.equal(quorum("sgm", { lotCount: 100, councilCount: 5, attendance: { SL1: "proxy" } }).proxies, 1);
  // Exactly 1/3 is enough: 99 lots need 33.
  assert.equal(quorum("agm", { lotCount: 99, councilCount: 5, attendance: {} }).required, 33);
});

test("AGM/SGM quorum is 2/3 with fewer than 4 lots or fewer than 4 owners (SPA s.48(2)(b))", () => {
  assert.equal(quorum("agm", { lotCount: 3, councilCount: 3, attendance: {} }).required, 2);
  assert.equal(quorum("agm", { lotCount: 2, councilCount: 2, attendance: {} }).required, 2);
  assert.equal(quorum("agm", { lotCount: 4, councilCount: 3, attendance: {} }).required, 2);
  assert.equal(quorum("agm", { lotCount: 9, councilCount: 3, attendance: {}, ownerCount: 3 }).required, 6);
  for (let lots = 1; lots <= 60; lots++) {
    const r = quorum("agm", { lotCount: lots, councilCount: 3, attendance: {} }).required;
    const fraction = lots < 4 ? 2 / 3 : 1 / 3;
    assert.ok(r >= lots * fraction - 1e-12 && (r - 1) < lots * fraction - 1e-12, `quorum for ${lots} lots`);
  }
});

test("every template is bookended and procedural motions are worded", () => {
  for (const type of meetingTypes) {
    const agenda = agendaFromTemplate(type);
    assert.ok(isCallToOrder(agenda[0]), `${type} starts with Call to Order`);
    assert.ok(isAdjournment(agenda[agenda.length - 1]), `${type} ends with Adjournment`);
    assert.equal(agenda[agenda.length - 1].motion?.text, "THAT the meeting be adjourned.");
    assert.deepEqual(agenda.map((i) => i.num), agenda.map((_, i) => i + 1));
    const approve = agenda.find((i) => i.text === "Approve Agenda");
    assert.equal(approve?.motion?.text, "THAT the agenda be approved as presented.");
  }
  assert.ok(agendaFromTemplate("agm").some((i) => i.motion?.dt === "THREE_QUARTER"));
});

test("ensureBookends adds only what's missing", () => {
  assert.equal(ensureBookends([]).length, 2);
  const one = ensureBookends([makeItem("Call to Order", "Opening"), makeItem("Roof", "New Business")]);
  assert.deepEqual(one.map((i) => i.text), ["Call to Order", "Roof", "Adjournment"]);
  assert.equal(one[2].motion?.dt, "MAJORITY");
});

test("unresolved items are deferred at adjournment, decided ones untouched", () => {
  const agenda = [
    { ...makeItem("A", "x"), done: true },
    makeItem("B", "x", { type: "FOR_APPROVAL" }),
    { ...makeItem("C", "x"), deferred: true },
  ];
  assert.deepEqual(unresolvedItems(agenda).map((i) => i.text), ["B"]);
  const after = deferUnresolved(agenda);
  assert.deepEqual(after.map((i) => [i.text, i.done, i.deferred]), [["A", true, false], ["B", false, true], ["C", false, true]]);
  assert.match(minutesSummary(after[1]), /deferred/);
});

test("minutes text for a carried 3/4 resolution notes the delay", () => {
  const it = makeItem("Roof levy", "New Business", {
    type: "FOR_APPROVAL",
    done: true,
    motion: { ...newMotion("THREE_QUARTER", "THAT..."), for: 6, against: 1, abstain: 1, outcome: "CARRIED", mover: "SL004", sec: "SL009" },
  });
  const text = minutesSummary(it);
  assert.match(text, /Moved by SL004, seconded by SL009/);
  assert.match(text, /6 in favour, 1 opposed, 1 abstaining — CARRIED by Three-Quarter \(3\/4\) vote/);
  assert.match(text, /one-week implementation delay/);
});

test("normalizeAgenda tolerates junk and old shapes", () => {
  const agenda = normalizeAgenda([{ text: "X", type: "NOPE", motion: { for: "3", dt: "WAT" } }, null, 5]);
  assert.equal(agenda.length, 1);
  assert.equal(agenda[0].type, "FOR_INFORMATION");
  assert.equal(agenda[0].motion?.for, 3);
  assert.equal(agenda[0].motion?.dt, "MAJORITY");
  assert.deepEqual(normalizeAgenda("nope"), []);
});

import { callToOrderScript, itemScript, zonedInstant } from "../lib/meetings/scripts.ts";

// Clock-change checks use Toronto: newer time-zone data may put British
// Columbia on permanent daylight time, so a Vancouver winter hour depends on
// the machine's data. The code follows whatever the runtime's data says.
test("zonedInstant converts the meeting's wall clock, across DST", () => {
  assert.equal(zonedInstant("2026-07-01", "19:00", "America/Toronto").toISOString(), "2026-07-01T23:00:00.000Z");
  assert.equal(zonedInstant("2026-12-01", "19:00", "America/Toronto").toISOString(), "2026-12-02T00:00:00.000Z");
  assert.equal(zonedInstant("2026-07-01", "19:00", "America/Vancouver").toISOString(), "2026-07-02T02:00:00.000Z");
  assert.equal(zonedInstant("2026-12-01", "09:30", "America/St_Johns").toISOString(), "2026-12-01T13:00:00.000Z");
});

test("scripts: no-quorum branch only once someone is marked", () => {
  // 7:02 p.m. in Toronto on November 4 (standard time, UTC-5).
  const base = { type: "council" as const, planNumber: "EPS9048", chair: null, required: 3, timezone: "America/Toronto", now: new Date("2026-11-05T00:02:00Z") };
  assert.equal(callToOrderScript({ ...base, quorumMet: false, counted: 0 }).title, "Call to Order script");
  const none = callToOrderScript({ ...base, quorumMet: false, counted: 2 });
  assert.match(none.title, /No quorum/);
  assert.match(none.lines.join(" "), /2 members present, and 3 are required/);
  assert.match(callToOrderScript({ ...base, type: "agm", quorumMet: true, counted: 40 }).lines[0], /Annual General Meeting of the Owners of Strata Plan EPS9048 to order at 7:02/);
  assert.match(callToOrderScript({ ...base, quorumMet: true, counted: 3 }).lines[0], /Good evening/);
});

test("item scripts follow the decision type", () => {
  const it = makeItem("Roof", "x", { type: "FOR_APPROVAL", motion: newMotion("THREE_QUARTER") });
  assert.match(itemScript(it) ?? "", /Three-Quarter/);
  assert.match(itemScript(makeItem("Adjournment", "x")) ?? "", /motion to adjourn/);
  assert.match(itemScript(makeItem("Report", "x")) ?? "", /for information/);
});

test("template items get standard motion wording; custom items don't", async () => {
  const { standardMotionText, autoPopulate: populate } = await import("../lib/meetings/agenda.ts");
  for (const type of meetingTypes) {
    for (const it of agendaFromTemplate(type)) {
      if (it.motion) assert.ok(it.motion.text.length > 0, `${type}: "${it.text}" has no motion wording`);
    }
  }
  assert.equal(standardMotionText("Approve Minutes of Previous Council Meeting"), "THAT the minutes of the previous council meeting be approved as circulated.");
  assert.equal(standardMotionText("Replace lobby carpet"), null);
  const typed = populate(makeItem("Approve Agenda", "Admin", { type: "FOR_APPROVAL", motion: newMotion("MAJORITY", "THAT the agenda be approved as amended.") }));
  assert.equal(typed.motion?.text, "THAT the agenda be approved as amended.");
});

test("the minutes record the president's deciding vote on a tie", () => {
  const it = makeItem("Fence", "x", {
    type: "FOR_APPROVAL",
    done: true,
    motion: { ...newMotion("MAJORITY", "THAT..."), for: 2, against: 2, abstain: 0, outcome: "CARRIED", mover: "SL1", sec: "SL2", tieBreak: "for" },
  });
  assert.match(minutesSummary(it), /tied; the president cast a second, deciding vote in favour/);
});
