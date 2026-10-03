import { test } from "node:test";
import assert from "node:assert/strict";
import { computeCommittedUntil, currentTermEnd } from "../lib/stripe/prices.ts";

const first = new Date("2026-10-15T17:00:00Z");

test("the first term ends 12 months after it starts", () => {
  assert.equal(computeCommittedUntil(new Date("2025-10-15T17:00:00Z")).toISOString(), first.toISOString());
});

test("during the first term, the term end is the first anniversary", () => {
  assert.equal(currentTermEnd(first, new Date("2026-03-01T00:00:00Z")).toISOString(), first.toISOString());
});

test("after renewing, the term end rolls to the next anniversary", () => {
  assert.equal(currentTermEnd(first, new Date("2027-01-01T00:00:00Z")).toISOString(), "2027-10-15T17:00:00.000Z");
  assert.equal(currentTermEnd(first, new Date("2029-12-31T00:00:00Z")).toISOString(), "2030-10-15T17:00:00.000Z");
});

test("on the anniversary itself, the next term has begun", () => {
  assert.equal(currentTermEnd(first, first).toISOString(), "2027-10-15T17:00:00.000Z");
});

test("a leap-day start keeps rolling from the original date", () => {
  const leap = new Date("2028-02-29T12:00:00Z");
  assert.equal(currentTermEnd(leap, new Date("2028-03-05T00:00:00Z")).toISOString(), "2029-03-01T12:00:00.000Z");
  assert.equal(currentTermEnd(leap, new Date("2031-06-01T00:00:00Z")).toISOString(), "2032-02-29T12:00:00.000Z");
});
