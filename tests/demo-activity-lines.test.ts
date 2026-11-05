import { test } from "node:test";
import assert from "node:assert/strict";
import { demoPageName, describeDemoEvent } from "../lib/demo-activity.ts";

const ev = (kind: string, detail: Record<string, unknown> = {}, path = "/strata/DEMO-1/meetings") => ({ id: 1, at: "2026-11-05T16:44:25Z", kind, path, detail });

test("pages are named, including Library articles, Discussions and Billing", () => {
  assert.equal(demoPageName("/strata/DEMO-1/guides/f977ccaa-7ceb-446a-9ddb-1e87c0f3d72a"), "Library article");
  assert.equal(demoPageName("/strata/DEMO-1/guides"), "Library");
  assert.equal(demoPageName("/strata/DEMO-1/discussions"), "Discussions");
  assert.equal(demoPageName("/strata/DEMO-1/discussions/new"), "New discussion");
  assert.equal(demoPageName("/strata/DEMO-1/discussions/6ffe0ac7/vote"), "Confirm a vote");
  assert.equal(demoPageName("/strata/DEMO-1/discussions/6ffe0ac7"), "Discussion");
  assert.equal(demoPageName("/strata/DEMO-1/billing"), "Billing");
});

test("an article says which one", () => {
  const line = describeDemoEvent(ev("view", { heading: "A Successful AGM, Part 1: Preparation" }, "/strata/DEMO-1/guides/f977")).line;
  assert.equal(line, "Opened Library article: A Successful AGM, Part 1: Preparation");
  assert.equal(describeDemoEvent(ev("view", { heading: "Overview" }, "/strata/DEMO-1")).line, "Opened Strata overview");
});

test("fields, choices and things that open and close read as what happened", () => {
  assert.equal(describeDemoEvent(ev("field", { label: "Minutes summary" })).line, 'Went to the "Minutes summary" field');
  assert.equal(describeDemoEvent(ev("choice", { label: "Format", value: "Electronic" })).line, 'Chose "Electronic" for "Format"');
  assert.equal(describeDemoEvent(ev("click", { label: "Review Correspondence", toggled: "opened" })).line, 'Opened "Review Correspondence"');
  assert.equal(describeDemoEvent(ev("click", { label: "Review Correspondence", toggled: "closed" })).line, 'Closed "Review Correspondence"');
  assert.equal(describeDemoEvent(ev("click", { label: "Launch meeting" })).line, 'Clicked "Launch meeting"');
});
