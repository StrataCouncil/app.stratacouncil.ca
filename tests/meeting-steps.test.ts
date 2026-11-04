import { test } from "node:test";
import assert from "node:assert/strict";
import { makeItem, newMotion } from "../lib/meetings/agenda.ts";
import { currentStep, itemSteps, usesLiveVoting } from "../lib/meetings/steps.ts";

const council = (vote: { open?: boolean; closed?: boolean } = {}) => ({
  general: false,
  voteOpen: Boolean(vote.open),
  voteClosed: Boolean(vote.closed),
});
const ids = (steps: { id: string }[]) => steps.map((s) => s.id);

test("a council decision runs in order: introduce, conflicts, motion, discussion, vote, close and record", () => {
  const it = makeItem("Roof repairs", "New Business", { type: "FOR_DECISION", motion: newMotion("MAJORITY", "THAT the roof be repaired") });
  const steps = itemSteps(it, council());
  assert.deepEqual(ids(steps), ["introduce", "conflicts", "motion", "discuss", "vote", "close"]);
  assert.equal(currentStep(steps), 0);
});

test("steps tick themselves from what's on screen, and a later step ticks the earlier ones", () => {
  const motion = { ...newMotion("MAJORITY", "THAT the roof be repaired"), mover: "SL001", sec: "SL002" };
  const it = makeItem("Roof repairs", "New Business", { type: "FOR_DECISION", motion });
  // Motion recorded: introduce and conflicts count as done; discussion is next.
  let steps = itemSteps(it, council());
  assert.equal(steps[currentStep(steps)].id, "discuss");
  assert.ok(steps.slice(0, 3).every((s) => s.done));
  // Vote open: close is next.
  steps = itemSteps(it, council({ open: true }));
  assert.equal(steps[currentStep(steps)].id, "close");
  // Recorded: nothing left.
  assert.equal(currentStep(itemSteps(it, council({ closed: true }))), -1);
  assert.equal(currentStep(itemSteps({ ...it, done: true }, council({ closed: true }))), -1);
});

test("a motion isn't ready without its wording, mover and seconder", () => {
  const motion = { ...newMotion("MAJORITY", ""), mover: "SL001", sec: "SL002" };
  const it = makeItem("Roof repairs", "New Business", { type: "FOR_DECISION", motion });
  const steps = itemSteps(it, council());
  assert.equal(steps.find((st) => st.id === "motion")!.done, false);
  assert.equal(currentStep(steps), 0);
});

test("procedural items ask for no conflicts; adjournment skips introduction and discussion", () => {
  const approve = makeItem("Approval of the Agenda", "Opening", { type: "FOR_APPROVAL", motion: newMotion("MAJORITY", "THAT the agenda be approved") });
  assert.ok(!ids(itemSteps(approve, council())).includes("conflicts"));
  const adjourn = makeItem("Adjournment", "Closing", { type: "FOR_DECISION", motion: newMotion("MAJORITY", "THAT the meeting adjourn") });
  assert.deepEqual(ids(itemSteps(adjourn, council())), ["motion", "vote", "close"]);
});

test("electing a chair, and general meetings, count the vote by hand", () => {
  const chair = makeItem("Elect Chairperson", "Opening", { type: "FOR_DECISION", motion: newMotion("MAJORITY", "THAT X chair") });
  assert.equal(usesLiveVoting(chair, false), false);
  assert.ok(ids(itemSteps(chair, council())).includes("count"));
  const levy = makeItem("Special levy", "New Business", { type: "FOR_DECISION", motion: newMotion("THREE_QUARTER", "BE IT RESOLVED") });
  const steps = itemSteps(levy, { general: true, voteOpen: false, voteClosed: false });
  assert.deepEqual(ids(steps), ["introduce", "motion", "discuss", "count", "confirm"]);
  assert.match(steps.find((s) => s.id === "count")!.hint, /3\/4|Three/i);
});

test("information and discussion items", () => {
  assert.deepEqual(ids(itemSteps(makeItem("Treasurer's report", "Reports"), council())), ["introduce", "questions", "received"]);
  const d = itemSteps(makeItem("Dog policy", "New Business", { type: "FOR_DISCUSSION" }), council());
  assert.deepEqual(ids(d), ["introduce", "discuss", "direction"]);
  assert.ok(itemSteps({ ...makeItem("Dog policy", "New Business", { type: "FOR_DISCUSSION" }), done: true }, council()).every((st) => st.done));
});
