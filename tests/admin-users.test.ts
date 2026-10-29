import { test } from "node:test";
import assert from "node:assert/strict";
import { followUpReason, furthestStage, reachedStages, regionFromAddress, strataName, type PersonFacts } from "../lib/admin-users.ts";

const NOW = Date.parse("2026-10-29T18:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

const fresh = (over: Partial<PersonFacts> = {}): PersonFacts => ({
  signedUpAt: daysAgo(0),
  modulesStarted: 0,
  modulesFinished: 0,
  credentials: 0,
  unfinishedSince: null,
  activeStratas: 0,
  ranMeeting: false,
  subscribedStrata: false,
  pendingInvites: [],
  ...over,
});

test("a new sign-up has only signed up", () => {
  assert.deepEqual(reachedStages(fresh()), ["signed_up"]);
  assert.equal(furthestStage(fresh()), "signed_up");
});

test("milestones are counted independently, and the furthest wins", () => {
  const p = fresh({ modulesStarted: 2, modulesFinished: 1, activeStratas: 1 });
  assert.deepEqual(reachedStages(p), ["signed_up", "training_started", "module_finished", "in_strata"]);
  assert.equal(furthestStage(p), "in_strata");
  // In a subscribed strata without any training still counts as subscribed.
  assert.equal(furthestStage(fresh({ activeStratas: 1, subscribedStrata: true })), "subscribed");
});

test("follow-up: 3 days with no training and no strata", () => {
  assert.equal(followUpReason(fresh({ signedUpAt: daysAgo(2) }), NOW), null);
  assert.equal(followUpReason(fresh({ signedUpAt: daysAgo(4) }), NOW), "Signed up 4 days ago; no training or strata yet");
  assert.equal(followUpReason(fresh({ signedUpAt: daysAgo(4), activeStratas: 1 }), NOW), null);
});

test("follow-up: training started and left for a week, nothing finished", () => {
  const started = fresh({ signedUpAt: daysAgo(20), modulesStarted: 1, unfinishedSince: daysAgo(9) });
  assert.equal(followUpReason(started, NOW), "Started training, then stopped 9 days ago");
  assert.equal(followUpReason({ ...started, unfinishedSince: daysAgo(3) }, NOW), null);
  assert.equal(followUpReason({ ...started, modulesFinished: 1 }, NOW), null);
});

test("follow-up: an invitation unanswered for a week comes first", () => {
  const invited = fresh({ signedUpAt: daysAgo(10), pendingInvites: [{ strata: "BCS-1234", sentAt: daysAgo(8) }] });
  assert.equal(followUpReason(invited, NOW), "Invited to BCS-1234 8 days ago and hasn’t joined");
  assert.equal(followUpReason(fresh({ pendingInvites: [{ strata: "BCS-1234", sentAt: daysAgo(2) }] }), NOW), null);
});

test("region comes from the strata's civic address", () => {
  assert.equal(regionFromAddress("1702 Coursier Ave, Revelstoke, BC, V0E 2S1"), "Revelstoke, BC");
  assert.equal(regionFromAddress("88 Pine St, Unit 4, Port Moody, BC"), "Port Moody, BC");
  assert.equal(regionFromAddress("1 Main St"), null);
  assert.equal(regionFromAddress(null), null);
});

test("strata names", () => {
  assert.equal(strataName("BCS-1234", "Larchwood Commons"), "Larchwood Commons (BCS-1234)");
  assert.equal(strataName("BCS-1234", null), "BCS-1234");
});
