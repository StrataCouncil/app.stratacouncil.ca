import { test } from "node:test";
import assert from "node:assert/strict";
import { HOURLY_LIMIT, nextAskAt } from "../lib/ai/hourly-limit.ts";

const now = Date.parse("2026-11-12T22:00:00Z");
const minutesAgo = (n: number) => new Date(now - n * 60_000).toISOString();

test("under the limit: no time to wait for", () => {
  assert.equal(HOURLY_LIMIT, 30);
  assert.equal(nextAskAt(Array.from({ length: 29 }, (_, i) => minutesAgo(i)), now), null);
});

test("at the limit: when the 30th newest answer turns an hour old, rounded up to the minute", () => {
  // Answers 0..29 minutes ago (plus a stray second); the oldest counted was 29 min 30 s ago.
  const recent = Array.from({ length: 30 }, (_, i) => minutesAgo(i));
  recent[29] = new Date(now - 29.5 * 60_000).toISOString();
  assert.equal(nextAskAt(recent, now), "2026-11-12T22:31:00.000Z");
});

test("order doesn't matter, and only the newest 30 count", () => {
  const recent = Array.from({ length: 35 }, (_, i) => minutesAgo(i)).reverse();
  assert.equal(nextAskAt(recent, now), "2026-11-12T22:31:00.000Z");
});
