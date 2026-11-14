import { test } from "node:test";
import assert from "node:assert/strict";
import { calculate, formatNumber } from "../lib/ai/calculator.ts";

const run = (...steps: Array<[string, string]>) => calculate(steps.map(([name, expression]) => ({ name, label: name, expression })));
const results = (...steps: Array<[string, string]>) => run(...steps).map((r) => r.result ?? `ERROR ${r.error}`);

test("arithmetic is exact as written, without float noise", () => {
  assert.deepEqual(results(["a", "0.1 + 0.2"], ["b", "84000 / 18"], ["c", "2 ^ 3 * (1 + 1)"], ["d", "-a + 1"]), ["0.3", "4666.6666666667", "16", "0.7"]);
});

test("earlier results can be used by name", () => {
  assert.deepEqual(results(["premium", "84000"], ["monthly", "premium / 18"], ["fy_share", "round(monthly * 5, 2)"]), ["84000", "4666.6666666667", "23333.33"]);
});

test("money rounds half away from zero, as written", () => {
  assert.deepEqual(results(["a", "round(1.005, 2)"], ["b", "round(2.5)"], ["c", "round(-2.5)"], ["d", "round(1234.5678, 2)"]), ["1.01", "3", "-3", "1234.57"]);
});

test("the insurance case: an 18-month policy from September against a February fiscal year", () => {
  const r = results(
    ["policy_end", "add_days(add_months('2026-09-01', 18), -1)"],
    ["policy_months", "months('2026-09-01', policy_end)"],
    ["in_fy", "overlap_months('2026-09-01', policy_end, '2026-02-01', '2027-01-31')"],
    ["in_next_fy", "overlap_months('2026-09-01', policy_end, '2027-02-01', '2028-01-31')"],
    ["previous_policy", "months('2026-02-01', '2026-07-31')"],
    ["fy_days", "days('2026-02-01', '2027-01-31')"],
    ["overlap", "overlap_days('2026-09-01', policy_end, '2026-02-01', '2027-01-31')"]
  );
  assert.deepEqual(r, ["2028-02-29", "18", "5", "12", "6", "365", "153"]);
});

test("part months count as their share of the month's days", () => {
  assert.deepEqual(results(["a", "months('2026-01-16', '2026-01-31')"], ["b", "months('2026-02-15', '2026-03-14')"]), ["0.5161290323", formatNumber(14 / 28 + 14 / 31)]);
});

test("month ends stay in their month", () => {
  assert.deepEqual(results(["a", "add_months('2026-01-31', 1)"], ["b", "add_months('2028-01-31', 1)"], ["c", "add_months('2026-03-31', -1)"]), ["2026-02-28", "2028-02-29", "2026-02-28"]);
});

test("non-overlapping periods share nothing", () => {
  assert.deepEqual(results(["a", "overlap_days('2025-01-01', '2025-06-30', '2026-01-01', '2026-12-31')"], ["b", "overlap_months('2025-01-01', '2025-06-30', '2026-01-01', '2026-12-31')"]), ["0", "0"]);
});

test("mistakes come back as errors Claude can fix, and later steps carry on", () => {
  const r = run(["a", "84,000 / 12"], ["b", "$100"], ["c", "1 / 0"], ["d", "missing * 2"], ["e", "'2026-02-30'"], ["f", "'2026-01-01' + 1"], ["g", "nope(1)"], ["h", "5 * 2"]);
  assert.match(r[0].error!, /commas/);
  assert.match(r[1].error!, /\$/);
  assert.match(r[2].error!, /zero/);
  assert.match(r[3].error!, /earlier result/);
  assert.match(r[4].error!, /real date/);
  assert.match(r[5].error!, /date can't be used/);
  assert.match(r[6].error!, /no 'nope'/);
  assert.equal(r[7].result, "10");
});

test("names are checked", () => {
  assert.match(run(["Bad Name", "1"])[0].error!, /lower-case/);
  assert.match(run(["days", "1"])[0].error!, /function/);
});
