import { test } from "node:test";
import assert from "node:assert/strict";
import { conflictLine, motionCounts, parseLiveState, presentForItem, votedLine } from "../lib/meetings/live.ts";
import { evaluateVote } from "../lib/meetings/rules.ts";

test("a declared conflict leaves the member out of present for that item only", () => {
  const conflicts = [{ itemId: "i5", lot: "SL009", note: "" }];
  assert.deepEqual(presentForItem(["SL002", "SL004", "SL007", "SL009", "SL012"], conflicts, "i5"), ["SL002", "SL004", "SL007", "SL012"]);
  assert.deepEqual(presentForItem(["SL002", "SL009"], conflicts, "i4"), ["SL002", "SL009"]);
});

test("recused, not abstaining: 4 present with 1 conflict needs 2 of 3, not 3 of 4", () => {
  const present = presentForItem(["SL001", "SL002", "SL003", "SL004"], [{ itemId: "i", lot: "SL004", note: "" }], "i").length;
  const ctx = { type: "council" as const, present, eligible: 10, lotCount: 10 };
  const carried = evaluateVote({ for: 2, against: 1, abstain: 0, dt: "MAJORITY", tieBreak: null }, ctx);
  assert.equal(carried.passing, true);
  assert.equal(carried.needed, 2);
  // Had the conflicted member been counted as an abstention, the same votes would fail.
  const asAbstention = evaluateVote({ for: 2, against: 1, abstain: 1, dt: "MAJORITY", tieBreak: null }, { ...ctx, present: 4 });
  assert.equal(asAbstention.passing, false);
});

test("a present member who didn't vote is recorded as abstaining", () => {
  assert.deepEqual(motionCounts({ for: 2, against: 1, abstain: 0, missing: 1 }), { for: 2, against: 1, abstain: 1 });
  const v = evaluateVote({ ...motionCounts({ for: 2, against: 1, abstain: 0, missing: 1 }), dt: "MAJORITY", tieBreak: null }, {
    type: "council",
    present: 4,
    eligible: 4,
    lotCount: 4,
  });
  assert.equal(v.passing, false, "2 of 4 present is not a majority");
});

test("reads live_meeting_state defensively", () => {
  const s = parseLiveState({
    status: "LIVE",
    agenda: [],
    attendance: { SL001: "present" },
    currentItemId: "i4",
    isRunner: false,
    myLot: "SL002",
    conflicts: [{ itemId: "i5", lot: "SL003", note: "Brother's company" }],
    openVote: { id: "v", itemId: "i4", motion: "THAT", decisionType: "MAJORITY", eligibleLots: ["SL001", "SL002"], votedCount: "1", myBallot: "maybe", ballots: null },
    closedVotes: [{ id: "c", itemId: "i3", for: 3, against: 0, abstain: 0, missing: 0, present: 3 }],
  });
  assert.ok(s);
  assert.equal(s.openVote?.myBallot, null, "an unknown choice is dropped");
  assert.equal(s.openVote?.votedCount, 1);
  assert.equal(s.openVote?.ballots, null, "members don't get everyone's ballots");
  assert.equal(votedLine(s.openVote!), "1 of 2 have voted");
  assert.equal(parseLiveState(null), null);
});

test("the minutes line for conflicts", () => {
  assert.equal(conflictLine([]), "");
  assert.equal(conflictLine(["SL009"]), "SL009 declared a conflict of interest, left the meeting for this item and did not vote.");
  assert.equal(conflictLine(["SL002", "SL009"]), "SL002 and SL009 declared conflicts of interest, left the meeting for this item and did not vote.");
});
