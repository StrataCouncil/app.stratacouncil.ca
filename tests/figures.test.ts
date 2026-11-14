import { test } from "node:test";
import assert from "node:assert/strict";
import { figureFound, figureLines, parseNumericFigure } from "../lib/ai/figures.ts";

const answer =
  "The premium charged to FY2027 (February 1, 2026 to January 31, 2027) is $23,333.33: 5 of the policy's 18 months, at $4,666.67 a month. The financing runs 12 months at 4.5% from 2026-09-01.";

test("money is matched by value, to the figure's decimal places", () => {
  assert.ok(figureFound(answer, "$23,333.33"));
  assert.ok(figureFound(answer, "23333.33"));
  assert.ok(figureFound(answer, "4,666.67"));
  assert.ok(!figureFound(answer, "$4,666.70"));
  assert.ok(!figureFound(answer, "$23,333"), "a rounded figure isn't found in a more precise one");
  assert.ok(!figureFound("It's $4,667 a month.", "$4,666.67"));
});

test("units must follow the number", () => {
  assert.ok(!figureFound(answer, "5 months"), "the answer says 5 of 18 months, not 5 months");
  assert.ok(figureFound(answer, "18 months"));
  assert.ok(figureFound(answer, "12 month"));
  assert.ok(!figureFound(answer, "5 days"));
  assert.ok(figureFound(answer, "4.5%"));
  assert.ok(figureFound("at 4.5 per cent", "4.5%"));
});

test("dates are found however they're written", () => {
  assert.ok(figureFound(answer, "2027-01-31"));
  assert.ok(figureFound(answer, "2026-09-01"));
  assert.ok(figureFound("ends Jan 31, 2027", "2027-01-31"));
  assert.ok(figureFound("ends 31 January 2027", "2027-01-31"));
  assert.ok(!figureFound(answer, "2027-02-01"));
});

test("the parts of a date aren't amounts", () => {
  assert.ok(!figureFound("from 2026-09-01", "9"));
  assert.ok(!figureFound("from 2026-09-01", "2026"));
});

test("anything else is matched as text", () => {
  assert.ok(figureFound(answer, "of the  Policy's"));
  assert.ok(figureFound(answer, "FY2027"));
});

test("figures parse with their decimals and unit", () => {
  assert.deepEqual(parseNumericFigure("$1,250.50"), { value: 1250.5, decimals: 2, unit: "" });
  assert.deepEqual(parseNumericFigure("18 months"), { value: 18, decimals: 0, unit: "months" });
  assert.equal(parseNumericFigure("about 18"), null);
  assert.deepEqual(figureLines(" $1\n\n 2 months \n"), ["$1", "2 months"]);
});

test("figures are pulled out of an answer", async () => {
  const { extractFigures } = await import("../lib/ai/figures.ts");
  assert.deepEqual(
    extractFigures("By January 19, 2028 (2 years after 2026-01-19), budget $8,500.00 and $ 120 at 5 % over 18 months."),
    ["$8,500.00", "$120", "5%", "2026-01-19", "2028-01-19", "2 years", "18 months"]
  );
});
