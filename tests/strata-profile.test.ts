import { test } from "node:test";
import assert from "node:assert/strict";
import { buildStrataProfile, isCompanyName, type ProfileLot, type StrataProfileData } from "../lib/ai/strata-profile.ts";
import { stripPII } from "../lib/pii.ts";

const lot = (n: number, ownerName: string | null, extra: Partial<ProfileLot> = {}): ProfileLot => ({
  lot: `SL${String(n).padStart(3, "0")}`,
  unit: String(100 + n),
  entitlement: 100,
  ownerType: "owner",
  ownerName,
  parking: null,
  storage: null,
  bikeRack: null,
  fees: 400,
  isCouncil: false,
  role: null,
  ...extra,
});

const data = (lots: ProfileLot[]): StrataProfileData => ({
  corp: { planNumber: "EPS9048", legalName: "The Owners, Strata Plan EPS9048", buildingName: "Selkirks & Monashees", address: "1001 Example Road, Kelowna", unitCount: lots.length, jurisdiction: "BC" },
  management: { company: "Acme Strata Management Ltd.", website: "https://acme.example", managers: 2 },
  lots,
  platformRoles: [{ role: "admin", count: 1 }],
  members: { active: 5, invited: 1 },
  meetings: [
    {
      date: "2026-11-02",
      type: "Council Meeting",
      status: "DRAFT",
      format: "In person",
      minutesState: null,
      trial: false,
      location: "Unit 104, home of Jane Doe",
      chair: "Jane Doe",
      presentLots: 0,
      agenda: [{ num: 1, cat: "New Business", text: "Jane Doe's request for a hot tub", type: "FOR_DECISION", done: false, deferred: false, outcome: null }],
    },
  ],
  documents: [{ title: "BYLAWS - Selkirks Monashees Bylaws", category: "bylaws_rules", uploadedAt: "2026-10-14T00:00:00Z", current: true }],
  announcements: [],
  library: [{ title: "Flood Response", kind: "Emergency Playbook", summary: "What to do first." }],
});

test("companies are recognised; people and family trusts aren't", () => {
  for (const n of ["Selkirks Developments Ltd.", "1234567 B.C. Ltd.", "Acme Holdings Inc", "Bosa Properties", "Mountain Homes Corp."]) assert.ok(isCompanyName(n), n);
  for (const n of ["Jane Doe", "Kim Lee & John Smith", "Smith Family Trust", "", null]) assert.ok(!isCompanyName(n), String(n));
});

test("no owner is ever named; codes tie together the lots one owner holds", () => {
  const text = buildStrataProfile(
    data([
      lot(1, "Selkirks Developments Ltd."),
      lot(2, "Selkirks Developments Ltd."),
      lot(3, "Jane Doe", { isCouncil: true, role: "president" }),
      lot(4, "Jane Doe"),
      lot(5, "John Smith"),
      lot(6, null),
      lot(7, "John Smith Holdings Ltd."),
    ]),
    (s) => stripPII(s, [{ name: "Jane Doe", lotNumber: "SL003" }, { name: "John Smith", lotNumber: "SL005" }], ["Selkirks & Monashees"])
  );
  assert.match(text, /Company A \(a company\) is listed on 2 lots: SL001, SL002/);
  assert.match(text, /Owner A \(an individual\) is listed on 2 lots: SL003, SL004/);
  assert.match(text, /SL001 \| unit 101 \| UE 100 \| owner: Company A/);
  assert.match(text, /SL005 \| unit 105 \| UE 100 \| owner: an individual/);
  assert.match(text, /SL007 .*owner: a company/);
  assert.match(text, /SL006 .*no owner on file/);
  assert.match(text, /3 lots owned by companies; 3 by individuals; 1 with no owner on file\./);
  assert.match(text, /SL003: President/);
  assert.match(text, /7 lots\. Total unit entitlement 700\. Total monthly strata fees \$2,800\.00\./);
  // No owner's name anywhere: not on the roster, not in the agenda, the chair or the location.
  assert.doesNotMatch(text, /Jane|Doe|John|Smith|Developments/);
  // The strata's own name survives in a document title; the manager is the company.
  assert.match(text, /BYLAWS - Selkirks Monashees Bylaws/);
  assert.match(text, /Strata management company: Acme Strata Management Ltd\./);
  // Private: billing and training aren't included.
  assert.doesNotMatch(text, /subscription|billed|Council Training/i);
});

test("the strata's own name and address are never redacted, a person's still is", () => {
  const keep = ["Selkirks & Monashees", "1001 Example Road, Kelowna"];
  assert.equal(stripPII("BYLAWS - Selkirks Monashees Bylaws", [], keep), "BYLAWS - Selkirks Monashees Bylaws");
  assert.equal(stripPII("BYLAWS_-_Selkirks_&_Monashees_Bylaws.pdf", [], keep), "BYLAWS_-_Selkirks_&_Monashees_Bylaws.pdf");
  assert.equal(stripPII("Meet at 1001 Example Road, Kelowna", [], keep), "Meet at 1001 Example Road, Kelowna");
  assert.equal(stripPII("Meet at 22 Other Street", [], keep), "Meet at [address redacted]");
  assert.equal(stripPII("John Smith of Selkirks and Monashees", [], keep), "[name redacted] of Selkirks and Monashees");
  // Without the keep list, the old behaviour.
  assert.equal(stripPII("BYLAWS - Selkirks Monashees Bylaws"), "BYLAWS - [name redacted] Bylaws");
});

test("a company owner is replaced by its code in full, never word by word", () => {
  const people = [{ name: "Selkirks Developments Ltd.", lotNumber: "Company A", exact: true }];
  assert.equal(stripPII("The developer, Selkirks Developments Ltd, may retain lots.", people), "The developer, Company A, may retain lots.");
  assert.equal(stripPII("SELKIRKS DEVELOPMENTS LTD.", people), "Company A.");
  // Its words on their own are left to the usual rules, not taken as a person's name.
  assert.equal(stripPII("the Selkirks building", people), "the Selkirks building");
});
