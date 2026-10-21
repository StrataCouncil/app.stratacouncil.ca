import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DISCLAIMER,
  formatSeconds,
  normalizeInvestorEmail,
  normalizeInvestorName,
  referralId,
} from "../lib/investors/briefing.ts";

test("the disclaimer names the company, with no placeholder or emoji", () => {
  const text = JSON.stringify(DISCLAIMER);
  assert.ok(text.includes("Trickfilm Entertainment Inc."));
  assert.ok(!text.includes("[Company Name]"));
  assert.ok(!/\p{Extended_Pictographic}/u.test(text));
});

test("investor sign-up details are checked and tidied", () => {
  assert.equal(normalizeInvestorEmail("  Pat@Example.COM "), "pat@example.com");
  assert.equal(normalizeInvestorEmail("not an email"), null);
  assert.equal(normalizeInvestorName("  Pat   Investor "), "Pat Investor");
  assert.equal(normalizeInvestorName("   "), null);
  assert.equal(normalizeInvestorName("x".repeat(121)), null);
});

test("a Share link's ref is only ever an investor id", () => {
  assert.equal(referralId("33333333-3333-3333-3333-333333333333"), "33333333-3333-3333-3333-333333333333");
  assert.equal(referralId("1 or 1=1"), null);
  assert.equal(referralId(undefined), null);
});

test("viewing time reads naturally", () => {
  assert.equal(formatSeconds(45), "45s");
  assert.equal(formatSeconds(200), "3m 20s");
  assert.equal(formatSeconds(3900), "1h 5m");
});
