import { test } from "node:test";
import assert from "node:assert/strict";
import { trimHistory } from "../lib/ai/conversation-history.ts";

const turn = (role: string, n: number) => ({ role, content: "x".repeat(n), context: role === "user" ? "c".repeat(n) : null });

test("under budget, everything is kept", () => {
  const turns = [turn("user", 10), turn("assistant", 10)];
  assert.deepEqual(trimHistory(turns, 100), { turns, trimmed: false });
});

test("over budget, the newest turns within half the budget are kept, starting at a question", () => {
  // Each user turn is 20 chars (content + context), each answer 10.
  const turns = [turn("user", 10), turn("assistant", 10), turn("user", 10), turn("assistant", 10), turn("user", 10), turn("assistant", 10)];
  const { turns: kept, trimmed } = trimHistory(turns, 80); // total 90 > 80; keep <= 40
  assert.equal(trimmed, true);
  assert.equal(kept[0].role, "user");
  assert.equal(kept.length, 2);
  assert.ok(kept.reduce((n, m) => n + m.content.length + (m.context?.length ?? 0), 0) <= 40);
});

test("the cut is stable: the same history gives the same result", () => {
  const turns = Array.from({ length: 20 }, (_, i) => turn(i % 2 ? "assistant" : "user", 50));
  assert.deepEqual(trimHistory(turns, 1000), trimHistory(turns, 1000));
});
