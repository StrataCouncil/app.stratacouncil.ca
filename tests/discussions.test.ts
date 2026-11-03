import { test } from "node:test";
import assert from "node:assert/strict";
import { displayStatus, majorityNote, ratificationMotion, tally, tallyLine, type DiscussionVote } from "../lib/discussions/tally.ts";

const votes = (spec: Partial<Record<DiscussionVote | "none", number>>): Array<DiscussionVote | null> => [
  ...Array(spec.for ?? 0).fill("for"),
  ...Array(spec.against ?? 0).fill("against"),
  ...Array(spec.abstain ?? 0).fill("abstain"),
  ...Array(spec.recused ?? 0).fill("recused"),
  ...Array(spec.none ?? 0).fill(null),
];

test("4 of 7 for is a majority; 3 of 7 isn't", () => {
  assert.equal(tally(votes({ for: 4, none: 3 })).result, "supported");
  assert.equal(tally(votes({ for: 3, against: 1, none: 3 })).result, "no_majority");
  assert.equal(tally(votes({ for: 4, none: 3 })).needed, 4);
});

test("4 of 7 against is a majority against", () => {
  const t = tally(votes({ against: 4, for: 2, abstain: 1 }));
  assert.equal(t.result, "not_supported");
  assert.equal(majorityNote(t), "4 of 7 against: a majority has been reached.");
});

test("recused members leave the count: 3 of 5 when two are recused", () => {
  const t = tally(votes({ for: 3, recused: 2, none: 2 }));
  assert.equal(t.eligible, 5);
  assert.equal(t.needed, 3);
  assert.equal(t.result, "supported");
});

test("abstentions and non-voters count toward the total, not either side", () => {
  const t = tally(votes({ for: 3, abstain: 3 }));
  assert.equal(t.needed, 4);
  assert.equal(t.result, "no_majority");
});

test("an even split is no majority", () => {
  assert.equal(tally(votes({ for: 3, against: 3 })).result, "no_majority");
  assert.equal(tally(votes({ for: 2, against: 2 })).result, "no_majority");
});

test("a council of one, and everyone recused", () => {
  assert.equal(tally(votes({ for: 1 })).result, "supported");
  assert.equal(tally(votes({ recused: 3 })).result, "no_majority");
  assert.equal(majorityNote(tally(votes({ recused: 3 }))), null);
});

test("statuses: a passed motion awaits ratification; one that didn't pass is closed", () => {
  assert.equal(displayStatus("closed", "supported"), "awaiting_ratification");
  assert.equal(displayStatus("closed", "not_supported"), "closed");
  assert.equal(displayStatus("closed", "no_majority"), "closed");
  assert.equal(displayStatus("open", null), "open");
  assert.equal(displayStatus("ratified", "supported"), "ratified");
  assert.equal(displayStatus("not_ratified", "supported"), "not_ratified");
});

test("the ratification motion", () => {
  assert.equal(
    ratificationMotion("THAT council obtain three roofing quotes.", "2026-11-03"),
    "THAT council ratify its vote between meetings, closed 2026-11-03, on the motion: that council obtain three roofing quotes."
  );
});

test("the tally line", () => {
  assert.equal(tallyLine(tally(votes({ for: 4, against: 1, abstain: 1, recused: 1 }))), "4 for, 1 against, 1 abstained, 1 recused, 0 didn’t vote");
});
