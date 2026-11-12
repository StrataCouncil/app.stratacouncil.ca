import { test } from "node:test";
import assert from "node:assert/strict";
import { inSendingHours, nextSignupStep, pacificHour, type SignupPerson } from "../lib/lifecycle/signup.ts";
import { setupFooter, signupEmail, type SignupEmailParams } from "../lib/lifecycle/emails.ts";
import { creationRequestApprovedEmail, creationRequestDeniedEmail } from "../lib/email/templates.ts";

const NOW = new Date("2026-11-20T19:00:00Z"); // 12:00 in BC (UTC-7)
const ago = (hours: number) => new Date(NOW.getTime() - hours * 3600_000).toISOString();
const person = (over: Partial<SignupPerson> = {}): SignupPerson => ({
  confirmedAt: ago(2),
  pendingCreation: false,
  pendingJoin: false,
  trainingStarted: false,
  trainingCompleted: false,
  lastSentAt: null,
  stepsSent: [],
  ...over,
});

test("sending hours are 9:00 to 17:00 in BC, which stayed on UTC-7", () => {
  assert.equal(pacificHour(NOW), 12);
  assert.equal(inSendingHours(NOW), true);
  assert.equal(inSendingHours(new Date("2026-11-20T15:30:00Z")), false); // 8:30
  assert.equal(inSendingHours(new Date("2026-11-20T16:00:00Z")), true); // 9:00
  assert.equal(inSendingHours(new Date("2026-11-21T00:00:00Z")), false); // 17:00
});

test("welcome: about an hour after first sign-in, and always first", () => {
  assert.equal(nextSignupStep(person({ confirmedAt: ago(0.5) }), NOW), null);
  assert.equal(nextSignupStep(person({ confirmedAt: ago(1) }), NOW), "welcome");
  assert.equal(nextSignupStep(person({ confirmedAt: ago(24 * 5), trainingCompleted: true }), NOW), "welcome");
});

test("at most one email every 2 days", () => {
  const p = person({ confirmedAt: ago(24 * 3), stepsSent: ["welcome"], lastSentAt: ago(24 * 1.5) });
  assert.equal(nextSignupStep(p, NOW), null);
  assert.equal(nextSignupStep({ ...p, lastSentAt: ago(48) }, NOW), "training");
});

test("training: from day 2, until a module is finished", () => {
  const sent = { stepsSent: ["welcome"], lastSentAt: ago(48) };
  assert.equal(nextSignupStep(person({ ...sent, confirmedAt: ago(40) }), NOW), null);
  assert.equal(nextSignupStep(person({ ...sent, confirmedAt: ago(48) }), NOW), "training");
  assert.equal(nextSignupStep(person({ ...sent, confirmedAt: ago(48), trainingStarted: true }), NOW), "training");
  // Finished a module: no training email, and the connect email comes from day 2.
  assert.equal(nextSignupStep(person({ ...sent, confirmedAt: ago(48), trainingStarted: true, trainingCompleted: true }), NOW), "connect");
});

test("connect: from day 4; never while a request to add or join a strata is waiting", () => {
  const sent = { stepsSent: ["welcome", "training"], lastSentAt: ago(48) };
  assert.equal(nextSignupStep(person({ ...sent, confirmedAt: ago(24 * 3) }), NOW), null);
  assert.equal(nextSignupStep(person({ ...sent, confirmedAt: ago(24 * 4) }), NOW), "connect");
  assert.equal(nextSignupStep(person({ ...sent, confirmedAt: ago(24 * 4), pendingJoin: true }), NOW), null);
  assert.equal(nextSignupStep(person({ ...sent, confirmedAt: ago(24 * 4), pendingCreation: true }), NOW), null);
});

test("the last note: day 9, only if nothing was started, then nothing more", () => {
  const sent = { stepsSent: ["welcome", "training", "connect"], lastSentAt: ago(48) };
  assert.equal(nextSignupStep(person({ ...sent, confirmedAt: ago(24 * 8) }), NOW), null);
  assert.equal(nextSignupStep(person({ ...sent, confirmedAt: ago(24 * 9) }), NOW), "last");
  assert.equal(nextSignupStep(person({ ...sent, confirmedAt: ago(24 * 9), trainingStarted: true }), NOW), null);
  assert.equal(nextSignupStep(person({ ...sent, confirmedAt: ago(24 * 9), pendingJoin: true }), NOW), null);
  assert.equal(nextSignupStep(person({ stepsSent: ["welcome", "training", "connect", "last"], confirmedAt: ago(24 * 15) }), NOW), null);
});

