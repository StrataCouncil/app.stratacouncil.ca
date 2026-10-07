import { test } from "node:test";
import assert from "node:assert/strict";
import { DEMO_EDITABLE_ITEM_ID, demoDayLabel, demoLink, demoOpenModule, endOfDemoDay, isDemoToken, lockDemoAgenda, newDemoToken } from "../lib/demo.ts";

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

test("the demo's agenda: only the editable item can change", () => {
  const item = (id: string, text: string, cat = "Business") => ({ id, catId: `c_${cat}`, cat, num: 0, text });
  const saved = [item("a", "Call to Order", "Opening"), item("b", "Approve Agenda"), item(DEMO_EDITABLE_ITEM_ID, "Roof Repairs", "New Business"), item("z", "Adjournment")];
  const incoming = [
    item("a", "Renamed"),
    item(DEMO_EDITABLE_ITEM_ID, "Roof Repairs: temporary patch", "Moved elsewhere"),
    item("new", "Something added"),
    item("z", "Adjournment"),
  ];
  const out = lockDemoAgenda(saved, incoming);
  assert.deepEqual(out.map((i) => i.id), ["a", "b", DEMO_EDITABLE_ITEM_ID, "z"], "same items, same order");
  assert.equal(out[0].text, "Call to Order");
  assert.equal(out[2].text, "Roof Repairs: temporary patch");
  assert.equal(out[2].cat, "New Business", "it stays in its category");
  assert.deepEqual(lockDemoAgenda(saved, []), saved, "leaving it out changes nothing");
});
