import { test } from "node:test";
import assert from "node:assert/strict";
import { randomChoice, randomSeconds, AGAINST_COMMENTS } from "../lib/demo-kit/council-votes.ts";

test("the fictional council votes mostly For, sometimes Against, now and then abstains", () => {
  assert.equal(randomChoice(0), "for");
  assert.equal(randomChoice(0.69), "for");
  assert.equal(randomChoice(0.7), "against");
  assert.equal(randomChoice(0.89), "against");
  assert.equal(randomChoice(0.9), "abstain");
  assert.equal(randomChoice(0.999), "abstain");
});

test("waits are whole seconds within the range", () => {
  assert.equal(randomSeconds(2, 6, 0), 2);
  assert.equal(randomSeconds(2, 6, 1), 6);
  assert.equal(randomSeconds(12, 45, 0.5), 29);
  for (let i = 0; i < 50; i++) {
    const s = randomSeconds(3, 9);
    assert.ok(Number.isInteger(s) && s >= 3 && s <= 9);
  }
});

test("against comments are plain sentences", () => {
  for (const c of AGAINST_COMMENTS) assert.match(c, /^[A-Z].*[.]$/);
});
