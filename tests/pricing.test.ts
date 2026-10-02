import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateCostUsd } from "../lib/ai/pricing.ts";

test("cost estimate per million tokens", () => {
  assert.equal(estimateCostUsd({ input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 }), 4);
  assert.equal(estimateCostUsd({ input: 0, output: 1_000_000, cacheRead: 0, cacheWrite: 0 }), 20);
  assert.equal(estimateCostUsd({ input: 0, output: 0, cacheRead: 1_000_000, cacheWrite: 1_000_000 }), 5.2);
  // A typical cached follow-up: 2k new, 30k read from cache, 1k written, 600 out.
  assert.ok(Math.abs(estimateCostUsd({ input: 2000, output: 600, cacheRead: 30000, cacheWrite: 1000 }) - 0.031) < 1e-9);
});
