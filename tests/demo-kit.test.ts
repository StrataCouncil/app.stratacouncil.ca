import { test } from "node:test";
import assert from "node:assert/strict";
import { kitDates } from "../lib/demo-kit/dates.ts";
import { ROOF, kitDocuments, levyShare, yearToDate } from "../lib/demo-kit/documents.ts";
import { kitMeetings } from "../lib/demo-kit/meetings.ts";
import { ANNUAL_CONTRIBUTIONS, CAST, OWNERS, TOTAL_ENTITLEMENT, ownerEmail } from "../lib/demo-kit/people.ts";

const days = ["2026-10-07T18:00:00Z", "2027-01-02T08:30:00Z", "2027-03-14T12:00:00Z", "2027-07-31T23:00:00Z"].map((s) => new Date(s));

test("the demo strata's calendar is in order, whatever day the visitor arrives", () => {
  for (const now of days) {
    const d = kitDates(now);
    const order = [d.previousFiscalStart, d.fiscalStart, d.agm, d.meeting0, d.meeting1, d.meeting2, d.today, d.upcoming, d.levyDue2];
    assert.deepEqual([...order].sort(), order, `out of order for ${now.toISOString()}`);
    for (const date of [d.meeting1, d.meeting2, d.upcoming, d.agm]) assert.equal(new Date(`${date}T12:00:00Z`).getUTCDay(), 2, "meetings are on Tuesdays");
    assert.ok(d.leak < d.meeting2 && d.hearingRequest < d.today && d.parkingResponse < d.today);
    assert.ok(d.agm < d.levyDue1 && d.levyDue1 < d.meeting2, "the first levy instalment came due before the last meeting");
    assert.ok(d.statementMonthStart >= d.fiscalStart, "the statement is in this fiscal year");
  }
});

test("the roster adds up to the budget", () => {
  assert.equal(OWNERS.length, 24);
  assert.equal(OWNERS.reduce((s, o) => s + o.entitlement, 0), TOTAL_ENTITLEMENT);
  const yearly = OWNERS.reduce((s, o) => s + o.fee * 12, 0);
  assert.ok(Math.abs(yearly - ANNUAL_CONTRIBUTIONS) < 2, `fees ${yearly} vs ${ANNUAL_CONTRIBUTIONS}`);
  const levy = OWNERS.reduce((s, o) => s + levyShare(o.entitlement), 0);
  assert.ok(Math.abs(levy - ROOF.levy) < 1);
  assert.equal(yearToDate(12).fees, ANNUAL_CONTRIBUTIONS);
});

test("council members own the lots they sit for, and emails look ordinary", () => {
  for (const c of CAST.filter((x) => x.lot)) assert.equal(OWNERS.find((o) => o.lot === c.lot)?.name, c.fullName);
  assert.equal(ownerEmail("Harold and June Peterson"), "harold.peterson@example.com");
  assert.equal(ownerEmail("Wen Li and Jun Li"), "wen.li@example.com");
  assert.equal(ownerEmail("Chloé Tremblay"), "chloe.tremblay@example.com");
  assert.ok(CAST.every((c) => /@(example\.com|harbourline\.example)$/.test(c.email)), "fictional addresses only");
});

test("meetings: votes come from lots that were there, and attachments exist", () => {
  const d = kitDates(days[0]);
  const docs = new Set(kitDocuments(d, "The Owners, Strata Plan DEMO000001").map((doc) => doc.key));
  for (const m of kitMeetings(d)) {
    for (const it of m.agenda) {
      if (m.held && it.motion && it.done) {
        assert.equal(m.attendance[it.motion.mover], "present", `${m.key}: mover of "${it.text}"`);
        assert.equal(m.attendance[it.motion.sec], "present", `${m.key}: seconder of "${it.text}"`);
        const present = Object.values(m.attendance).filter((a) => a === "present").length;
        assert.equal(it.motion.for + it.motion.against + it.motion.abstain, present, `${m.key}: votes on "${it.text}"`);
      }
      if (!m.held) assert.ok(!it.done && !it.motion?.outcome, "the next meeting hasn't happened");
    }
    for (const keys of Object.values(m.attachments)) for (const k of keys) assert.ok(docs.has(k) || k === "minutes:meeting2", `attachment ${k}`);
  }
  assert.ok(kitMeetings(d)[1].agenda.some((it) => it.deferred), "the roof award was deferred to the next meeting");
});

test("documents name no real plan number and no visitor", () => {
  const docs = kitDocuments(kitDates(days[0]), "The Owners, Strata Plan DEMO000001");
  for (const doc of docs) {
    assert.doesNotMatch(doc.text, /\b(?:BCS|EPS|LMS|VAS|VIS|KAS|NES|NWS)\s?-?\d{2,6}\b/, doc.key);
    assert.doesNotMatch(doc.text, /undefined|NaN|\[object/, doc.key);
  }
});
