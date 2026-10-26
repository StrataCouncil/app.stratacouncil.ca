import { test } from "node:test";
import assert from "node:assert/strict";
import { campaignLine, parseDemoRequest } from "../lib/demo-requests.ts";

test("a demo request keeps a tidy name, a lower-case email and the page it came from", () => {
  assert.deepEqual(parseDemoRequest({ name: "  JJ   Mc ", email: " JJMC@Telus.net ", page: "home" }), {
    ok: true,
    name: "JJ Mc",
    email: "jjmc@telus.net",
    source: "home",
    campaign: null,
  });
  const old = parseDemoRequest({ name: "A", email: "a@b.ca", page: "coming-soon" });
  assert.ok(old.ok && "source" in old && old.source === "coming-soon");
  const unknown = parseDemoRequest({ name: "A", email: "a@b.ca", page: "elsewhere" });
  assert.ok(unknown.ok && "source" in unknown && unknown.source === "home");
});

test("a demo request needs a name and a real email", () => {
  assert.deepEqual(parseDemoRequest({ name: " ", email: "a@b.ca" }), { ok: false, message: "Please enter your name." });
  assert.deepEqual(parseDemoRequest({ name: "x".repeat(121), email: "a@b.ca" }), { ok: false, message: "Please enter your name." });
  assert.deepEqual(parseDemoRequest({ name: "A", email: "not an email" }), { ok: false, message: "Please enter a valid email address." });
  assert.deepEqual(parseDemoRequest(null), { ok: false, message: "Please enter your name." });
});

test("the hidden field marks a bot, and nothing is kept", () => {
  assert.deepEqual(parseDemoRequest({ name: "A", email: "a@b.ca", website: "spam.example" }), { ok: true, bot: true });
});

test("only the five campaign tags are kept, as strings of up to 100 characters", () => {
  const r = parseDemoRequest({
    name: "A",
    email: "a@b.ca",
    campaign: { utm_source: " facebook ", utm_campaign: "x".repeat(150), utm_medium: 5, other: "dropped" },
  });
  assert.ok(r.ok && "campaign" in r);
  assert.deepEqual(r.campaign, { utm_source: "facebook", utm_campaign: "x".repeat(100) });
  const none = parseDemoRequest({ name: "A", email: "a@b.ca", campaign: "utm_source=x" });
  assert.ok(none.ok && "campaign" in none && none.campaign === null);
});

test("the campaign line shows source, medium and campaign", () => {
  assert.equal(campaignLine({ utm_source: "facebook", utm_medium: "social", utm_campaign: "first-meeting", utm_term: "t" }), "facebook / social / first-meeting");
  assert.equal(campaignLine(null), "");
});
