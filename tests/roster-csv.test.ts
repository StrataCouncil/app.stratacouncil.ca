/** Owner roster CSV (lib/roster-csv.ts). Run: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeLotNumber, parseCsv, parseRosterCsv, toRosterCsv } from "../lib/roster-csv.ts";

test("lot numbers normalize", () => {
  for (const [i, o] of [["SL001", "SL001"], ["sl1", "SL001"], ["SL 061", "SL061"], ["SL-12", "SL012"], ["7", "SL007"], ["SL1000", "SL1000"], ["Unit 4", null], ["", null]] as const)
    assert.equal(normalizeLotNumber(i), o, i);
});

test("CSV mechanics: BOM, CRLF, quotes", () => {
  assert.deepEqual(parseCsv('﻿a,"b,c","d ""q"""\r\n"x\ny",2\r\n'), [["a", "b,c", 'd "q"'], ["x\ny", "2"]]);
});

test("a blank template has no rows", () => {
  assert.deepEqual(parseRosterCsv(toRosterCsv([{ lot_number: "SL001" }, { lot_number: "SL002" }])), { ok: false, errors: ["The file has no strata lot rows."] });
});

test("full row, reordered columns, owner type", () => {
  const r = parseRosterCsv('Owner Name,Strata Lot,Strata Fees,Owner Type,Unit Entitlement,Email\n"Smith, Jane",sl 3,"$1,234.50",Owner Absentee,87,jane@x.ca\n');
  assert.ok(r.ok);
  assert.deepEqual(r.rows[0], { lot_number: "SL003", full_name: "Smith, Jane", email: "jane@x.ca", unit_number: null, unit_entitlement: 87, owner_type: "owner_absentee", parking: null, storage: null, bike_rack: null, strata_fees: 1234.5 });
});

test("several emails in one cell", () => {
  const r = parseRosterCsv("Strata Lot,Email\nSL001,a@x.ca b@y.ca\nSL002,c@x.ca; d@y.ca\n");
  assert.ok(r.ok);
  assert.equal(r.rows[0].email, "a@x.ca, b@y.ca");
  assert.equal(r.rows[1].email, "c@x.ca, d@y.ca");
  const bad = parseRosterCsv("Strata Lot,Email\nSL001,a@x.ca nope\n");
  assert.ok(!bad.ok);
  assert.match(bad.errors[0], /"nope" isn't a valid email/);
});

test("old owner types are rejected with the right options", () => {
  const r = parseRosterCsv("Strata Lot,Owner Type\nSL001,Tenant\n");
  assert.ok(!r.ok);
  assert.match(r.errors[0], /Owner Occupant, Owner Absentee, or Developer/);
});

test("errors are collected across the file and the whole file fails", () => {
  const r = parseRosterCsv("Strata Lot,Email,Strata Fees,Owner Type\nSL001,not-an-email,12x,landlord\n,x@y.ca,,\nUnit 9,a@b.ca,,\n");
  assert.ok(!r.ok);
  assert.equal(r.errors.length, 5, JSON.stringify(r.errors));
});

test("export guards formulas and round-trips", () => {
  const out = toRosterCsv([{ lot_number: "SL001", full_name: "=HYPERLINK(1)", owner_type: "developer", strata_fees: 350 }]);
  assert.match(out, /'=HYPERLINK/);
  assert.match(out, /,Developer,/);
  const r = parseRosterCsv(out);
  assert.ok(r.ok);
  assert.equal(r.rows[0].full_name, "=HYPERLINK(1)");
  assert.equal(r.rows[0].owner_type, "developer");
});

test("a real 102-lot roster in the downloaded template's shape parses", () => {
  const r = parseRosterCsv(readFileSync(new URL("./fixtures/owner-roster.csv", import.meta.url), "utf8"));
  assert.ok(r.ok, r.ok ? "" : r.errors.join("\n"));
  assert.equal(r.rows.length, 102);
  assert.equal(r.rows[1].email, "owner2@example.com, co2@example.ca");
  assert.deepEqual(new Set(r.rows.map((x) => x.owner_type)), new Set(["owner_occupant", "owner_absentee", "developer"]));
});
