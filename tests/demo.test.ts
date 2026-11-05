import { test } from "node:test";
import assert from "node:assert/strict";
import { DEMO_EDITABLE_ITEM_ID, demoDayLabel, demoLink, demoLinkEnds, demoOpenModule, endOfDemoDay, isDemoToken, newDemoToken } from "../lib/demo.ts";

const end = (iso: string) => endOfDemoDay(new Date(iso)).toISOString();

test("a demo link works until midnight Pacific on the day it was made", () => {
  // Summer (PDT, UTC-7): midnight is 07:00 UTC.
  assert.equal(end("2026-10-07T15:00:00Z"), "2026-10-08T07:00:00.000Z");
  // One minute before midnight still belongs to that day.
  assert.equal(end("2026-10-08T06:59:00Z"), "2026-10-08T07:00:00.000Z");
  // At midnight a new day starts.
  assert.equal(end("2026-10-08T07:00:00Z"), "2026-10-09T07:00:00.000Z");
  // Winter before BC stayed on UTC-7 (PST, UTC-8): midnight is 08:00 UTC.
  assert.equal(end("2025-12-01T06:00:00Z"), "2025-12-01T08:00:00.000Z");
  // From November 2026 BC stays on UTC-7 all year: midnight is 07:00 UTC, and the month rolls over.
  assert.equal(end("2026-12-01T06:00:00Z"), "2026-12-01T07:00:00.000Z");
  assert.equal(end("2026-12-31T20:00:00Z"), "2027-01-01T07:00:00.000Z");
  // The days the clocks change.
  assert.equal(end("2026-03-08T12:00:00Z"), "2026-03-09T07:00:00.000Z");
  // Nov 1, 2026: the clocks didn't go back.
  assert.equal(end("2026-11-01T12:00:00Z"), "2026-11-02T07:00:00.000Z");
});

test("a demo link works for three days after the day it was made", () => {
  const ends = (iso: string) => demoLinkEnds(new Date(iso)).toISOString();
  // Made Wednesday afternoon (PDT): works until Saturday ends.
  assert.equal(ends("2026-10-07T22:00:00Z"), "2026-10-11T07:00:00.000Z");
  assert.equal(demoDayLabel(new Date(ends("2026-10-07T22:00:00Z"))), "Saturday, October 10");
  // Made a minute before midnight: still counted from that day.
  assert.equal(ends("2026-10-08T06:59:00Z"), "2026-10-11T07:00:00.000Z");
  // Across Nov 1, 2026: BC stays on UTC-7, so midnight stays at 07:00 UTC.
  assert.equal(ends("2026-10-30T20:00:00Z"), "2026-11-03T07:00:00.000Z");
  // A year earlier the clocks went back and midnight moved to 08:00 UTC.
  assert.equal(ends("2025-10-30T20:00:00Z"), "2025-11-03T08:00:00.000Z");
  // Across the start of daylight saving (Mar 8).
  assert.equal(ends("2026-03-06T20:00:00Z"), "2026-03-10T07:00:00.000Z");
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

test("demo visitors get the first published module, in learning order", () => {
  const tracks = [
    { id: "council-ready", order_index: 2 },
    { id: "basics", order_index: 1 },
  ];
  const m = (id: string, track_id: string, order_index: number, published_version: number) => ({ id, track_id, order_index, published_version });
  assert.equal(
    demoOpenModule(tracks, [m("cr1", "council-ready", 1, 3), m("b2", "basics", 2, 1), m("b1", "basics", 1, 0)])?.id,
    "b2",
    "an unpublished first module is skipped"
  );
  assert.equal(demoOpenModule(tracks, [m("cr1", "council-ready", 1, 3), m("b1", "basics", 1, 2)])?.id, "b1");
  assert.equal(demoOpenModule(tracks, [m("b1", "basics", 1, 0)]), null);
});

test("a sandbox lasts 7 days after the day it's made, to midnight Pacific", async () => {
  const { sandboxEnds, demoLinkEnds } = await import("../lib/demo.ts");
  const made = new Date("2026-11-04T19:00:00Z"); // Wednesday, 11 a.m. PST
  assert.equal(sandboxEnds(made).toISOString(), "2026-11-12T07:00:00.000Z");
  assert.ok(sandboxEnds(made) > demoLinkEnds(made));
});

test("a sandbox's people have reserved addresses of their own", async () => {
  const { SANDBOX_PERSONAS, sandboxPersonaEmail } = await import("../lib/demo.ts");
  const a = sandboxPersonaEmail("eeeeeeee-1111-0000-0000-000000000001", "margaret");
  const b = sandboxPersonaEmail("ffffffff-1111-0000-0000-000000000001", "margaret");
  assert.equal(a, "margaret.eeeeeeee@sandbox.example.com");
  assert.notEqual(a, b, "each sandbox gets its own Margaret, never the shared demo account");
  assert.equal(SANDBOX_PERSONAS[0].key, "admin");
  assert.ok(SANDBOX_PERSONAS.some((p) => p.key === "liam"), "the secretary, who can run meetings");
});
