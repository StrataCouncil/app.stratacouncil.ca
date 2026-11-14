import { test } from "node:test";
import assert from "node:assert/strict";
import { detailChanges, detailsProblem, fiscalYearLabel, type StrataDetails } from "../lib/strata-details.ts";

const base: StrataDetails = {
  buildingName: null,
  address: "12 Elm Street, Vancouver, BC",
  fiscalYearStartMonth: null,
  legalName: "The Owners, Strata Plan EPS9048",
  jurisdiction: "BC",
  unitCount: 40,
};

test("the fiscal year reads as its first and last days", () => {
  assert.equal(fiscalYearLabel(2), "February 1 to January 31");
  assert.equal(fiscalYearLabel(1), "January 1 to December 31");
  assert.equal(fiscalYearLabel(3), "March 1 to end of February");
  assert.equal(fiscalYearLabel(null), null);
  assert.equal(fiscalYearLabel(13), null);
});

test("an Admin's changes: only their fields, tidied, from and to", () => {
  const { changes, patch } = detailChanges(
    base,
    { ...base, buildingName: "  The  Larches ", fiscalYearStartMonth: 2, legalName: "Changed", unitCount: 99 },
    false
  );
  assert.deepEqual(patch, { building_name: "The Larches", fiscal_year_start_month: 2 });
  assert.deepEqual(
    changes.map((c) => [c.label, c.from, c.to]),
    [
      ["Building name", "None", "The Larches"],
      ["Fiscal year", "Not set", "February 1 to January 31"],
    ]
  );
});

test("a Super Admin can change the legal name, jurisdiction, and number of lots", () => {
  const { patch } = detailChanges(base, { ...base, legalName: "New name", jurisdiction: "AB", unitCount: 41 }, true);
  assert.deepEqual(patch, { legal_name: "New name", jurisdiction: "AB", unit_count: 41 });
});

test("clearing the building name and the fiscal year", () => {
  const { patch } = detailChanges({ ...base, buildingName: "The Larches", fiscalYearStartMonth: 2 }, { ...base, buildingName: "  ", fiscalYearStartMonth: null }, false);
  assert.deepEqual(patch, { building_name: null, fiscal_year_start_month: null });
});

test("nothing changed, nothing to save", () => {
  assert.deepEqual(detailChanges(base, { ...base, address: " 12 Elm Street,  Vancouver, BC " }, false).patch, {});
});

test("problems are caught before saving", () => {
  assert.equal(detailsProblem({ ...base, address: " " }, false), "Enter the address (up to 300 characters).");
  assert.equal(detailsProblem({ ...base, fiscalYearStartMonth: 0 }, false), "Choose the month the fiscal year starts.");
  assert.equal(detailsProblem({ ...base, unitCount: NaN }, false), null, "an Admin's form doesn't check Super Admin fields");
  assert.equal(detailsProblem({ ...base, unitCount: NaN }, true), "Enter the number of strata lots.");
  assert.equal(detailsProblem(base, true), null);
});
