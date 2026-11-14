import { test } from "node:test";
import assert from "node:assert/strict";
import { ledgerLine } from "../lib/ai/ledger-line.ts";

const d = {
  decided_at: "2026-09-14T19:00:00Z",
  meeting_type: "council meeting",
  title: "Insurance renewal",
  motion_text: "THAT council approve the insurance renewal with Acme Insurance for $84,000, financed over 12 months.",
  mover: "SL012",
  seconder: "SL005",
  votes_for: 5,
  votes_against: 0,
  votes_abstain: 1,
  source: "meeting",
};

test("a title the motion already states isn't repeated", () => {
  assert.equal(
    ledgerLine(d),
    "[2026-09-14, council meeting] (5-0-1) Moved SL012, seconded SL005. THAT council approve the insurance renewal with Acme Insurance for $84,000, financed over 12 months."
  );
});

test("a title the motion doesn't state is kept, and nothing is lost", () => {
  const line = ledgerLine({ ...d, title: "Roof", motion_text: "THAT the quote from Peak Roofing be accepted.", source: "historic_minutes", mover: null, votes_for: null });
  assert.equal(line, "[2026-09-14, council meeting, past minutes] Roof. Motion: THAT the quote from Peak Roofing be accepted.");
});

test("a decision without a motion keeps its title", () => {
  assert.equal(ledgerLine({ ...d, motion_text: null }), "[2026-09-14, council meeting] Insurance renewal (5-0-1). Moved SL012, seconded SL005.");
});
