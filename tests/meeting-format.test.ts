import { test } from "node:test";
import assert from "node:assert/strict";
import { formatMeetingWhen, zoneLabel } from "../lib/meetings/format.ts";
import { clockTime } from "../lib/meetings/minutes.ts";
import { makeItem, missingMotions, newMotion, renumber } from "../lib/meetings/agenda.ts";
import { minutesSummary } from "../lib/meetings/rules.ts";

test("times say PT, never PDT or PST, summer or winter", () => {
  assert.equal(zoneLabel("America/Vancouver"), "PT");
  assert.equal(clockTime("2026-07-01T21:03:00Z", "America/Vancouver"), "2:03 p.m. PT");
  // Winter too: the zone is just PT (the hour follows the time zone data).
  assert.match(clockTime("2026-12-01T22:03:00Z", "America/Vancouver"), / PT$/);
  assert.doesNotMatch(clockTime("2026-07-01T21:03:00Z", "America/Toronto"), /EDT|EST/);
  assert.equal(formatMeetingWhen({ meetingDate: "2026-11-05", startTime: "19:00", timezone: "America/Vancouver" }), "Thu, Nov 5, 2026 · 7:00 p.m. PT");
});

test("discussion items are recorded as discussed; information items as received", () => {
  assert.equal(minutesSummary({ ...makeItem("Dog policy", "New Business", { type: "FOR_DISCUSSION" }), done: true }), "Dog policy was discussed.");
  assert.match(minutesSummary({ ...makeItem("Treasurer's report", "Reports"), done: true }), /received and placed on file/);
});

test("decision items without a motion are listed for the launch warning", () => {
  const agenda = renumber([
    makeItem("Roof Repairs", "New Business", { type: "FOR_DECISION", motion: newMotion("MAJORITY", "") }),
    makeItem("Paint", "New Business", { type: "FOR_DECISION", motion: newMotion("MAJORITY", "THAT the hallway be painted") }),
    makeItem("Report", "Reports"),
  ]);
  assert.deepEqual(missingMotions(agenda), ["1. Roof Repairs"]);
});
