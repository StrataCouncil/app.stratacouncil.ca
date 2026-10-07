import { test } from "node:test";
import assert from "node:assert/strict";
import { demoPageName, describeDemoEvent, summarizeDemoActivity, type DemoActivityEvent } from "../lib/demo-activity.ts";

let n = 0;
const ev = (kind: string, path: string | null, detail: Record<string, unknown> = {}): DemoActivityEvent => ({
  id: ++n,
  at: new Date(Date.UTC(2026, 9, 7, 18, 0, n)).toISOString(),
  kind,
  path,
  detail,
});

test("pages are named for what they are", () => {
  assert.equal(demoPageName("/strata/DEMO-000123/meetings/abc/run"), "Meeting Mode");
  assert.equal(demoPageName("/strata/DEMO-000123/meetings/new"), "New meeting");
  assert.equal(demoPageName("/strata/DEMO-000123/assistant"), "Stratasphere chat");
  assert.equal(demoPageName("/strata/DEMO-000123"), "Strata overview");
  assert.equal(demoPageName("/training/abc"), "Council Training module");
});

test("what a visitor asked, and what they hit, stand out", () => {
  const asked = describeDemoEvent(ev("stratasphere.chat", "/strata/X/assistant", { question: "Can we fine lot 14?", answer: "Yes, under bylaw 6.2." }));
  assert.match(asked.line, /Can we fine lot 14\?/);
  assert.match(asked.more ?? "", /bylaw 6\.2/);
  assert.equal(asked.important, true);
  assert.match(describeDemoEvent(ev("limit", null, { reason: "second meeting" })).line, /limit: second meeting/);
  assert.equal(describeDemoEvent(ev("click", "/training", { label: "Start" })).important, undefined);
});

test("the summary adds up time, questions and how far the meeting got", () => {
  const events = [
    ev("view", "/strata/X"),
    ev("leave", "/strata/X", { seconds: 30 }),
    ev("view", "/strata/X/assistant"),
    ev("stratasphere.chat", "/strata/X/assistant", { question: "q", answer: "a" }),
    ev("stratasphere.chat", "/strata/X/assistant", { question: "q2", failed: "no" }),
    ev("leave", "/strata/X/assistant", { seconds: 95 }),
    ev("view", "/strata/X/assistant", { returned: true }),
    ev("leave", "/strata/X/assistant", { seconds: 5 }),
    ev("meeting.created", null),
    ev("meeting.launched", null),
    ev("stratasphere.meeting", null, { question: "q", answer: "a" }),
    ev("limit", null, { reason: "Meeting Mode questions" }),
    ev("alert", null, { text: "Couldn't save." }),
  ];
  const s = summarizeDemoActivity(events);
  assert.equal(s.activeSeconds, 130);
  assert.equal(s.pages, 2, "coming back to the tab isn't a new page");
  assert.equal(s.chatQuestions, 1, "a failed question isn't counted");
  assert.equal(s.meetingQuestions, 1);
  assert.equal(s.meeting, "launched");
  assert.equal(s.limits, 1);
  assert.equal(s.problems, 1);
  assert.deepEqual(s.topPages[0], { page: "Stratasphere chat", seconds: 100, visits: 1 });
});
