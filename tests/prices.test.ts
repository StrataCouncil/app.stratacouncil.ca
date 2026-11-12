import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateBilling, customBilling, ENTERPRISE_LOTS, padAllowed, PLAN_RATES } from "../lib/stripe/prices.ts";

test("monthly: $30 a strata plus $3 a lot, GST on top", () => {
  assert.deepEqual(PLAN_RATES.monthly, { base: 30, perLot: 3, period: "month" });
  const p = calculateBilling(6, "monthly");
  assert.equal(p.subtotal, 48);
  assert.equal(p.gst, 2.4);
  assert.equal(p.total, 50.4);
  assert.equal(p.period, "month");
  assert.equal(p.monthlyTotal, 50.4);
});

test("yearly: $300 a strata plus $30 a lot, charged once a year (two months free)", () => {
  const p = calculateBilling(45, "annual");
  assert.equal(p.subtotal, 1650);
  assert.equal(p.gst, 82.5);
  assert.equal(p.total, 1732.5);
  assert.equal(p.period, "year");
  assert.equal(p.monthlySubtotal, 137.5);
  // Ten months of the monthly price.
  assert.equal(p.subtotal, calculateBilling(45, "monthly").subtotal * 10);
});

test("no cap: the price keeps rising with the lots", () => {
  assert.equal(calculateBilling(100, "monthly").subtotal, 330);
  assert.equal(calculateBilling(200, "monthly").subtotal, 630);
});

test("the $2,000 a year line: monthly passes it at 43 lots, yearly at 54", () => {
  const yearOfMonthly = (lots: number) => calculateBilling(lots, "monthly").total * 12;
  assert.ok(yearOfMonthly(42) < 2000 && yearOfMonthly(43) > 2000);
  assert.ok(calculateBilling(53, "annual").total < 2000 && calculateBilling(54, "annual").total > 2000);
});

test("pre-authorized debit only up to Stripe's $3,000 a charge", () => {
  assert.equal(padAllowed(calculateBilling(85, "annual")), true);
  assert.equal(padAllowed(calculateBilling(86, "annual")), false);
  assert.equal(padAllowed(calculateBilling(ENTERPRISE_LOTS, "monthly")), true);
});

test("Enterprise prices are an agreed amount per period", () => {
  const p = customBilling(4000, "annual");
  assert.equal(p.total, 4200);
  assert.equal(p.period, "year");
  assert.equal(customBilling(250, "monthly").period, "month");
  assert.equal(ENTERPRISE_LOTS, 100);
});
