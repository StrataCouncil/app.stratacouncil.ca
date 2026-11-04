import { test } from "node:test";
import assert from "node:assert/strict";
import { movementLines, runnerAway, type PresenceEvent } from "../lib/meetings/live.ts";

const hhmm = (iso: string) => iso.slice(11, 16);

test("minutes: handovers sit among joins and leaves by time", () => {
  const presence: PresenceEvent[] = [
    { id: 1, userId: "a", name: "", lot: "SL005", event: "joined", at: "2026-11-04T19:20:00Z" },
    { id: 2, userId: "b", name: "", lot: "SL007", event: "left", at: "2026-11-04T19:50:00Z" },
  ];
  const lines = movementLines(presence, "2026-11-04T19:00:00Z", hhmm, [
    { fromName: "Ana Ruiz", toName: "Liam Fraser", kind: "handed_over", at: "2026-11-04T19:30:00Z" },
    { fromName: "Liam Fraser", toName: "Mei Chen", kind: "took_over", at: "2026-11-04T20:42:00Z" },
  ]);
  assert.deepEqual(lines, [
    "SL005 joined the meeting at 19:20.",
    "Ana Ruiz handed the meeting to Liam Fraser at 19:30.",
    "SL007 left the meeting at 19:50.",
    "Mei Chen took over running the meeting at 20:42.",
  ]);
});

test("minutes: a handover before Call to Order is still recorded", () => {
  assert.deepEqual(movementLines([], null, hhmm, [{ fromName: "A", toName: "B", kind: "handed_over", at: "2026-11-04T18:55:00Z" }]), [
    "A handed the meeting to B at 18:55.",
  ]);
});

test("paused: only after 2 minutes without the Runner checking in", () => {
  const now = Date.parse("2026-11-04T20:00:00Z");
  assert.equal(runnerAway({ status: "LIVE", runnerSeenAt: "2026-11-04T19:58:30Z" }, now), false);
  assert.equal(runnerAway({ status: "LIVE", runnerSeenAt: "2026-11-04T19:57:59Z" }, now), true);
  assert.equal(runnerAway({ status: "LIVE", runnerSeenAt: null }, now), false);
  assert.equal(runnerAway({ status: "ADJOURNED", runnerSeenAt: "2026-11-04T19:00:00Z" }, now), false);
});
