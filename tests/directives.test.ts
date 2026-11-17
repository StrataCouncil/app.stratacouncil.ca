import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanDraft, cleanDueDate, motionAsTask, motionDirective, namedAssignee, needsFollowUp } from "../lib/directives/motion.ts";

test("routine motions leave nothing to do", () => {
  for (const motion of [
    "THAT the agenda be approved as circulated.",
    "THAT the minutes of the January 12, 2026 council meeting be adopted.",
    "THAT council approve the minutes of the previous meeting.",
    "THAT the treasurer's report be received.",
    "THAT council accept the financial statements for December.",
    "THAT the financial statements for the previous month be approved as presented.",
    "THAT council ratify the decision made by email on February 3.",
    "THAT Pat be elected president.",
    "THAT the meeting be adjourned.",
    "THAT the next council meeting be held on March 4.",
  ]) {
    assert.equal(needsFollowUp({ title: "Item", motion }), false, motion);
  }
});

test("motions that ask for something to be done need follow-up", () => {
  for (const motion of [
    "THAT council obtain three quotes for the roof membrane and report back at the March meeting.",
    "THAT the strata manager send a bylaw warning letter to SL7.",
    "THAT council approve spending up to $4,500 for dryer-vent cleaning.",
  ]) {
    assert.equal(needsFollowUp({ title: "Item", motion }), true, motion);
  }
  assert.equal(needsFollowUp({ title: "Item", motion: "   " }), false);
});

test("a motion becomes a task in its own words", () => {
  assert.equal(motionAsTask("THAT council obtain three quotes."), "Council obtain three quotes.");
  assert.equal(motionAsTask("  that   the manager book the cleaning;  "), "The manager book the cleaning.");
  assert.equal(motionAsTask("BE IT RESOLVED by a 3/4 vote of the owners that the strata spend $10,000."), "The strata spend $10,000.");
  assert.equal(motionAsTask("Replace the lobby lights"), "Replace the lobby lights.");
  assert.equal(motionAsTask(""), "");
});

test("the manager is named when the motion names them", () => {
  assert.equal(namedAssignee("THAT the strata manager send the letter."), "manager");
  assert.equal(namedAssignee("THAT the property management company get quotes."), "manager");
  assert.equal(namedAssignee("THAT council get quotes."), "none");
});

test("a long motion keeps its full text in the detail", () => {
  const long = `THAT ${"council review the depreciation report and ".repeat(10)}report back.`;
  const d = motionDirective({ title: "Depreciation report", motion: long });
  assert.ok(d.title.length <= 300 && d.title.endsWith("..."));
  assert.ok(d.detail.startsWith("Council review"));
  assert.equal(motionDirective({ title: "Lobby lights", motion: "THAT the lights be replaced." }).detail, "");
});

test("drafts from the AI are checked", () => {
  assert.equal(cleanDueDate("2026-03-01"), "2026-03-01");
  assert.equal(cleanDueDate("2026-02-30"), null);
  assert.equal(cleanDueDate("March 1"), null);
  assert.equal(cleanDueDate(null), null);
  assert.deepEqual(cleanDraft({ title: "  Get   quotes ", detail: " Three. ", assignee: "manager", dueDate: "2026-03-01" }), {
    title: "Get quotes",
    detail: "Three.",
    assignee: "manager",
    dueDate: "2026-03-01",
  });
  assert.equal(cleanDraft({ title: "  " }), null);
  assert.equal(cleanDraft(null), null);
  assert.equal(cleanDraft({ title: "X", assignee: "someone" })?.assignee, "none");
});

import { assigneeLabel, dayLabel, filterDirectives, isMine, isOverdue, sortDirectives, type ListDirective } from "../lib/directives/list.ts";

const base: ListDirective = {
  id: "x",
  title: "Task",
  detail: "",
  status: "open",
  dueDate: null,
  createdAt: "2026-01-01T00:00:00Z",
  closedAt: null,
  assigneeKind: "none",
  assigneeUserId: null,
  assigneeName: "",
};

test("overdue means open and past its due date", () => {
  assert.equal(isOverdue({ status: "open", dueDate: "2026-03-01" }, "2026-03-02"), true);
  assert.equal(isOverdue({ status: "open", dueDate: "2026-03-02" }, "2026-03-02"), false);
  assert.equal(isOverdue({ status: "done", dueDate: "2026-03-01" }, "2026-03-02"), false);
  assert.equal(isOverdue({ status: "open", dueDate: null }, "2026-03-02"), false);
});

test("open first, by due date, undated last; then closed, latest first", () => {
  const list: ListDirective[] = [
    { ...base, id: "done-old", status: "done", closedAt: "2026-02-01T00:00:00Z" },
    { ...base, id: "undated-new", createdAt: "2026-02-10T00:00:00Z" },
    { ...base, id: "due-late", dueDate: "2026-05-01" },
    { ...base, id: "cancelled-new", status: "cancelled", closedAt: "2026-03-01T00:00:00Z" },
    { ...base, id: "due-soon", dueDate: "2026-03-01" },
    { ...base, id: "undated-old", createdAt: "2026-01-05T00:00:00Z" },
  ];
  assert.deepEqual(
    sortDirectives(list).map((d) => d.id),
    ["due-soon", "due-late", "undated-new", "undated-old", "cancelled-new", "done-old"]
  );
});

test("filters: open, done, mine, and search", () => {
  const me = { userId: "u1", isManager: false };
  const list: ListDirective[] = [
    { ...base, id: "a", title: "Roof quotes", assigneeKind: "person", assigneeUserId: "u1", assigneeName: "Pat" },
    { ...base, id: "b", title: "Bylaw letter", assigneeKind: "manager" },
    { ...base, id: "c", title: "Lights", status: "done" },
    { ...base, id: "d", title: "Old", status: "cancelled", assigneeKind: "person", assigneeUserId: "u1" },
  ];
  assert.deepEqual(filterDirectives(list, "open", me).map((d) => d.id), ["a", "b"]);
  assert.deepEqual(filterDirectives(list, "done", me).map((d) => d.id), ["c", "d"]);
  assert.deepEqual(filterDirectives(list, "all", me).map((d) => d.id), ["a", "b", "c", "d"]);
  assert.deepEqual(filterDirectives(list, "mine", me).map((d) => d.id), ["a"]);
  assert.deepEqual(filterDirectives(list, "mine", { userId: "zz", isManager: true }).map((d) => d.id), ["b"]);
  assert.deepEqual(filterDirectives(list, "all", me, "  PAT ").map((d) => d.id), ["a"]);
  assert.equal(isMine(list[1], { userId: "u1", isManager: false }), false);
});

test("labels", () => {
  assert.equal(assigneeLabel({ assigneeKind: "manager", assigneeName: "" }), "The manager");
  assert.equal(assigneeLabel({ assigneeKind: "person", assigneeName: "Pat President" }), "Pat President");
  assert.equal(assigneeLabel({ assigneeKind: "none", assigneeName: "" }), "Not assigned");
  assert.equal(dayLabel("2026-03-04"), "Mar 4, 2026");
  assert.equal(dayLabel("2026-12-31"), "Dec 31, 2026");
});
