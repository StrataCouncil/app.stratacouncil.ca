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

test("in a meeting, an answer builds only on questions about the same agenda item", async () => {
  const { turnsForItem } = await import("../lib/ai/conversation-history.ts");
  const M = "m1";
  const q = (itemId: string | null, content: string) => ({
    role: "user",
    content,
    focus: itemId ? { kind: "agenda_item", meetingId: M, itemId, label: "x" } : null,
  });
  const a = (content: string) => ({ role: "assistant", content });
  const turns = [q("i1", "roof?"), a("roof answer"), q("i2", "fees?"), a("fees answer"), q(null, "general"), a("general answer"), q("i1", "quotes?"), a("quotes answer")];
  assert.deepEqual(
    turnsForItem(turns, M, "i1").map((t) => t.content),
    ["roof?", "roof answer", "quotes?", "quotes answer"]
  );
  assert.deepEqual(turnsForItem(turns, M, "i3"), []);
  assert.deepEqual(turnsForItem(turns, "other-meeting", "i1"), []);
  // The newest turns only, starting at a question.
  assert.deepEqual(
    turnsForItem(turns, M, "i1", 3).map((t) => t.content),
    ["quotes?", "quotes answer"]
  );
});
