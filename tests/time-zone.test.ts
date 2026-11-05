import { test } from "node:test";
import assert from "node:assert/strict";
import { tz, BC_FIXED_FROM } from "../lib/time-zone.ts";
import { clockTime } from "../lib/meetings/minutes.ts";
import { zonedInstant } from "../lib/meetings/scripts.ts";

test("BC times from Nov 1, 2026 are UTC-7, whatever time-zone data the runtime has", () => {
  assert.equal(tz("America/Vancouver", "2026-11-05T16:44:25Z"), "Etc/GMT+7");
  assert.equal(tz("America/Vancouver", "2026-10-31T16:44:25Z"), "America/Vancouver");
  assert.equal(tz("America/Vancouver", BC_FIXED_FROM - 1), "America/Vancouver");
  assert.equal(tz("America/Toronto", "2026-11-05T16:44:25Z"), "America/Toronto");
  // John's demo started at 9:44 a.m. in BC, not 8:44.
  assert.equal(clockTime("2026-11-05T16:44:25Z", "America/Vancouver"), "9:44 a.m. PT");
  // Summer before the change is unaffected.
  assert.equal(clockTime("2026-07-01T02:30:00Z", "America/Vancouver"), "7:30 p.m. PT");
});

test("a 7:00 p.m. BC meeting in winter starts at 02:00 UTC from November 2026", () => {
  assert.equal(zonedInstant("2026-11-24", "19:00", "America/Vancouver").toISOString(), "2026-11-25T02:00:00.000Z");
  // Before the change, winter was UTC-8.
  assert.equal(zonedInstant("2025-11-24", "19:00", "America/Vancouver").toISOString(), "2025-11-25T03:00:00.000Z");
});
