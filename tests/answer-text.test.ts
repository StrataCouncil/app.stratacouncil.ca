import { test } from "node:test";
import assert from "node:assert/strict";
import { answerCleaner, citedTags, cleanAnswer } from "../lib/ai/answer-text.ts";

const valid = new Set(["D1", "D2", "L1", "E3", "B1", "R"]);

test("tags are taken out of the text and listed in order", () => {
  const raw = "Your first report is due by January 19, 2028 [L1, E3]. Council chose a vendor [D2][D1].";
  assert.equal(cleanAnswer(raw, valid), "Your first report is due by January 19, 2028. Council chose a vendor.");
  assert.deepEqual(citedTags(raw, valid), ["L1", "E3", "D2", "D1"]);
});

test("brackets that aren't tags sent with the question stay", () => {
  const raw = "Owner [name redacted] wrote [X9]. See [A].";
  assert.equal(cleanAnswer(raw, valid), raw);
  assert.deepEqual(citedTags(raw, valid), []);
});

test("markup symbols and emoji never show; paragraphs are spaced", () => {
  const raw = "## Answer\n\n**Due January 19, 2028.** It's *two years* after the AGM ✅\n\n\n\n- First point\n* Second point\n1. Step one\n\nStratasphere™ © 2026";
  assert.equal(cleanAnswer(raw, valid), "Answer\n\nDue January 19, 2028. It's two years after the AGM\n\nFirst point\nSecond point\n1. Step one\n\nStratasphere™ © 2026");
});

test("arithmetic and dates are left alone", () => {
  assert.equal(cleanAnswer("84000 / 18 * 5 = 23333.33, from 2026-09-01 to 2027-01-31; -5 is negative.", valid), "84000 / 18 * 5 = 23333.33, from 2026-09-01 to 2027-01-31; -5 is negative.");
});

test("a streamed answer comes out clean however it's split", () => {
  const raw = "## Due date\n\n**Your first report** is due by January 19, 2028 [L1, E3].\n\nCommission it early [D1].";
  for (const size of [1, 2, 3, 5, 7, 11]) {
    let shown = "";
    const c = answerCleaner(valid, (d) => (shown += d));
    for (let i = 0; i < raw.length; i += size) c.push(raw.slice(i, i + size));
    const text = c.finish();
    assert.equal(text, "Due date\n\nYour first report is due by January 19, 2028.\n\nCommission it early.");
    assert.equal(shown, text, `split every ${size}`);
    assert.ok(!shown.includes("[") && !shown.includes("*") && !shown.includes("#"));
  }
});

test("the recall check sees which tags back which part of the answer", async () => {
  const { answerSegments } = await import("../lib/ai/answer-text.ts");
  assert.deepEqual(answerSegments("**Due** January 19, 2028 [L1, E3]. Vendor chosen [D1].", valid), [
    { text: "Due January 19, 2028" },
    { tags: ["L1", "E3"] },
    { text: ". Vendor chosen" },
    { tags: ["D1"] },
    { text: "." },
  ]);
});
