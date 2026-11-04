import { test } from "node:test";
import assert from "node:assert/strict";
import { applyPresence, inMeeting, movementLines, takesConflicts, type PresenceEvent } from "../lib/meetings/live.ts";
import { voteLine } from "../lib/meetings/minutes.ts";
import { quorum } from "../lib/meetings/rules.ts";

const ev = (id: number, lot: string | null, event: PresenceEvent["event"], at: string, userId = `u${lot}`): PresenceEvent => ({ id, userId, name: `Person ${lot}`, lot, event, at });

test("in the meeting: each person's latest event decides, and anyone can rejoin", () => {
  const presence = [
    ev(1, "SL001", "joined", "2026-11-04T19:00:00Z"),
    ev(2, "SL002", "joined", "2026-11-04T19:01:00Z"),
    ev(3, "SL002", "left", "2026-11-04T19:30:00Z"),
    ev(4, "SL003", "joined", "2026-11-04T19:02:00Z"),
    ev(5, "SL003", "marked_left", "2026-11-04T19:40:00Z"),
    ev(6, "SL003", "joined", "2026-11-04T19:50:00Z"),
  ];
  assert.deepEqual(inMeeting(presence).map((p) => p.lot).sort(), ["SL001", "SL003"]);
});

test("presence the runner hasn't seen is applied to attendance, once", () => {
  const presence = [ev(1, "SL001", "joined", "t"), ev(2, "SL002", "joined", "t"), ev(3, "SL001", "left", "t"), ev(4, null, "joined", "t", "manager")];
  const r = applyPresence({ SL009: "regrets" }, presence, 0, "2000-01-01T00:00:00Z");
  assert.deepEqual(r.attendance, { SL009: "regrets", SL001: "left", SL002: "present" });
  assert.equal(r.lastId, 4);
  assert.equal(r.changed, true);
  // Seen already: the runner's own changes since then stand.
  const again = applyPresence({ ...r.attendance, SL002: "regrets" }, presence, r.lastId, "2000-01-01T00:00:00Z");
  assert.equal(again.changed, false);
  assert.equal(again.attendance.SL002, "regrets");
});

test("the runner marking someone present counts like joining online, one line per lot", () => {
  const presence = [
    ev(1, "SL005", "marked_joined", "2026-11-04T19:20:00Z", "u5"),
    ev(2, "SL005", "joined", "2026-11-04T19:25:00Z", "u5"),
    ev(3, "SL006", "marked_joined", "2026-11-04T19:26:00Z", null as never),
  ];
  assert.deepEqual(applyPresence({}, presence, 0, "2026-11-04T19:00:00Z").attendance, { SL005: "present", SL006: "present" });
  assert.deepEqual(inMeeting(presence).map((p) => [p.lot, p.event]), [["SL005", "joined"], ["SL006", "marked_joined"]]);
  assert.deepEqual(movementLines(presence.slice(0, 1), "2026-11-04T19:00:00Z", (iso) => iso.slice(11, 16)), ["SL005 joined the meeting at 19:20."]);
});

test("leaving before Call to Order clears the lot; after it, they're recorded as left", () => {
  const presence = [ev(1, "SL001", "joined", "2026-11-04T18:50:00Z"), ev(2, "SL001", "left", "2026-11-04T18:55:00Z")];
  assert.deepEqual(applyPresence({}, presence, 0, null).attendance, {});
  assert.deepEqual(applyPresence({}, presence, 0, "2026-11-04T19:00:00Z").attendance, {});
  assert.deepEqual(applyPresence({}, presence, 0, "2026-11-04T18:52:00Z").attendance, { SL001: "left" });
});

test("leaving only changes a lot that was present", () => {
  const r = applyPresence({ SL004: "regrets" }, [ev(7, "SL004", "left", "t")], 6);
  assert.equal(r.attendance.SL004, "regrets");
  assert.equal(r.changed, false);
});

test("someone who left no longer counts for quorum", () => {
  // 5 council members need 3.
  const before = quorum("council", { lotCount: 40, councilCount: 5, attendance: { SL1: "present", SL2: "present", SL3: "present" } });
  assert.equal(before.required, 3);
  assert.equal(before.met, true);
  const after = quorum("council", { lotCount: 40, councilCount: 5, attendance: { SL1: "present", SL2: "present", SL3: "left" } });
  assert.equal(after.counted, 2);
  assert.equal(after.met, false);
});

test("procedural items take no conflict of interest", () => {
  for (const t of ["Call to Order", "Approval of the Agenda", "Adopt the agenda", "Approval of Previous Minutes", "Elect Chairperson", "Next Meeting", "Adjournment"]) {
    assert.equal(takesConflicts(t), false, t);
  }
  for (const t of ["Roof replacement contract", "Financial report", "Bylaw infraction: SL012", "Landscaping quotes"]) {
    assert.equal(takesConflicts(t), true, t);
  }
});

test("the minutes record who came and went after Call to Order", () => {
  const presence = [
    ev(1, "SL001", "joined", "2026-11-04T18:55:00Z"),
    ev(2, "SL005", "joined", "2026-11-04T19:20:00Z"),
    ev(3, "SL001", "marked_left", "2026-11-04T19:45:00Z"),
    ev(4, null, "joined", "2026-11-04T19:46:00Z", "manager"),
  ];
  const lines = movementLines(presence, "2026-11-04T19:00:00Z", (iso) => iso.slice(11, 16));
  assert.deepEqual(lines, ["SL005 joined the meeting at 19:20.", "SL001 left the meeting at 19:45."]);
  assert.deepEqual(movementLines(presence, null, (iso) => iso), []);
});

test("the minutes call a vote unanimous on their own", () => {
  assert.equal(voteLine({ for: 4, against: 0, abstain: 0 } as never), "unanimous, 4 in favour");
  assert.equal(voteLine({ for: 3, against: 0, abstain: 1 } as never), "3 in favour, 0 opposed, 1 abstaining");
  assert.equal(voteLine({ for: 3, against: 1, abstain: 0 } as never), "3 in favour, 1 opposed");
});
