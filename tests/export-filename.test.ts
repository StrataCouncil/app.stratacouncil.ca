import { test } from "node:test";
import assert from "node:assert/strict";
import { documentSlug, exportFileName, meetingDocumentName, todayInBC } from "../lib/exports/filename.ts";

test("meeting documents follow PLAN_DATE_NAME.ext", () => {
  assert.equal(exportFileName("EPS-9048", "2026-10-05", meetingDocumentName("council", "Agenda"), "docx"), "EPS-9048_2026-10-05_Council-Meeting-Agenda.docx");
  assert.equal(exportFileName("EPS-9048", "2026-10-05", meetingDocumentName("agm", "Minutes"), "pdf"), "EPS-9048_2026-10-05_AGM-Minutes.pdf");
  assert.equal(exportFileName("EPS-9048", "2026-10-05", meetingDocumentName("sgm", "Draft Minutes"), "DOCX"), "EPS-9048_2026-10-05_SGM-Draft-Minutes.docx");
});

test("other exports use the same pattern", () => {
  assert.equal(exportFileName("EPS-9048", "2026-10-04", "Owner roster", "csv"), "EPS-9048_2026-10-04_Owner-Roster.csv");
  assert.equal(exportFileName("BCS 1234", "2026-10-04", "Owner roster template", ".csv"), "BCS1234_2026-10-04_Owner-Roster-Template.csv");
});

test("names are cleaned to letters, digits and hyphens", () => {
  assert.equal(documentSlug("Résumé & notes, 2026"), "Resume-And-Notes-2026");
  assert.equal(documentSlug("  "), "Document");
});

test("a missing date falls back to today in BC", () => {
  assert.match(exportFileName("EPS-9048", "", "Owner roster", "csv"), /^EPS-9048_\d{4}-\d{2}-\d{2}_Owner-Roster\.csv$/);
  assert.equal(todayInBC(new Date("2026-10-06T05:00:00Z")), "2026-10-05");
});

test("non-strata exports keep their name as given", () => {
  assert.equal(exportFileName("StrataCouncil", "2026-10-05", "Backup codes", "txt"), "StrataCouncil_2026-10-05_Backup-Codes.txt");
});
