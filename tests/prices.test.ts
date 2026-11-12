import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateBilling, customBilling, ENTERPRISE_LOTS, PLAN_RATES } from "../lib/stripe/prices.ts";

test("monthly: $30 a strata plus $3 a lot a month, GST on top", () => {
  assert.deepEqual(PLAN_RATES.monthly, { base: 30, perLot: 3 });
  const p = calculateBilling(6, "monthly");
  assert.equal(p.subtotal, 48);
  assert.equal(p.gst, 2.4);
  assert.equal(p.total, 50.4);
});

test("yearly: $25 a strata plus $2.50 a lot a month, a 12-month commitment billed monthly (two months free)", () => {
  assert.deepEqual(PLAN_RATES.annual, { base: 25, perLot: 2.5 });
  const p = calculateBilling(45, "annual");
  assert.equal(p.subtotal, 137.5);
  assert.equal(p.gst, 6.88);
  assert.equal(p.total, 144.38);
  // Twelve months of yearly cost what ten months of monthly do.
  assert.equal(p.subtotal * 12, calculateBilling(45, "monthly").subtotal * 10);
});

test("no cap: the price keeps rising with the lots", () => {
  assert.equal(calculateBilling(100, "monthly").subtotal, 330);
  assert.equal(calculateBilling(200, "monthly").subtotal, 630);
});

test("the $2,000 a year line: monthly passes it at 43 lots, yearly at 54", () => {
  const year = (lots: number, plan: "monthly" | "annual") => calculateBilling(lots, plan).total * 12;
  assert.ok(year(42, "monthly") < 2000 && year(43, "monthly") > 2000);
  assert.ok(year(53, "annual") < 2000 && year(54, "annual") > 2000);
});

test("Enterprise prices are an agreed monthly amount", () => {
  assert.equal(customBilling(400).total, 420);
  assert.equal(ENTERPRISE_LOTS, 100);
});
