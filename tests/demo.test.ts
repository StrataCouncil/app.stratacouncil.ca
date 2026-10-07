import { test } from "node:test";
import assert from "node:assert/strict";
import { demoDayLabel, demoLink, endOfDemoDay, isDemoToken, newDemoToken } from "../lib/demo.ts";

const end = (iso: string) => endOfDemoDay(new Date(iso)).toISOString();

test("a demo link works until midnight Pacific on the day it was made", () => {
  // Summer (PDT, UTC-7): midnight is 07:00 UTC.
  assert.equal(end("2026-10-07T15:00:00Z"), "2026-10-08T07:00:00.000Z");
  // One minute before midnight still belongs to that day.
  assert.equal(end("2026-10-08T06:59:00Z"), "2026-10-08T07:00:00.000Z");
  // At midnight a new day starts.
  assert.equal(end("2026-10-08T07:00:00Z"), "2026-10-09T07:00:00.000Z");
  // Winter (PST, UTC-8): midnight is 08:00 UTC, and the month rolls over.
  assert.equal(end("2026-12-01T06:00:00Z"), "2026-12-01T08:00:00.000Z");
  assert.equal(end("2026-12-31T20:00:00Z"), "2027-01-01T08:00:00.000Z");
  // The days the clocks change.
  assert.equal(end("2026-03-08T12:00:00Z"), "2026-03-09T07:00:00.000Z");
  assert.equal(end("2026-11-01T12:00:00Z"), "2026-11-02T08:00:00.000Z");
});

test("the day is named in Pacific time", () => {
  assert.equal(demoDayLabel(new Date("2026-10-08T07:00:00Z")), "Wednesday, October 7");
});

test("link tokens are long, random and URL-safe", () => {
  const a = newDemoToken();
  assert.equal(a.length, 43);
  assert.ok(isDemoToken(a));
  assert.notEqual(a, newDemoToken());
  assert.ok(!isDemoToken("short"));
  assert.ok(!isDemoToken("a".repeat(40) + "/.."));
  assert.match(demoLink(a), /^https:\/\/demo\.stratacouncil\.ca\/start\/[A-Za-z0-9_-]{43}$/);
});
