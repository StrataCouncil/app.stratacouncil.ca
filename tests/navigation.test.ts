import { test } from "node:test";
import assert from "node:assert/strict";
import { navItemsFor, sectionFor } from "../lib/navigation.ts";

test("each page lights its top-bar section: Resources, Your Strata, Stratasphere", () => {
  assert.equal(sectionFor("/training"), "resources");
  assert.equal(sectionFor("/training/strata-basics/m1"), "resources");
  assert.equal(sectionFor("/library"), "resources");
  assert.equal(sectionFor("/templates"), "resources");
  assert.equal(sectionFor("/library/f977ccaa"), "resources");
  assert.equal(sectionFor("/strata"), "strata");
  assert.equal(sectionFor("/strata/EPS9048"), "strata");
  assert.equal(sectionFor("/strata/EPS9048/meetings/abc/run"), "strata");
  assert.equal(sectionFor("/strata/EPS9048/lots"), "strata");
  assert.equal(sectionFor("/strata/EPS9048/assistant"), "stratasphere");
  assert.equal(sectionFor("/strata/EPS9048/documents"), "strata");
  assert.equal(sectionFor("/strata/EPS9048/documents/bylaws"), "strata");
  assert.equal(sectionFor("/admin/recall"), "admin");
  assert.equal(sectionFor("/account"), null);
});

const everyone = { canManage: false, canBill: false, seesDiscussions: false };
const admin = { canManage: true, canBill: true, seesDiscussions: true };
const labels = (active: string, who: typeof admin) => navItemsFor(active, who).map((i) => i.label);

test("Your Strata: the admin sees every item, in order", () => {
  assert.deepEqual(labels("home", admin), ["Overview", "Meetings", "Discussions", "Documents", "Council", "Owners", "Management", "Billing"]);
  assert.deepEqual(labels("meetings", admin), labels("home", admin));
});

test("Your Strata: a member without roles sees what's open to every member", () => {
  assert.deepEqual(labels("home", everyone), ["Overview", "Meetings", "Documents", "Council", "Owners"]);
  assert.deepEqual(labels("lots", { ...everyone, seesDiscussions: true, canBill: true }), ["Overview", "Meetings", "Discussions", "Documents", "Council", "Owners", "Billing"]);
  assert.deepEqual(labels("documents", everyone), labels("home", everyone));
});

test("Stratasphere: Ask (locked until subscribed); Documents is in Your Strata", () => {
  assert.deepEqual(labels("assistant", everyone), ["Ask"]);
  assert.deepEqual(labels("assistant", admin), ["Ask"]);
  assert.equal(navItemsFor("assistant", admin).find((i) => i.label === "Ask")?.gated, true);
});

test("no Library or Decisions page inside a strata", () => {
  const all = [...labels("home", admin), ...labels("assistant", admin)];
  assert.ok(!all.includes("Library") && !all.includes("Decisions"));
});

test("a manager who isn't on council sees the Discussions tab, for Directives (0097)", () => {
  const slugs = (who: Parameters<typeof navItemsFor>[1]) => navItemsFor("", who).map((i) => i.slug);
  assert.ok(slugs({ canManage: true, canBill: false, seesDiscussions: false, seesDirectives: true }).includes("discussions"));
  assert.ok(!slugs({ canManage: false, canBill: false, seesDiscussions: false, seesDirectives: false }).includes("discussions"));
  assert.ok(!slugs({ canManage: false, canBill: false, seesDiscussions: false }).includes("discussions"));
});
