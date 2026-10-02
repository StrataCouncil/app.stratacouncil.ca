import { test } from "node:test";
import assert from "node:assert/strict";
import { titleFromQuestion } from "../lib/ai/conversation-title.ts";

test("titles come from the first question", () => {
  assert.equal(titleFromQuestion("  When is the\nroof levy due? "), "When is the roof levy due?");
  assert.equal(titleFromQuestion("When is the roof levy due?"), "When is the roof levy due?");
  assert.equal(titleFromQuestion(""), "New conversation");
  const long = titleFromQuestion("What did council decide about the parkade membrane replacement and who moved the motion last spring?");
  assert.ok(long.length <= 61 && long.endsWith("…"), long);
  assert.ok(!long.includes("  "));
});
