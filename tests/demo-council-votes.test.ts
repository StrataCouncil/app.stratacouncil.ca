import { test } from "node:test";
import assert from "node:assert/strict";
import { randomChoice, AGAINST_COMMENTS } from "../lib/demo-kit/council-votes.ts";

test("the fictional council votes mostly For, sometimes Against, now and then abstains", () => {
  assert.equal(randomChoice(0), "for");
  assert.equal(randomChoice(0.69), "for");
  assert.equal(randomChoice(0.7), "against");
  assert.equal(randomChoice(0.89), "against");
  assert.equal(randomChoice(0.9), "abstain");
  assert.equal(randomChoice(0.999), "abstain");
});

test("against comments are plain sentences", () => {
  for (const c of AGAINST_COMMENTS) assert.match(c, /^[A-Z].*[.]$/);
});
