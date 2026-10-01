/** Strata Plan text helpers. Run: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  highestLotMentioned,
  legalNameFor,
  mentionsPlanNumber,
  planNumbersIn,
  reconcilePlan,
} from "../lib/strata-plan.ts";

const plan = `STRATA PLAN EPS9048
SCHEDULE OF UNIT ENTITLEMENT
Strata Lot No. Sheet No. Unit Entitlement
Strata Lot 1 3 81
SL 2 3 75
Lot 102 7 90
Total 8,265`;

test("plan number is found with any spacing", () => {
  assert.equal(mentionsPlanNumber(plan, "EPS-9048"), true);
  assert.equal(mentionsPlanNumber("Strata Plan EPS 9048", "EPS-9048"), true);
  assert.equal(mentionsPlanNumber("Strata Plan EPS-904", "EPS-9048"), false);
  assert.equal(mentionsPlanNumber(plan, "EPS-904"), false);
});

test("other plan numbers are listed when the requested one isn't there", () => {
  assert.deepEqual(planNumbersIn("Strata Plan LMS 1501 and BCS3229"), ["LMS-1501", "BCS-3229"]);
});

test("highest lot mentioned", () => {
  assert.equal(highestLotMentioned(plan), 102);
  assert.equal(highestLotMentioned("no lots here"), null);
  assert.equal(highestLotMentioned("Strata Lot 4 on District Lot 1234"), 4);
});

test("legal name", () => {
  assert.equal(legalNameFor("EPS-9048"), "The Owners, Strata Plan EPS9048");
});

test("reconcile: AI count agrees with the text", () => {
  const r = reconcilePlan(plan, "EPS-9048", { lots: 102, totalUnitEntitlement: 8265, filedYear: 2019 });
  assert.equal(r.lots, 102);
  assert.equal(r.lotsCheck, "consistent");
  assert.equal(r.planNumberMatches, true);
  assert.equal(r.filedYear, 2019);
});

test("reconcile: disagreement is flagged, not hidden", () => {
  const r = reconcilePlan(plan, "EPS-9048", { lots: 98, totalUnitEntitlement: null, filedYear: 1800 });
  assert.equal(r.lots, 98);
  assert.equal(r.lotsCheck, "differs");
  assert.equal(r.filedYear, null);
});

test("reconcile: wrong plan", () => {
  const r = reconcilePlan("STRATA PLAN LMS1501 Strata Lot 12", "EPS-9048", { lots: 12, totalUnitEntitlement: null, filedYear: null });
  assert.equal(r.planNumberMatches, false);
  assert.deepEqual(r.otherPlanNumbers, ["LMS-1501"]);
});