const params = (over: Partial<SignupEmailParams> = {}): SignupEmailParams => ({
  firstName: "Alex",
  links: { training: "https://app.stratacouncil.ca/e/1?to=%2Ftraining", connect: "https://app.stratacouncil.ca/e/1?to=%2Fstrata", module: "https://app.stratacouncil.ca/e/1?to=%2Ftraining%2Fx%2Fy" },
  module: { title: "What a strata council does", started: false },
  unsubscribeUrl: "https://app.stratacouncil.ca/unsubscribe?t=abc",
  ...over,
});

test("every setup tip carries the company, its mailing address, and a one-click way to stop them", () => {
  for (const step of ["welcome", "training", "connect", "last"] as const) {
    const e = signupEmail(step, params())!;
    for (const body of [e.html, e.text]) {
      assert.match(body, /Park Place, 666 Burrard St #3100, Vancouver, BC V6C 2X8/, step);
      assert.match(body, /Stop setup tips/, step);
      assert.match(body, /unsubscribe\?t=abc/, step);
    }
    assert.match(e.html, /Trickfilm Entertainment Inc\./);
    assert.match(e.text, /Trickfilm Entertainment Inc\./);
  }
});

test("setup tips stay factual: no prices, discounts, or calls to subscribe, and no reply requests", () => {
  for (const step of ["welcome", "training", "connect", "last"] as const) {
    const e = signupEmail(step, params())!;
    const all = `${e.subject} ${e.text}`;
    assert.doesNotMatch(all, /\$\d|discount|\bsubscri(be|ption)|upgrade|limited time|reply to/i, step);
    assert.doesNotMatch(all, /—/, `${step}: no em dashes`);
  }
});

test("the welcome has one button and a text link; the last note keeps its closing line", () => {
  const welcome = signupEmail("welcome", params())!;
  assert.equal(welcome.subject, "Welcome to StrataCouncil.ca");
  assert.equal((welcome.html.match(/display:inline-block;background/g) ?? []).length, 1);
  assert.match(welcome.html, /Start Council Training/);
  assert.match(welcome.html, /connect your strata/);
  const last = signupEmail("last", params())!;
  assert.match(last.text, /This is the last of our setup emails\. Your account stays open whenever you're ready\./);
});

test("the training email suggests a module without a time commitment, or picks up where they left off", () => {
  const start = signupEmail("training", params())!;
  assert.equal(start.subject, "A good place to start");
  assert.doesNotMatch(start.subject + start.text, /\d+ minutes/);
  const resume = signupEmail("training", params({ module: { title: "What a strata council does", started: true } }))!;
  assert.equal(resume.subject, "Pick up where you left off: What a strata council does");
  assert.equal(signupEmail("training", params({ module: null, links: { ...params().links, module: null } })), null);
});

test("the connect email separates joining from adding, and describes search as it works", () => {
  const e = signupEmail("connect", params())!;
  assert.match(e.text, /ask to join\. The strata's admin approves your request and sets your role\./);
  assert.match(e.text, /owner, council member, or authorized agent/);
  assert.match(e.text, /including scans of typed or printed pages/);
  assert.doesNotMatch(e.text, /every document/i);
});

test("names are escaped in the HTML", () => {
  assert.match(signupEmail("welcome", params({ firstName: "<b>Al" }))!.html, /Hi &lt;b&gt;Al,/);
  assert.match(signupEmail("welcome", params({ firstName: "" }))!.text, /^Hi,/);
});

test("the footer says why the person got the email", () => {
  assert.match(setupFooter("u").text, /because you created a StrataCouncil\.ca account/);
});

test("the strata-ready email gives three next steps and says council meetings are free", () => {
  const e = creationRequestApprovedEmail({ corporationName: "Larchwood Commons", strataPlanNumber: "EPS1234", openUrl: "https://x" });
  assert.match(e.text, /Invite your council/);
  assert.match(e.text, /bylaws, rules, recent minutes, the budget, and the depreciation report/);
  assert.match(e.text, /Council meetings, Meeting Mode, and minutes are free, as many as you like\./);
  assert.doesNotMatch(e.html + e.text, /ten Stratasphere|After that, both need/);
});

test("the request-denied email doesn't ask anyone to reply to a no-reply address", () => {
  const e = creationRequestDeniedEmail({ strataPlanNumber: "EPS1234" });
  assert.doesNotMatch(e.html + e.text, /reply to/i);
});
