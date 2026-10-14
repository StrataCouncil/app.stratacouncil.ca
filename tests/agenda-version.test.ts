import { test } from "node:test";
import assert from "node:assert/strict";
import { agendaVersion } from "../lib/meetings/agenda-version.ts";

const item = { id: "i1", catId: "c1", cat: "Opening", num: 1, text: "Call to Order", type: "FOR_INFORMATION", motion: null, atts: [] };

test("an agenda's version follows its content, not the order of its keys", () => {
  const reordered = Object.fromEntries(Object.entries(item).reverse());
  assert.equal(agendaVersion([item]), agendaVersion([reordered]));
});

test("any change to the agenda changes its version", () => {
  assert.notEqual(agendaVersion([item]), agendaVersion([{ ...item, text: "Call to order, 7 pm" }]));
  assert.notEqual(agendaVersion([item]), agendaVersion([item, { ...item, id: "i2", num: 2, text: "Adjournment" }]));
});
