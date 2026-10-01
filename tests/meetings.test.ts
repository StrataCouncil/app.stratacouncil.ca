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
import { deferUnresolved, evaluateVote, minutesSummary, quorum, unresolvedItems } from "../lib/meetings/rules.ts";

const vote = (dt: "MAJORITY" | "THREE_QUARTER" | "EIGHTY_PERCENT" | "UNANIMOUS", f: number, a: number, ab = 0) =>
  evaluateVote({ dt, for: f, against: a, abstain: ab });

test("majority is strictly more than half of votes cast; abstentions don't count", () => {
  assert.equal(vote("MAJORITY", 3, 2).passing, true);
  assert.equal(vote("MAJORITY", 2, 2).passing, false);
  assert.equal(vote("MAJORITY", 2, 1, 5).passing, true);
  assert.equal(vote("MAJORITY", 2, 2).needed, 3);
  assert.equal(vote("MAJORITY", 0, 0).passing, false);
});

test("3/4 and 80% round up", () => {
  assert.equal(vote("THREE_QUARTER", 3, 1).passing, true);
  assert.equal(vote("THREE_QUARTER", 5, 2).passing, false); // needs ceil(5.25)=6
  assert.equal(vote("THREE_QUARTER", 6, 2).passing, true);
  assert.equal(vote("EIGHTY_PERCENT", 4, 1).passing, true);
  assert.equal(vote("EIGHTY_PERCENT", 7, 2).passing, false); // needs ceil(7.2)=8
});

test("unanimous needs every vote in favour, abstentions included", () => {
  assert.equal(vote("UNANIMOUS", 5, 0).passing, true);
  assert.equal(vote("UNANIMOUS", 5, 0, 1).passing, false);
  assert.equal(vote("UNANIMOUS", 5, 1).passing, false);
});

test("council quorum: majority of council; proxies don't count", () => {
  const q = quorum("council", { lotCount: 100, councilCount: 5, attendance: { SL1: "present", SL2: "present", SL3: "proxy" } });
  assert.equal(q.required, 3);
  assert.equal(q.counted, 2);
  assert.equal(q.met, false);
});

test("AGM/SGM quorum: a third of lots, proxies count", () => {
  const attendance: Record<string, "present" | "proxy" | "regrets"> = {};
  for (let i = 1; i <= 20; i++) attendance[`SL${i}`] = "present";
  for (let i = 21; i <= 34; i++) attendance[`SL${i}`] = "proxy";
  attendance.SL99 = "regrets";
  const q = quorum("agm", { lotCount: 100, councilCount: 5, attendance });
  assert.equal(q.required, 34);
  assert.equal(q.counted, 34);
  assert.equal(q.met, true);
  assert.equal(quorum("sgm", { lotCount: 100, councilCount: 5, attendance: { SL1: "proxy" } }).proxies, 1);
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

test("zonedInstant converts the meeting's wall clock, across DST", () => {
  assert.equal(zonedInstant("2026-07-01", "19:00", "America/Vancouver").toISOString(), "2026-07-02T02:00:00.000Z");
  assert.equal(zonedInstant("2026-12-01", "19:00", "America/Vancouver").toISOString(), "2026-12-02T03:00:00.000Z");
  assert.equal(zonedInstant("2026-12-01", "09:30", "America/St_Johns").toISOString(), "2026-12-01T13:00:00.000Z");
});

test("scripts: no-quorum branch only once someone is marked", () => {
  const base = { type: "council" as const, planNumber: "EPS9048", chair: null, required: 3, timezone: "America/Vancouver", now: new Date("2026-11-05T03:02:00Z") };
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
